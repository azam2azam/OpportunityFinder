import { SCORING_FACTORS, FACTOR_LABEL, type ScoringFactor, type Priority } from './enums'

/**
 * The opportunity scoring engine (spec sections 16 and 17).
 *
 * Two rules shape this file:
 *
 *   1. The model is not hard-coded. Weights and priority bands arrive as data
 *      from the active ScoringModel; this module only knows how to normalise
 *      raw signals and combine them.
 *   2. Nothing is unexplained. Every factor emits a sentence describing what it
 *      measured and why it pushed the score up or down, and those sentences are
 *      what the UI shows under "High priority because:". A score with no
 *      breakdown is a bug, not a terse result.
 */

/** Raw, un-normalised signals gathered by a detector for one opportunity. */
export interface RawFactors {
  /** 0..100. Rule baseline, adjusted by the detector for the actual evidence. */
  clinicalUrgency: number
  /** 0..1 estimated probability this opportunity converts if worked. */
  conversionProbability: number
  /** Currency. Potential value of the opportunity to the hospital. */
  financialValue: number
  /** Days past the point at which action was due. Negative = not yet due. */
  daysOverdue: number
  /** 0..100 engagement composite: contactability, consent, show rate. */
  patientEngagement: number
  /** Count of encounters with the group in the trailing 24 months. */
  priorEncounters: number
  /** 0..100 availability of the service needed to act on this opportunity. */
  serviceAvailability: number
  /** INSURED | SELF_PAY | EXPIRED | UNKNOWN */
  insuranceStatus: string
  /** Kilometres from patient residence to the hospital. */
  distanceKm: number
}

export interface FactorContribution {
  factor: ScoringFactor
  label: string
  /** The raw input value, kept for audit and for "why" tooltips. */
  raw: number | string
  /** Raw mapped onto 0..100. */
  normalised: number
  weight: number
  /** weight * normalised, before the total is divided by the weight sum. */
  contribution: number
  explanation: string
}

export interface ScoreResult {
  score: number
  priority: Priority
  breakdown: FactorContribution[]
  /** The bullet list rendered in the UI, strongest contributor first. */
  reasons: string[]
  /** Set when a clinical-safety floor overrode the banded priority. */
  priorityOverride: string | null
}

export type WeightMap = Partial<Record<ScoringFactor, number>>

export interface PriorityThresholds {
  CRITICAL: number
  HIGH: number
  MEDIUM: number
}

export const DEFAULT_WEIGHTS: Record<ScoringFactor, number> = {
  clinicalUrgency: 30,
  conversionProbability: 15,
  financialValue: 20,
  timeSensitivity: 15,
  patientEngagement: 8,
  historicalUtilisation: 5,
  serviceAvailability: 3,
  insuranceStatus: 2,
  proximity: 2,
}

export const DEFAULT_THRESHOLDS: PriorityThresholds = {
  CRITICAL: 78,
  HIGH: 62,
  MEDIUM: 42,
}

/**
 * Financial normalisation reference point. Values scale logarithmically up to
 * this ceiling: the difference between a 500 and a 5,000 opportunity should
 * matter far more than between 60,000 and 65,000, and a linear scale would let
 * a handful of large surgical cases flatten every other signal to near zero.
 */
const FINANCIAL_CEILING = 60_000

/** Beyond this, "more overdue" stops meaning "more urgent" and starts meaning "cold". */
const OVERDUE_SATURATION_DAYS = 120

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

function normaliseFinancial(value: number): number {
  if (value <= 0) return 0
  const scaled = Math.log10(1 + value) / Math.log10(1 + FINANCIAL_CEILING)
  return clamp(scaled * 100)
}

/**
 * Time sensitivity is deliberately non-monotonic. It rises steeply while an
 * opportunity is freshly overdue, peaks around the saturation point, then eases
 * back: a follow-up 400 days late is a reactivation problem, not an urgent
 * one, and scoring it at maximum urgency forever would crowd out newly
 * actionable work at the top of every queue.
 */
function normaliseTimeSensitivity(daysOverdue: number): number {
  if (daysOverdue <= 0) return 0
  if (daysOverdue <= OVERDUE_SATURATION_DAYS) {
    return clamp((daysOverdue / OVERDUE_SATURATION_DAYS) * 100)
  }
  const decay = (daysOverdue - OVERDUE_SATURATION_DAYS) / (OVERDUE_SATURATION_DAYS * 3)
  return clamp(100 - decay * 45, 45, 100)
}

function normaliseUtilisation(priorEncounters: number): number {
  // Eight or more encounters in two years is a firmly established relationship.
  return clamp((Math.min(priorEncounters, 8) / 8) * 100)
}

function normaliseInsurance(status: string): { value: number; note: string } {
  switch (status) {
    case 'INSURED':
      return { value: 100, note: 'active insurance cover, service is payable' }
    case 'SELF_PAY':
      return { value: 55, note: 'self-pay — cash pathway available' }
    case 'EXPIRED':
      return { value: 30, note: 'insurance expired, cover needs re-verification' }
    default:
      return { value: 40, note: 'insurance status unknown' }
  }
}

function normaliseProximity(distanceKm: number): number {
  // Under 10 km is effectively local; past 80 km attendance drops sharply.
  if (distanceKm <= 10) return 100
  if (distanceKm >= 80) return 10
  return clamp(100 - ((distanceKm - 10) / 70) * 90)
}

export function resolveWeights(configured: WeightMap): Record<ScoringFactor, number> {
  const out = { ...DEFAULT_WEIGHTS }
  for (const factor of SCORING_FACTORS) {
    const w = configured[factor]
    if (typeof w === 'number' && Number.isFinite(w) && w >= 0) out[factor] = w
  }
  return out
}

/**
 * Computes the score, the priority band and the explanation.
 *
 * `minimumPriority` is the clinical-safety floor: a detector that saw a
 * critical lab value passes CRITICAL here, and the banded result can only be
 * raised by it, never lowered. That keeps a low financial value from burying a
 * clinically urgent case, and it is recorded as an explicit override rather
 * than folded silently into the number.
 */
export function scoreOpportunity(
  raw: RawFactors,
  weightConfig: WeightMap,
  thresholds: PriorityThresholds = DEFAULT_THRESHOLDS,
  minimumPriority: Priority | null = null
): ScoreResult {
  const weights = resolveWeights(weightConfig)
  const insurance = normaliseInsurance(raw.insuranceStatus)

  const normalised: Record<ScoringFactor, { value: number; raw: number | string; text: string }> = {
    clinicalUrgency: {
      value: clamp(raw.clinicalUrgency),
      raw: Math.round(raw.clinicalUrgency),
      text: describeUrgency(raw.clinicalUrgency),
    },
    conversionProbability: {
      value: clamp(raw.conversionProbability * 100),
      raw: Number(raw.conversionProbability.toFixed(2)),
      text: `${Math.round(raw.conversionProbability * 100)}% estimated probability of conversion for this opportunity type and patient history`,
    },
    financialValue: {
      value: normaliseFinancial(raw.financialValue),
      raw: Math.round(raw.financialValue),
      text:
        raw.financialValue > 0
          ? `${formatMoney(raw.financialValue)} of potential value attached to the pending service`
          : 'no directly attributable revenue',
    },
    timeSensitivity: {
      value: normaliseTimeSensitivity(raw.daysOverdue),
      raw: Math.round(raw.daysOverdue),
      text:
        raw.daysOverdue > 0
          ? `action window exceeded by ${Math.round(raw.daysOverdue)} days`
          : 'still inside the expected action window',
    },
    patientEngagement: {
      value: clamp(raw.patientEngagement),
      raw: Math.round(raw.patientEngagement),
      text: describeEngagement(raw.patientEngagement),
    },
    historicalUtilisation: {
      value: normaliseUtilisation(raw.priorEncounters),
      raw: raw.priorEncounters,
      text:
        raw.priorEncounters > 0
          ? `${raw.priorEncounters} prior encounters with the group in the last 24 months`
          : 'no prior encounter history',
    },
    serviceAvailability: {
      value: clamp(raw.serviceAvailability),
      raw: Math.round(raw.serviceAvailability),
      text:
        raw.serviceAvailability >= 60
          ? 'the required service has open capacity'
          : 'the required service is close to capacity',
    },
    insuranceStatus: {
      value: insurance.value,
      raw: raw.insuranceStatus,
      text: insurance.note,
    },
    proximity: {
      value: normaliseProximity(raw.distanceKm),
      raw: Math.round(raw.distanceKm),
      text: `patient lives ${Math.round(raw.distanceKm)} km from the hospital`,
    },
  }

  const breakdown: FactorContribution[] = SCORING_FACTORS.map((factor) => {
    const n = normalised[factor]
    const weight = weights[factor]
    return {
      factor,
      label: FACTOR_LABEL[factor],
      raw: n.raw,
      normalised: Math.round(n.value * 10) / 10,
      weight,
      contribution: Math.round(weight * n.value * 10) / 10,
      explanation: n.text,
    }
  })

  const weightSum = breakdown.reduce((s, b) => s + b.weight, 0)
  // A model with every weight zeroed is a configuration error, not a division
  // by zero — score it neutral and let the breakdown show why.
  const score =
    weightSum > 0
      ? Math.round((breakdown.reduce((s, b) => s + b.contribution, 0) / weightSum) * 10) / 10
      : 0

  const banded = bandPriority(score, thresholds)
  const priority = applyFloor(banded, minimumPriority)

  const reasons = breakdown
    .filter((b) => b.weight > 0 && b.normalised >= 35)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5)
    .map((b) => `${b.label}: ${b.explanation}`)

  return {
    score,
    priority,
    breakdown,
    reasons,
    priorityOverride:
      priority !== banded
        ? `Raised to ${priority} by a clinical-safety floor (banded score placed it at ${banded}).`
        : null,
  }
}

export function bandPriority(score: number, t: PriorityThresholds): Priority {
  if (score >= t.CRITICAL) return 'CRITICAL'
  if (score >= t.HIGH) return 'HIGH'
  if (score >= t.MEDIUM) return 'MEDIUM'
  return 'LOW'
}

const PRIORITY_ORDER: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

function applyFloor(banded: Priority, floor: Priority | null): Priority {
  if (!floor) return banded
  return PRIORITY_ORDER.indexOf(floor) > PRIORITY_ORDER.indexOf(banded) ? floor : banded
}

function describeUrgency(v: number): string {
  if (v >= 85) return 'clinically urgent — the underlying finding needs prompt review'
  if (v >= 65) return 'clinically significant finding awaiting follow-up'
  if (v >= 40) return 'routine clinical follow-up indicated'
  return 'no urgent clinical driver'
}

function describeEngagement(v: number): string {
  if (v >= 75) return 'patient is reachable and has attended reliably in the past'
  if (v >= 50) return 'patient is reachable, attendance history is mixed'
  if (v >= 25) return 'limited reachability or a history of missed appointments'
  return 'patient is hard to reach or has opted out of contact'
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'SAR',
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Engagement composite used by every detector, so "engagement" means the same
 * thing across categories.
 */
export function computeEngagement(input: {
  contactable: boolean
  consentMarketing: boolean
  hasPhone: boolean
  totalAppointments: number
  noShows: number
}): number {
  if (!input.contactable) return 5
  let score = 50
  if (input.hasPhone) score += 20
  if (input.consentMarketing) score += 10
  if (input.totalAppointments > 0) {
    const showRate = 1 - input.noShows / input.totalAppointments
    score += (showRate - 0.5) * 40
  }
  return clamp(score)
}
