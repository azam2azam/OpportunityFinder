import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreOpportunity, bandPriority, resolveWeights, computeEngagement,
  DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, type RawFactors,
} from '../src/lib/scoring'

/**
 * Scoring engine tests.
 *
 * The properties asserted here are the ones the product's credibility rests on:
 * the model is configurable rather than hard-coded, the clinical-safety floor
 * cannot be overridden by financial weighting, and every score arrives with an
 * explanation attached.
 */

const baseline: RawFactors = {
  clinicalUrgency: 50,
  conversionProbability: 0.4,
  financialValue: 1000,
  daysOverdue: 20,
  patientEngagement: 60,
  priorEncounters: 3,
  serviceAvailability: 50,
  insuranceStatus: 'INSURED',
  distanceKm: 12,
}

describe('scoreOpportunity', () => {
  test('produces a score inside 0..100', () => {
    const result = scoreOpportunity(baseline, DEFAULT_WEIGHTS)
    assert.ok(result.score >= 0 && result.score <= 100, `score was ${result.score}`)
  })

  test('emits a contribution for every factor, explanation included', () => {
    const result = scoreOpportunity(baseline, DEFAULT_WEIGHTS)
    assert.equal(result.breakdown.length, 9)
    for (const factor of result.breakdown) {
      assert.ok(factor.explanation.length > 0, `${factor.factor} had no explanation`)
      assert.ok(factor.normalised >= 0 && factor.normalised <= 100)
    }
  })

  test('never returns a priority without reasons behind it', () => {
    const result = scoreOpportunity(baseline, DEFAULT_WEIGHTS)
    assert.ok(result.reasons.length > 0, 'a scored opportunity must carry its rationale')
  })

  test('is driven by configuration, not hard-coded weights', () => {
    // Same inputs, different models. If weighting were baked in, these would
    // be identical — which is exactly what the spec forbids.
    const clinicalModel = scoreOpportunity(
      { ...baseline, clinicalUrgency: 95, financialValue: 100 },
      { ...DEFAULT_WEIGHTS, clinicalUrgency: 60, financialValue: 2 }
    )
    const financialModel = scoreOpportunity(
      { ...baseline, clinicalUrgency: 95, financialValue: 100 },
      { ...DEFAULT_WEIGHTS, clinicalUrgency: 2, financialValue: 60 }
    )
    assert.ok(
      clinicalModel.score > financialModel.score,
      'a clinically-weighted model must score an urgent, low-value case higher than a revenue-weighted one'
    )
  })

  test('a zeroed model scores neutral rather than dividing by zero', () => {
    const zeroed = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]))
    const result = scoreOpportunity(baseline, zeroed)
    assert.equal(result.score, 0)
    assert.equal(result.priority, 'LOW')
  })

  test('financial value scales logarithmically, not linearly', () => {
    const small = scoreOpportunity({ ...baseline, financialValue: 500 }, DEFAULT_WEIGHTS)
    const medium = scoreOpportunity({ ...baseline, financialValue: 5_000 }, DEFAULT_WEIGHTS)
    const large = scoreOpportunity({ ...baseline, financialValue: 50_000 }, DEFAULT_WEIGHTS)

    const firstStep = medium.score - small.score
    const secondStep = large.score - medium.score
    assert.ok(firstStep > 0 && secondStep > 0, 'more value must never score lower')
    assert.ok(
      firstStep > secondStep,
      'the 500→5,000 step must matter more than 5,000→50,000, or large surgical cases flatten every other signal'
    )
  })

  test('time sensitivity peaks then eases, so ancient work does not pin the top of the queue', () => {
    const fresh = scoreOpportunity({ ...baseline, daysOverdue: 5 }, DEFAULT_WEIGHTS)
    const peak = scoreOpportunity({ ...baseline, daysOverdue: 120 }, DEFAULT_WEIGHTS)
    const ancient = scoreOpportunity({ ...baseline, daysOverdue: 900 }, DEFAULT_WEIGHTS)

    assert.ok(peak.score > fresh.score, 'overdue work must outrank fresh work')
    assert.ok(
      ancient.score < peak.score,
      'a follow-up 900 days late is a reactivation case, not the most urgent thing in the hospital'
    )
  })

  test('a not-yet-due opportunity contributes no time sensitivity', () => {
    const result = scoreOpportunity({ ...baseline, daysOverdue: -5 }, DEFAULT_WEIGHTS)
    const time = result.breakdown.find((b) => b.factor === 'timeSensitivity')
    assert.equal(time?.normalised, 0)
  })
})

describe('clinical safety floor', () => {
  test('raises the banded priority and records the override', () => {
    // Deliberately unattractive on every commercial axis.
    const lowValue: RawFactors = {
      ...baseline,
      clinicalUrgency: 98,
      financialValue: 0,
      conversionProbability: 0.05,
      daysOverdue: 2,
      patientEngagement: 10,
      priorEncounters: 0,
    }
    const withoutFloor = scoreOpportunity(lowValue, DEFAULT_WEIGHTS)
    const withFloor = scoreOpportunity(lowValue, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, 'CRITICAL')

    assert.equal(withFloor.priority, 'CRITICAL')
    assert.ok(withFloor.priorityOverride, 'the override must be stated, not applied silently')
    assert.notEqual(withoutFloor.priority, 'CRITICAL')
  })

  test('never lowers a priority the score already earned', () => {
    const urgent: RawFactors = { ...baseline, clinicalUrgency: 100, financialValue: 50_000, daysOverdue: 90 }
    const banded = scoreOpportunity(urgent, DEFAULT_WEIGHTS)
    const floored = scoreOpportunity(urgent, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, 'LOW')
    assert.equal(floored.priority, banded.priority)
    assert.equal(floored.priorityOverride, null)
  })
})

describe('bandPriority', () => {
  test('maps scores onto the configured bands', () => {
    const t = { CRITICAL: 80, HIGH: 60, MEDIUM: 40 }
    assert.equal(bandPriority(95, t), 'CRITICAL')
    assert.equal(bandPriority(80, t), 'CRITICAL')
    assert.equal(bandPriority(79.9, t), 'HIGH')
    assert.equal(bandPriority(60, t), 'HIGH')
    assert.equal(bandPriority(41, t), 'MEDIUM')
    assert.equal(bandPriority(39, t), 'LOW')
  })

  test('honours retuned bands', () => {
    const strict = { CRITICAL: 95, HIGH: 90, MEDIUM: 85 }
    assert.equal(bandPriority(91, strict), 'HIGH')
    assert.equal(bandPriority(91, { CRITICAL: 80, HIGH: 60, MEDIUM: 40 }), 'CRITICAL')
  })
})

describe('resolveWeights', () => {
  test('falls back to defaults for missing, negative or non-finite values', () => {
    const resolved = resolveWeights({
      clinicalUrgency: 45,
      financialValue: -10,
      timeSensitivity: Number.NaN,
    })
    assert.equal(resolved.clinicalUrgency, 45)
    assert.equal(resolved.financialValue, DEFAULT_WEIGHTS.financialValue)
    assert.equal(resolved.timeSensitivity, DEFAULT_WEIGHTS.timeSensitivity)
    assert.equal(resolved.proximity, DEFAULT_WEIGHTS.proximity)
  })

  test('accepts an explicit zero as a real instruction', () => {
    // Zero means "ignore this factor", which is different from "unset".
    const resolved = resolveWeights({ proximity: 0 })
    assert.equal(resolved.proximity, 0)
  })
})

describe('computeEngagement', () => {
  test('an unreachable patient scores near the floor', () => {
    const score = computeEngagement({
      contactable: false,
      consentMarketing: false,
      hasPhone: false,
      totalAppointments: 4,
      noShows: 0,
    })
    assert.ok(score <= 10, `expected a floor value, got ${score}`)
  })

  test('reliable attendance scores above chronic non-attendance', () => {
    const reliable = computeEngagement({
      contactable: true, consentMarketing: true, hasPhone: true,
      totalAppointments: 10, noShows: 0,
    })
    const unreliable = computeEngagement({
      contactable: true, consentMarketing: true, hasPhone: true,
      totalAppointments: 10, noShows: 8,
    })
    assert.ok(reliable > unreliable)
    assert.ok(reliable <= 100 && unreliable >= 0)
  })

  test('a patient with no appointment history is not penalised as a non-attender', () => {
    const noHistory = computeEngagement({
      contactable: true, consentMarketing: true, hasPhone: true,
      totalAppointments: 0, noShows: 0,
    })
    assert.ok(noHistory >= 50, 'absence of history is not evidence of disengagement')
  })
})
