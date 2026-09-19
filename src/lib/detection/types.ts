import type { Priority } from '../enums'

/**
 * Shared types for the opportunity detection engine.
 *
 * A detector is a pure function over a preloaded snapshot: it never queries the
 * database itself. That keeps a full detection run to a fixed set of reads
 * (see loadContext), makes every rule unit-testable against a hand-built
 * snapshot, and means adding a rule cannot quietly add N+1 queries.
 */

export interface DetectedCandidate {
  /**
   * Stable identity for this finding. Re-running detection must update the
   * existing opportunity rather than create a duplicate, so the key has to be
   * derived from the source records — never from the run or the clock.
   */
  dedupeKey: string
  title: string
  /** Plain-language narrative of what was observed. Shown verbatim in the UI. */
  detectionReason: string

  patientId?: string
  hospitalId: string
  departmentId?: string
  specialtyId?: string
  physicianId?: string

  potentialValue: number
  /** 0..100, overrides the rule's baseline when the evidence warrants it. */
  clinicalUrgency: number
  /** 0..1 */
  conversionProbability: number
  /** Days past the point at which action was due. */
  daysOverdue: number
  /** 0..1 confidence in the signal itself (data completeness, inference depth). */
  confidence: number
  /** Clinical-safety floor; the banded priority can be raised to this, never lowered. */
  minimumPriority?: Priority
  recommendedAction: string
  recommendedChannel: string
  /** Source record ids and values, rendered on the opportunity's evidence tab. */
  evidence: Record<string, unknown>
}

export interface RuleParams {
  [key: string]: number | string | boolean | string[]
}

export interface RuleDefinition {
  key: string
  name: string
  category: string
  description: string
  /** Default parameter bag; the stored rule's params override these at runtime. */
  defaultParams: RuleParams
  clinicalUrgency: number
  slaDays: number
  defaultOwnerRole: string
  recommendedAction: string
  /** Documentation of each parameter, rendered on the rule editor. */
  paramDocs: Record<string, string>
}

export interface RuleRuntime {
  id: string
  key: string
  category: string
  name: string
  params: RuleParams
  clinicalUrgency: number
  slaDays: number
  defaultOwnerRole: string
  recommendedAction: string
}

export interface DetectionStats {
  ruleKey: string
  scanned: number
  created: number
  updated: number
  /** Suppressed = candidate found, but an open opportunity already covers it. */
  suppressed: number
  durationMs: number
}

export function num(params: RuleParams, key: string, fallback: number): number {
  const v = params[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function bool(params: RuleParams, key: string, fallback: boolean): boolean {
  const v = params[key]
  return typeof v === 'boolean' ? v : fallback
}

export function list(params: RuleParams, key: string, fallback: string[]): string[] {
  const v = params[key]
  return Array.isArray(v) ? v : fallback
}

export const DAY_MS = 86_400_000

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS)
}
