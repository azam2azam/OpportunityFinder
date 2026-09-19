import type { PrismaClient } from '@prisma/client'
import { loadContext, availabilityFor, type DetectionContext } from './context'
import { DETECTORS } from './detectors'
import { RULE_CATALOGUE, RULE_BY_KEY } from './rules'
import type { DetectedCandidate, DetectionStats, RuleParams, RuleRuntime } from './types'
import { DAY_MS } from './types'
import {
  scoreOpportunity,
  DEFAULT_THRESHOLDS,
  type PriorityThresholds,
  type RawFactors,
  type WeightMap,
} from '../scoring'
import { isTerminal } from '../enums'

/**
 * Detection run orchestration.
 *
 * DATA -> INSIGHT -> OPPORTUNITY -> PRIORITY happens here: detectors turn
 * source records into candidates, the scoring engine turns candidates into
 * prioritised opportunities, and this module reconciles them against what is
 * already in the pipeline.
 *
 * Reconciliation is the part that matters operationally. A detection run is
 * not a rebuild — opportunities people are actively working must survive it
 * with their status, owner and action history intact, while their score and
 * narrative refresh against the latest data. Three outcomes per candidate:
 *
 *   created    — no opportunity with this dedupe key exists
 *   updated    — an open opportunity exists; refresh score, keep the workflow
 *   suppressed — a closed/converted/rejected opportunity exists; do not
 *                resurrect work a human already dispositioned
 */

export interface RunOptions {
  asOf?: Date
  triggeredBy: string
  /** Restrict the run to these rule keys; omit to run every enabled rule. */
  ruleKeys?: string[]
  /** Restrict to one hospital (used by hospital-scoped manual runs). */
  hospitalId?: string
}

export interface RunResult {
  runId: string
  stats: DetectionStats[]
  totals: { created: number; updated: number; suppressed: number; durationMs: number }
}

export async function runDetection(
  prisma: PrismaClient,
  options: RunOptions
): Promise<RunResult> {
  const asOf = options.asOf ?? new Date()
  const started = Date.now()

  const run = await prisma.detectionRun.create({
    data: { triggeredBy: options.triggeredBy, status: 'RUNNING', startedAt: asOf },
  })

  try {
    const [ctx, rules, scoringModel] = await Promise.all([
      loadContext(prisma, asOf),
      prisma.opportunityRule.findMany({ where: { enabled: true } }),
      prisma.scoringModel.findFirst({ where: { isActive: true }, include: { weights: true } }),
    ])

    const weights: WeightMap = Object.fromEntries(
      (scoringModel?.weights ?? []).map((w) => [w.factor, w.weight])
    )
    const thresholds = parseThresholds(scoringModel?.thresholds)

    // Existing pipeline, keyed by dedupeKey, so reconciliation is one lookup
    // per candidate instead of one query per candidate.
    const existing = new Map(
      (
        await prisma.opportunity.findMany({
          select: { id: true, dedupeKey: true, status: true, ownerUserId: true },
        })
      ).map((o) => [o.dedupeKey, o])
    )

    let sequence = await prisma.opportunity.count()
    const stats: DetectionStats[] = []

    for (const rule of rules) {
      if (options.ruleKeys && !options.ruleKeys.includes(rule.key)) continue
      const detector = DETECTORS[rule.key]
      if (!detector) {
        // A rule row with no implementation is a deployment mismatch, not a
        // silent no-op — surface it rather than skipping quietly.
        console.warn(`[detection] no detector registered for rule ${rule.key}`)
        continue
      }

      const ruleStart = Date.now()
      const runtime = toRuntime(rule)
      let candidates: DetectedCandidate[] = []
      try {
        candidates = detector(ctx, runtime)
      } catch (err) {
        console.error(`[detection] rule ${rule.key} failed`, err)
        stats.push({
          ruleKey: rule.key,
          scanned: 0,
          created: 0,
          updated: 0,
          suppressed: 0,
          durationMs: Date.now() - ruleStart,
        })
        continue
      }

      if (options.hospitalId) {
        candidates = candidates.filter((c) => c.hospitalId === options.hospitalId)
      }

      // A dedupe key is the identity of a finding, so a rule emitting it twice
      // in one pass describes one opportunity seen from two source rows — a
      // patient holding two prescriptions for the same medication, say. Keep
      // the strongest and drop the rest, rather than writing the same key twice.
      candidates = collapseByKey(candidates)

      let created = 0
      let updated = 0
      let suppressed = 0

      for (const candidate of candidates) {
        const prior = existing.get(candidate.dedupeKey)
        if (prior && isTerminal(prior.status)) {
          suppressed++
          continue
        }

        const scored = scoreCandidate(ctx, candidate, runtime, weights, thresholds)

        if (prior) {
          await prisma.opportunity.update({
            where: { id: prior.id },
            data: {
              // Refresh the assessment; leave status, owner and history alone.
              title: candidate.title,
              detectionReason: scored.reasonText,
              score: scored.score,
              priority: scored.priority,
              confidence: candidate.confidence,
              potentialValue: candidate.potentialValue,
              clinicalUrgency: Math.round(candidate.clinicalUrgency),
              conversionProbability: candidate.conversionProbability,
              scoreBreakdown: JSON.stringify(scored.breakdown),
              evidence: JSON.stringify(candidate.evidence),
              recommendedAction: candidate.recommendedAction,
              scoringModelId: scoringModel?.id,
            },
          })
          updated++
        } else {
          sequence++
          const createdRow = await prisma.opportunity.create({
            data: {
              reference: `OPP-${String(sequence).padStart(6, '0')}`,
              ruleId: rule.id,
              category: rule.category,
              title: candidate.title,
              detectionReason: scored.reasonText,
              patientId: candidate.patientId,
              hospitalId: candidate.hospitalId,
              departmentId: candidate.departmentId,
              specialtyId: candidate.specialtyId,
              physicianId: candidate.physicianId,
              detectedAt: asOf,
              status: 'DETECTED',
              priority: scored.priority,
              score: scored.score,
              confidence: candidate.confidence,
              potentialValue: candidate.potentialValue,
              clinicalUrgency: Math.round(candidate.clinicalUrgency),
              conversionProbability: candidate.conversionProbability,
              scoringModelId: scoringModel?.id,
              scoreBreakdown: JSON.stringify(scored.breakdown),
              evidence: JSON.stringify(candidate.evidence),
              recommendedAction: candidate.recommendedAction,
              recommendedChannel: candidate.recommendedChannel,
              ownerTeam: rule.defaultOwnerRole,
              slaDueAt: new Date(asOf.getTime() + rule.slaDays * DAY_MS),
              dedupeKey: candidate.dedupeKey,
            },
          })
          existing.set(candidate.dedupeKey, {
            id: createdRow.id,
            dedupeKey: candidate.dedupeKey,
            status: 'DETECTED',
            ownerUserId: null,
          })
          created++
        }
      }

      stats.push({
        ruleKey: rule.key,
        scanned: candidates.length,
        created,
        updated,
        suppressed,
        durationMs: Date.now() - ruleStart,
      })
    }

    const totals = stats.reduce(
      (acc, s) => ({
        created: acc.created + s.created,
        updated: acc.updated + s.updated,
        suppressed: acc.suppressed + s.suppressed,
        durationMs: Date.now() - started,
      }),
      { created: 0, updated: 0, suppressed: 0, durationMs: 0 }
    )

    await prisma.detectionRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: 'COMPLETED',
        stats: JSON.stringify({ rules: stats, totals }),
      },
    })

    return { runId: run.id, stats, totals }
  } catch (err) {
    await prisma.detectionRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
      },
    })
    throw err
  }
}

/**
 * Turns a candidate's rule-specific signals plus the patient's own context into
 * the nine scoring factors, then scores them.
 *
 * Aggregate opportunities (service-line rules) have no patient, so the
 * patient-derived factors fall back to neutral values rather than zero — a
 * missing patient must not read as a disengaged one.
 */
function scoreCandidate(
  ctx: DetectionContext,
  candidate: DetectedCandidate,
  rule: RuleRuntime,
  weights: WeightMap,
  thresholds: PriorityThresholds
) {
  const patient = candidate.patientId ? ctx.patientById.get(candidate.patientId) : undefined

  const raw: RawFactors = {
    clinicalUrgency: candidate.clinicalUrgency,
    conversionProbability: candidate.conversionProbability,
    financialValue: candidate.potentialValue,
    daysOverdue: candidate.daysOverdue,
    patientEngagement: patient?.engagement ?? 60,
    priorEncounters: patient?.priorEncounters ?? 0,
    serviceAvailability: availabilityFor(ctx, candidate.hospitalId, candidate.specialtyId),
    insuranceStatus: patient?.insuranceStatus ?? 'UNKNOWN',
    distanceKm: patient?.distanceKm ?? 15,
  }

  const result = scoreOpportunity(raw, weights, thresholds, candidate.minimumPriority ?? null)

  // The stored narrative is the detector's observation followed by the scoring
  // rationale, so "why is this high priority?" is answerable from the record
  // alone without re-running anything.
  const reasonText = [
    candidate.detectionReason,
    '',
    `Scored ${result.score} of 100 — ${result.priority} priority. Contributing factors:`,
    ...result.reasons.map((r) => `• ${r}`),
    result.priorityOverride ? `• ${result.priorityOverride}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    score: result.score,
    priority: result.priority,
    breakdown: result.breakdown,
    reasonText,
  }
}

/**
 * Collapses candidates sharing a dedupe key, keeping the most urgent one.
 * Ranking by clinical urgency first and value second means the survivor is the
 * one a clinician would want to see, not whichever row the detector happened to
 * visit first.
 */
function collapseByKey(candidates: DetectedCandidate[]): DetectedCandidate[] {
  const best = new Map<string, DetectedCandidate>()
  for (const c of candidates) {
    const prior = best.get(c.dedupeKey)
    if (
      !prior ||
      c.clinicalUrgency > prior.clinicalUrgency ||
      (c.clinicalUrgency === prior.clinicalUrgency && c.potentialValue > prior.potentialValue)
    ) {
      best.set(c.dedupeKey, c)
    }
  }
  return [...best.values()]
}

function toRuntime(rule: {
  id: string
  key: string
  category: string
  name: string
  params: string
  clinicalUrgency: number
  slaDays: number
  defaultOwnerRole: string
  recommendedAction: string
}): RuleRuntime {
  // Stored params override catalogue defaults; anything the administrator has
  // not touched keeps the shipped value, so adding a new parameter to the
  // catalogue does not break existing rule rows.
  const defaults = RULE_BY_KEY[rule.key]?.defaultParams ?? {}
  let stored: RuleParams = {}
  try {
    stored = JSON.parse(rule.params) as RuleParams
  } catch {
    console.warn(`[detection] rule ${rule.key} has unparseable params; using defaults`)
  }
  return {
    id: rule.id,
    key: rule.key,
    category: rule.category,
    name: rule.name,
    params: { ...defaults, ...stored },
    clinicalUrgency: rule.clinicalUrgency,
    slaDays: rule.slaDays,
    defaultOwnerRole: rule.defaultOwnerRole,
    recommendedAction: rule.recommendedAction,
  }
}

function parseThresholds(raw: string | undefined): PriorityThresholds {
  if (!raw) return DEFAULT_THRESHOLDS
  try {
    const parsed = JSON.parse(raw) as Partial<PriorityThresholds>
    return {
      CRITICAL: parsed.CRITICAL ?? DEFAULT_THRESHOLDS.CRITICAL,
      HIGH: parsed.HIGH ?? DEFAULT_THRESHOLDS.HIGH,
      MEDIUM: parsed.MEDIUM ?? DEFAULT_THRESHOLDS.MEDIUM,
    }
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

/** Seeds or repairs the rule table from the catalogue, preserving edited params. */
export async function syncRuleCatalogue(prisma: PrismaClient): Promise<number> {
  let written = 0
  for (const def of RULE_CATALOGUE) {
    const existing = await prisma.opportunityRule.findUnique({ where: { key: def.key } })
    if (existing) continue
    await prisma.opportunityRule.create({
      data: {
        key: def.key,
        name: def.name,
        category: def.category,
        description: def.description,
        params: JSON.stringify(def.defaultParams),
        clinicalUrgency: def.clinicalUrgency,
        slaDays: def.slaDays,
        defaultOwnerRole: def.defaultOwnerRole,
        recommendedAction: def.recommendedAction,
      },
    })
    written++
  }
  return written
}

export { RULE_CATALOGUE, RULE_BY_KEY }
