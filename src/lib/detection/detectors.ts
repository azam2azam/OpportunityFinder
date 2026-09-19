import type { DetectionContext, PatientSnapshot } from './context'
import { availabilityFor } from './context'
import { type DetectedCandidate, type RuleRuntime, num, bool, list, daysBetween, DAY_MS } from './types'

/**
 * Rule implementations.
 *
 * Contract every detector follows:
 *   - Read thresholds from `rule.params`, never from literals. The catalogue's
 *     defaults are merged in before the detector runs.
 *   - Build `dedupeKey` from source record ids so a re-run updates rather than
 *     duplicates.
 *   - Write `detectionReason` as a sentence a director can read without
 *     training, quoting the actual numbers involved.
 *   - Put the underlying record ids and values in `evidence` so the finding can
 *     be traced back to VIDA.
 *
 * Detectors never write to the database and never call the clock — `ctx.asOf`
 * is the only source of "now".
 */

export type Detector = (ctx: DetectionContext, rule: RuleRuntime) => DetectedCandidate[]

// ── shared helpers ──────────────────────────────────────────────────────

/** Patients excluded from all outreach: deceased, or opted out of contact. */
function isContactableSubject(p: PatientSnapshot): boolean {
  return !p.isDeceased && p.contactable
}

function hasEncounterAfter(p: PatientSnapshot, after: Date, specialtyId?: string): boolean {
  return p.encounters.some(
    (e) =>
      e.startedAt > after &&
      e.status === 'COMPLETED' &&
      (!specialtyId || e.specialtyId === specialtyId)
  )
}

function lastEncounter(p: PatientSnapshot) {
  return p.encounters.length ? p.encounters[p.encounters.length - 1] : null
}

function within(ctx: DetectionContext, date: Date, lookbackDays: number): boolean {
  return date >= new Date(ctx.asOf.getTime() - lookbackDays * DAY_MS)
}

/**
 * Baseline conversion probability, adjusted by the patient's own history.
 * Detectors start from a per-category base rate and let this modulate it, so
 * two patients with identical clinical findings but different engagement are
 * prioritised differently.
 */
function conversionFor(p: PatientSnapshot, base: number): number {
  let prob = base
  prob *= 0.6 + (p.engagement / 100) * 0.7
  if (p.priorEncounters >= 4) prob *= 1.12
  if (p.distanceKm > 60) prob *= 0.85
  if (!p.consentMarketing) prob *= 0.7
  return Math.max(0.02, Math.min(0.95, prob))
}

function personName(p: PatientSnapshot): string {
  return `${p.firstName} ${p.lastName}`
}

// ── LABORATORY ──────────────────────────────────────────────────────────

const labAbnormalNoFollowUp: Detector = (ctx, rule) => {
  const windowDays = num(rule.params, 'followUpWindowDays', 30)
  const lookback = num(rule.params, 'lookbackDays', 365)
  const flags = list(rule.params, 'flags', ['HIGH', 'LOW', 'CRITICAL_HIGH', 'CRITICAL_LOW'])
  const value = num(rule.params, 'minPotentialValue', 280)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    // Only the most recent abnormal result per test matters: an older abnormal
    // followed by a newer one is the same clinical thread, and raising both
    // would put the same patient in the queue twice for one problem.
    const latestByTest = new Map<string, (typeof p.labs)[number]>()
    for (const lab of p.labs) {
      if (lab.isPending || !flags.includes(lab.flag)) continue
      if (!within(ctx, lab.resultedAt, lookback)) continue
      const prev = latestByTest.get(lab.loincCode)
      if (!prev || lab.resultedAt > prev.resultedAt) latestByTest.set(lab.loincCode, lab)
    }

    for (const lab of latestByTest.values()) {
      const due = new Date(lab.resultedAt.getTime() + windowDays * DAY_MS)
      if (ctx.asOf < due) continue
      if (hasEncounterAfter(p, lab.resultedAt)) continue

      const critical = lab.flag.startsWith('CRITICAL')
      const daysOverdue = daysBetween(ctx.asOf, due)
      const enc = p.encounters.find((e) => e.id === lab.encounterId) ?? lastEncounter(p)
      const specialtyId = enc?.specialtyId
      out.push({
        dedupeKey: `${rule.key}:${lab.id}`,
        title: `${lab.testName} abnormal — no follow-up`,
        detectionReason:
          `${lab.testName} resulted ${lab.flag.replace('_', ' ').toLowerCase()} at ${lab.value ?? '—'} ${lab.unit} ` +
          `on ${fmtDate(lab.resultedAt)} (reference ${lab.refLow ?? '—'}–${lab.refHigh ?? '—'} ${lab.unit}). ` +
          `The review window of ${windowDays} days closed ${daysOverdue} days ago and no clinical encounter has been recorded since the result.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: enc?.departmentId,
        specialtyId,
        physicianId: enc?.physicianId ?? p.primaryPhysicianId ?? undefined,
        potentialValue: value,
        clinicalUrgency: critical ? 94 : rule.clinicalUrgency,
        conversionProbability: conversionFor(p, critical ? 0.62 : 0.48),
        daysOverdue,
        confidence: 0.92,
        minimumPriority: critical ? 'CRITICAL' : undefined,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          labResultId: lab.id,
          test: lab.testName,
          loinc: lab.loincCode,
          value: lab.value,
          unit: lab.unit,
          flag: lab.flag,
          referenceRange: [lab.refLow, lab.refHigh],
          resultedAt: lab.resultedAt,
          reviewDueAt: due,
          encountersSinceResult: 0,
        },
      })
    }
  }
  return out
}

const labCriticalUnactioned: Detector = (ctx, rule) => {
  const safetyDays = num(rule.params, 'safetyWindowDays', 7)
  const lookback = num(rule.params, 'lookbackDays', 180)
  const value = num(rule.params, 'minPotentialValue', 400)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (p.isDeceased) continue
    for (const lab of p.labs) {
      if (!lab.flag.startsWith('CRITICAL') || lab.isPending) continue
      if (!within(ctx, lab.resultedAt, lookback)) continue
      const due = new Date(lab.resultedAt.getTime() + safetyDays * DAY_MS)
      if (ctx.asOf < due) continue
      if (hasEncounterAfter(p, lab.resultedAt)) continue

      const enc = p.encounters.find((e) => e.id === lab.encounterId) ?? lastEncounter(p)
      out.push({
        dedupeKey: `${rule.key}:${lab.id}`,
        title: `Critical ${lab.testName} not acted on`,
        detectionReason:
          `${lab.testName} returned a critical value of ${lab.value ?? '—'} ${lab.unit} on ${fmtDate(lab.resultedAt)}. ` +
          `No clinical encounter has been recorded in the ${safetyDays}-day safety window. ` +
          `This is a patient-safety escalation, not a growth opportunity.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: enc?.departmentId,
        specialtyId: enc?.specialtyId,
        physicianId: enc?.physicianId ?? p.primaryPhysicianId ?? undefined,
        potentialValue: value,
        clinicalUrgency: 98,
        conversionProbability: conversionFor(p, 0.7),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.96,
        minimumPriority: 'CRITICAL',
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          labResultId: lab.id,
          test: lab.testName,
          value: lab.value,
          unit: lab.unit,
          flag: lab.flag,
          resultedAt: lab.resultedAt,
          safetyWindowDays: safetyDays,
        },
      })
    }
  }
  return out
}

const labPendingOrder: Detector = (ctx, rule) => {
  const pendingDays = num(rule.params, 'pendingDays', 14)
  const lookback = num(rule.params, 'lookbackDays', 180)
  const value = num(rule.params, 'minPotentialValue', 180)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const lab of p.labs) {
      if (!lab.isPending) continue
      if (!within(ctx, lab.orderedAt, lookback)) continue
      const due = new Date(lab.orderedAt.getTime() + pendingDays * DAY_MS)
      if (ctx.asOf < due) continue

      const enc = p.encounters.find((e) => e.id === lab.encounterId) ?? lastEncounter(p)
      out.push({
        dedupeKey: `${rule.key}:${lab.id}`,
        title: `${lab.testName} ordered but never resulted`,
        detectionReason:
          `${lab.testName} was ordered on ${fmtDate(lab.orderedAt)} and no result has been filed ` +
          `${daysBetween(ctx.asOf, lab.orderedAt)} days later. The expected turnaround is ${pendingDays} days, ` +
          `so the patient most likely did not attend for collection.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: enc?.departmentId,
        specialtyId: enc?.specialtyId,
        physicianId: enc?.physicianId ?? p.primaryPhysicianId ?? undefined,
        potentialValue: value,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.55),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.85,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          labResultId: lab.id,
          test: lab.testName,
          orderedAt: lab.orderedAt,
          expectedTurnaroundDays: pendingDays,
        },
      })
    }
  }
  return out
}

const labRecurringLapsed: Detector = (ctx, rule) => {
  const grace = num(rule.params, 'graceDays', 30)
  const lookback = num(rule.params, 'lookbackDays', 730)
  const maxLapse = num(rule.params, 'maxLapseDays', 540)
  const requireChronic = bool(rule.params, 'requireChronicContext', true)
  const minPriorResults = num(rule.params, 'minPriorResults', 2)
  const value = num(rule.params, 'minPotentialValue', 220)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue

    // A repeat interval on a result only means "recall this patient" when the
    // monitoring is clinically indicated. Without this gate the rule fires on
    // every incidental panel ever ordered and buries the pipeline in recalls
    // no clinician asked for.
    if (requireChronic) {
      const hasChronicContext =
        p.diagnoses.some((d) => d.isChronic) ||
        p.prescriptions.some((r) => r.isChronic && r.status === 'ACTIVE')
      if (!hasChronicContext) continue
    }

    // One opportunity per panel, not per analyte: a lapsed renal panel is one
    // recall for one blood draw, not three separate pieces of work.
    const latestByPanel = new Map<string, (typeof p.labs)[number]>()
    const countByPanel = new Map<string, number>()
    for (const lab of p.labs) {
      if (lab.isPending || !lab.repeatIntervalDays) continue
      if (!within(ctx, lab.resultedAt, lookback)) continue
      countByPanel.set(lab.panel, (countByPanel.get(lab.panel) ?? 0) + 1)
      const prev = latestByPanel.get(lab.panel)
      if (!prev || lab.resultedAt > prev.resultedAt) latestByPanel.set(lab.panel, lab)
    }

    for (const lab of latestByPanel.values()) {
      // "Recurring" is the whole premise of the rule: without an established
      // repeat history there is no cycle to have lapsed, only a single old
      // result that a clinician never intended to repeat.
      if ((countByPanel.get(lab.panel) ?? 0) < minPriorResults) continue
      const interval = lab.repeatIntervalDays as number
      const due = new Date(lab.resultedAt.getTime() + (interval + grace) * DAY_MS)
      if (ctx.asOf < due) continue
      const overdue = daysBetween(ctx.asOf, due)
      // Past this point the problem is that the patient has disengaged
      // entirely, which the reactivation rules own. Raising both would put the
      // same person in two queues for the same underlying reason.
      if (overdue > maxLapse) continue

      const enc = p.encounters.find((e) => e.id === lab.encounterId) ?? lastEncounter(p)
      out.push({
        dedupeKey: `${rule.key}:${p.id}:${lab.panel}`,
        title: `${lab.panel} monitoring lapsed`,
        detectionReason:
          `${lab.testName} (${lab.panel} panel) is on a ${interval}-day monitoring cycle for this patient. ` +
          `The last result was ${fmtDate(lab.resultedAt)} — ${daysBetween(ctx.asOf, lab.resultedAt)} days ago — ` +
          `putting the repeat ${overdue} days past its ${grace}-day grace period.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: enc?.departmentId,
        specialtyId: enc?.specialtyId,
        physicianId: enc?.physicianId ?? p.primaryPhysicianId ?? undefined,
        potentialValue: value,
        clinicalUrgency: rule.clinicalUrgency + (lab.flag !== 'NORMAL' ? 12 : 0),
        conversionProbability: conversionFor(p, 0.5),
        daysOverdue: overdue,
        confidence: 0.88,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          labResultId: lab.id,
          panel: lab.panel,
          test: lab.testName,
          repeatIntervalDays: interval,
          lastResultedAt: lab.resultedAt,
          lastFlag: lab.flag,
          graceDays: grace,
        },
      })
    }
  }
  return out
}

const labNoPhysicianReturn: Detector = (ctx, rule) => {
  const returnDays = num(rule.params, 'returnWindowDays', 21)
  const lookback = num(rule.params, 'lookbackDays', 270)
  const value = num(rule.params, 'minPotentialValue', 260)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    // Group by the ordering encounter so one lab panel produces one
    // opportunity, not one per analyte.
    const byEncounter = new Map<string, (typeof p.labs)[number][]>()
    for (const lab of p.labs) {
      if (lab.isPending || !lab.encounterId) continue
      if (!within(ctx, lab.resultedAt, lookback)) continue
      const arr = byEncounter.get(lab.encounterId)
      if (arr) arr.push(lab)
      else byEncounter.set(lab.encounterId, [lab])
    }

    for (const [encounterId, labs] of byEncounter) {
      const latest = labs.reduce((a, b) => (a.resultedAt > b.resultedAt ? a : b))
      const due = new Date(latest.resultedAt.getTime() + returnDays * DAY_MS)
      if (ctx.asOf < due) continue
      if (hasEncounterAfter(p, latest.resultedAt)) continue
      // An abnormal result is already covered by LAB_ABNORMAL_NO_FOLLOWUP;
      // this rule exists for the normal-result case where nobody is chasing.
      if (labs.some((l) => l.flag !== 'NORMAL')) continue

      const enc = p.encounters.find((e) => e.id === encounterId)
      out.push({
        dedupeKey: `${rule.key}:${encounterId}`,
        title: `Laboratory completed, review consultation never booked`,
        detectionReason:
          `${labs.length} investigation${labs.length > 1 ? 's' : ''} (${labs.map((l) => l.testName).slice(0, 3).join(', ')}) ` +
          `resulted on ${fmtDate(latest.resultedAt)}. The patient has not returned to a physician in the ` +
          `${returnDays} days since, so the episode of care is open with results unreviewed.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: enc?.departmentId,
        specialtyId: enc?.specialtyId,
        physicianId: enc?.physicianId ?? p.primaryPhysicianId ?? undefined,
        potentialValue: value,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.52),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.82,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          encounterId,
          tests: labs.map((l) => l.testName),
          resultedAt: latest.resultedAt,
          returnWindowDays: returnDays,
        },
      })
    }
  }
  return out
}

// ── SURGERY ─────────────────────────────────────────────────────────────

const surgRecommendedNotScheduled: Detector = (ctx, rule) => {
  const decisionDays = num(rule.params, 'decisionWindowDays', 30)
  const lookback = num(rule.params, 'lookbackDays', 365)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const s of p.surgeries) {
      if (!['RECOMMENDED', 'CONSULT_DONE'].includes(s.status)) continue
      if (s.scheduledFor || s.performedAt) continue
      if (!within(ctx, s.recommendedAt, lookback)) continue
      const due = new Date(s.recommendedAt.getTime() + decisionDays * DAY_MS)
      if (ctx.asOf < due) continue

      const overdue = daysBetween(ctx.asOf, due)
      out.push({
        dedupeKey: `${rule.key}:${s.id}`,
        title: `${s.description} recommended, not booked`,
        detectionReason:
          `${s.description} (${s.cptCode}) was recommended on ${fmtDate(s.recommendedAt)} by ` +
          `${ctx.physicianNames.get(s.physicianId) ?? 'the surgical team'}. No procedure has been booked in the ` +
          `${daysBetween(ctx.asOf, s.recommendedAt)} days since — ${overdue} days past the ${decisionDays}-day decision window.`,
        patientId: p.id,
        hospitalId: s.hospitalId,
        departmentId: ctx.physicianDepartment.get(s.physicianId),
        specialtyId: ctx.physicianSpecialty.get(s.physicianId),
        physicianId: s.physicianId,
        potentialValue: s.estimatedValue,
        clinicalUrgency: s.urgency === 'URGENT' ? 92 : rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.42),
        daysOverdue: overdue,
        confidence: 0.9,
        minimumPriority: s.urgency === 'URGENT' ? 'HIGH' : undefined,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          surgeryId: s.id,
          cptCode: s.cptCode,
          procedure: s.description,
          recommendedAt: s.recommendedAt,
          urgency: s.urgency,
          estimatedValue: s.estimatedValue,
          decisionWindowDays: decisionDays,
        },
      })
    }
  }
  return out
}

const surgWorkupDoneNotPerformed: Detector = (ctx, rule) => {
  const staleDays = num(rule.params, 'staleDays', 45)
  const validity = num(rule.params, 'workupValidityDays', 90)
  const lookback = num(rule.params, 'lookbackDays', 365)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const s of p.surgeries) {
      if (!s.workupComplete || s.performedAt) continue
      if (s.status === 'CANCELLED') continue
      if (!within(ctx, s.recommendedAt, lookback)) continue
      const due = new Date(s.recommendedAt.getTime() + staleDays * DAY_MS)
      if (ctx.asOf < due) continue

      const ageDays = daysBetween(ctx.asOf, s.recommendedAt)
      const expiring = ageDays > validity * 0.8
      out.push({
        dedupeKey: `${rule.key}:${s.id}`,
        title: `Pre-operative workup complete, ${s.description} not performed`,
        detectionReason:
          `Pre-operative assessment for ${s.description} was completed and the procedure has not been performed. ` +
          `The workup is ${ageDays} days old against a ${validity}-day validity period` +
          (expiring
            ? ', so it is close to expiry and would have to be repeated at the hospital’s cost.'
            : '.'),
        patientId: p.id,
        hospitalId: s.hospitalId,
        departmentId: ctx.physicianDepartment.get(s.physicianId),
        specialtyId: ctx.physicianSpecialty.get(s.physicianId),
        physicianId: s.physicianId,
        potentialValue: s.estimatedValue,
        clinicalUrgency: expiring ? 88 : rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.58),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.93,
        minimumPriority: expiring ? 'HIGH' : undefined,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          surgeryId: s.id,
          procedure: s.description,
          workupAgeDays: ageDays,
          workupValidityDays: validity,
          estimatedValue: s.estimatedValue,
        },
      })
    }
  }
  return out
}

const surgCancelledNotRebooked: Detector = (ctx, rule) => {
  const rebookDays = num(rule.params, 'rebookWindowDays', 21)
  const lookback = num(rule.params, 'lookbackDays', 365)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const s of p.surgeries) {
      if (s.status !== 'CANCELLED') continue
      if (!within(ctx, s.recommendedAt, lookback)) continue
      // A later booking for the same procedure means it was rebooked.
      const rebooked = p.surgeries.some(
        (other) =>
          other.id !== s.id &&
          other.cptCode === s.cptCode &&
          other.recommendedAt > s.recommendedAt &&
          ['SCHEDULED', 'PERFORMED'].includes(other.status)
      )
      if (rebooked) continue
      const due = new Date(s.recommendedAt.getTime() + rebookDays * DAY_MS)
      if (ctx.asOf < due) continue

      out.push({
        dedupeKey: `${rule.key}:${s.id}`,
        title: `Cancelled ${s.description} never rebooked`,
        detectionReason:
          `${s.description} was cancelled${s.cancelReason ? ` (${s.cancelReason})` : ''} and no replacement booking ` +
          `exists ${daysBetween(ctx.asOf, s.recommendedAt)} days later, past the ${rebookDays}-day rebooking window.`,
        patientId: p.id,
        hospitalId: s.hospitalId,
        departmentId: ctx.physicianDepartment.get(s.physicianId),
        specialtyId: ctx.physicianSpecialty.get(s.physicianId),
        physicianId: s.physicianId,
        potentialValue: s.estimatedValue,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.5),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.89,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          surgeryId: s.id,
          procedure: s.description,
          cancelReason: s.cancelReason,
          estimatedValue: s.estimatedValue,
        },
      })
    }
  }
  return out
}

const surgConsultPatientInactive: Detector = (ctx, rule) => {
  const inactiveDays = num(rule.params, 'inactiveDays', 90)
  const lookback = num(rule.params, 'lookbackDays', 540)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const s of p.surgeries) {
      if (s.status !== 'CONSULT_DONE' || s.performedAt) continue
      if (!within(ctx, s.recommendedAt, lookback)) continue
      if (hasEncounterAfter(p, s.recommendedAt)) continue
      const idle = daysBetween(ctx.asOf, s.recommendedAt)
      if (idle < inactiveDays) continue

      out.push({
        dedupeKey: `${rule.key}:${s.id}`,
        title: `Surgical consultation then no further contact`,
        detectionReason:
          `The patient attended a surgical consultation for ${s.description} on ${fmtDate(s.recommendedAt)} ` +
          `and has had no encounter with the group in the ${idle} days since. ` +
          `The case appears lost rather than clinically declined.`,
        patientId: p.id,
        hospitalId: s.hospitalId,
        departmentId: ctx.physicianDepartment.get(s.physicianId),
        specialtyId: ctx.physicianSpecialty.get(s.physicianId),
        physicianId: s.physicianId,
        potentialValue: s.estimatedValue * 0.7,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.3),
        daysOverdue: idle - inactiveDays,
        confidence: 0.76,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          surgeryId: s.id,
          procedure: s.description,
          consultAt: s.recommendedAt,
          inactiveDays: idle,
        },
      })
    }
  }
  return out
}

// ── MEDICATION ──────────────────────────────────────────────────────────

/** Most recent dispense per medication for one patient. */
function latestDispenses(p: PatientSnapshot) {
  const m = new Map<string, (typeof p.pharmacyTxns)[number]>()
  for (const t of p.pharmacyTxns) {
    const prev = m.get(t.medicationId)
    if (!prev || t.dispensedAt > prev.dispensedAt) m.set(t.medicationId, t)
  }
  return m
}

const medRefillOverdue: Detector = (ctx, rule) => {
  const grace = num(rule.params, 'graceDays', 10)
  const lookback = num(rule.params, 'lookbackDays', 365)
  const chronicOnly = bool(rule.params, 'chronicOnly', true)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    const latest = latestDispenses(p)
    for (const rx of p.prescriptions) {
      if (rx.status !== 'ACTIVE') continue
      if (chronicOnly && !rx.isChronic) continue
      const last = latest.get(rx.medicationId)
      if (!last || !within(ctx, last.dispensedAt, lookback)) continue

      const runsOut = new Date(last.dispensedAt.getTime() + last.daysSupply * DAY_MS)
      const due = new Date(runsOut.getTime() + grace * DAY_MS)
      if (ctx.asOf < due) continue
      const gap = daysBetween(ctx.asOf, last.dispensedAt)
      // Beyond the abandonment threshold this is a different problem; let
      // MED_REFILL_ABANDONED own it so the patient is not queued twice.
      if (gap >= 90) continue

      out.push({
        dedupeKey: `${rule.key}:${p.id}:${rx.medicationId}`,
        title: `${rx.medicationName} refill overdue`,
        detectionReason:
          `${rx.medicationName} was last dispensed on ${fmtDate(last.dispensedAt)} with ${last.daysSupply} days of supply, ` +
          `which ran out on ${fmtDate(runsOut)}. No refill has been collected in the ` +
          `${daysBetween(ctx.asOf, runsOut)} days since, past the ${grace}-day grace period.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: ctx.physicianDepartment.get(rx.physicianId),
        specialtyId: ctx.physicianSpecialty.get(rx.physicianId),
        physicianId: rx.physicianId,
        potentialValue: rx.unitPrice * Math.max(30, rx.daysSupply),
        clinicalUrgency: rx.isHighRisk ? 84 : rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.64),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.9,
        minimumPriority: rx.isHighRisk ? 'HIGH' : undefined,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          prescriptionId: rx.id,
          medication: rx.medicationName,
          lastDispensedAt: last.dispensedAt,
          daysSupply: last.daysSupply,
          supplyExhaustedAt: runsOut,
          isHighRisk: rx.isHighRisk,
        },
      })
    }
  }
  return out
}

const medRefillAbandoned: Detector = (ctx, rule) => {
  const abandonDays = num(rule.params, 'abandonmentDays', 90)
  const minRefills = num(rule.params, 'minPriorRefills', 3)
  const lookback = num(rule.params, 'lookbackDays', 540)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    const byMed = new Map<string, (typeof p.pharmacyTxns)[number][]>()
    for (const t of p.pharmacyTxns) {
      if (!within(ctx, t.dispensedAt, lookback)) continue
      const arr = byMed.get(t.medicationId)
      if (arr) arr.push(t)
      else byMed.set(t.medicationId, [t])
    }

    for (const [medicationId, txns] of byMed) {
      if (txns.length < minRefills) continue
      const last = txns[txns.length - 1]
      const gap = daysBetween(ctx.asOf, last.dispensedAt)
      if (gap < abandonDays) continue

      // The established cadence is the median interval between the patient's
      // own refills — the point of the rule is the break from *their* pattern,
      // not from a population average.
      const intervals: number[] = []
      for (let i = 1; i < txns.length; i++) {
        intervals.push(daysBetween(txns[i].dispensedAt, txns[i - 1].dispensedAt))
      }
      const cadence = median(intervals)
      if (cadence <= 0) continue

      const rx = p.prescriptions.find((r) => r.medicationId === medicationId)
      out.push({
        dedupeKey: `${rule.key}:${p.id}:${medicationId}`,
        title: `${last.medicationName} — refill pattern abandoned`,
        detectionReason:
          `The patient collected ${last.medicationName} ${txns.length} times on a roughly ${Math.round(cadence)}-day cycle, ` +
          `then stopped. The last dispense was ${fmtDate(last.dispensedAt)}, ${gap} days ago — ` +
          `${Math.round(gap / cadence)}× the established interval. This reads as an interrupted course rather than a late refill.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: rx ? ctx.physicianDepartment.get(rx.physicianId) : undefined,
        specialtyId: rx ? ctx.physicianSpecialty.get(rx.physicianId) : undefined,
        physicianId: rx?.physicianId,
        potentialValue: (rx?.unitPrice ?? 4) * 90,
        clinicalUrgency: rx?.isHighRisk ? 90 : rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.4),
        daysOverdue: gap - abandonDays,
        confidence: 0.86,
        minimumPriority: rx?.isHighRisk ? 'HIGH' : undefined,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          medication: last.medicationName,
          refillCount: txns.length,
          medianIntervalDays: Math.round(cadence),
          lastDispensedAt: last.dispensedAt,
          gapDays: gap,
        },
      })
    }
  }
  return out
}

const medChronicNoReview: Detector = (ctx, rule) => {
  const reviewInterval = num(rule.params, 'reviewIntervalDays', 180)
  const lookback = num(rule.params, 'lookbackDays', 540)
  const value = num(rule.params, 'minPotentialValue', 300)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    const chronic = p.prescriptions.filter(
      (r) => r.isChronic && r.status === 'ACTIVE' && within(ctx, r.prescribedAt, lookback)
    )
    if (chronic.length === 0) continue

    const last = lastEncounter(p)
    const sinceReview = last ? daysBetween(ctx.asOf, last.startedAt) : 9999
    if (sinceReview < reviewInterval) continue

    const meds = [...new Set(chronic.map((r) => r.medicationName))]
    const primary = chronic[chronic.length - 1]
    out.push({
      dedupeKey: `${rule.key}:${p.id}`,
      title: `Chronic therapy continuing without physician review`,
      detectionReason:
        `The patient is on ${meds.length} long-term medication${meds.length > 1 ? 's' : ''} (${meds.slice(0, 3).join(', ')}) ` +
        `and was last seen by a physician ${last ? fmtDate(last.startedAt) : 'never'} — ${sinceReview} days ago, ` +
        `against a ${reviewInterval}-day review interval. Therapy is continuing unsupervised.`,
      patientId: p.id,
      hospitalId: p.hospitalId,
      departmentId: ctx.physicianDepartment.get(primary.physicianId),
      specialtyId: ctx.physicianSpecialty.get(primary.physicianId),
      physicianId: primary.physicianId,
      potentialValue: value,
      clinicalUrgency: chronic.some((r) => r.isHighRisk) ? 86 : rule.clinicalUrgency,
      conversionProbability: conversionFor(p, 0.46),
      daysOverdue: sinceReview - reviewInterval,
      confidence: 0.84,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: p.preferredChannel,
      evidence: {
        medications: meds,
        lastEncounterAt: last?.startedAt ?? null,
        daysSinceReview: sinceReview,
        reviewIntervalDays: reviewInterval,
      },
    })
  }
  return out
}

const medMonitoringDue: Detector = (ctx, rule) => {
  const interval = num(rule.params, 'monitoringIntervalDays', 120)
  const grace = num(rule.params, 'graceDays', 21)
  const recentDispenseDays = num(rule.params, 'requireRecentDispenseDays', 180)
  const value = num(rule.params, 'minPotentialValue', 240)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    const dispenses = latestDispenses(p)

    for (const rx of p.prescriptions) {
      if (!rx.requiresMonitoring || rx.status !== 'ACTIVE' || !rx.monitoringLoinc) continue

      // ACTIVE in VIDA only means nobody closed the prescription. Evidence the
      // patient is still on the drug is a recent dispense — without one, the
      // monitoring gap is theoretical and chasing it wastes the call.
      if (recentDispenseDays > 0) {
        const lastDispense = dispenses.get(rx.medicationId)
        if (!lastDispense) continue
        if (daysBetween(ctx.asOf, lastDispense.dispensedAt) > recentDispenseDays) continue
      }

      const monitoringLabs = p.labs.filter(
        (l) => l.loincCode === rx.monitoringLoinc && !l.isPending
      )
      const lastLab = monitoringLabs.length ? monitoringLabs[monitoringLabs.length - 1] : null
      const referenceDate = lastLab?.resultedAt ?? rx.prescribedAt
      const due = new Date(referenceDate.getTime() + (interval + grace) * DAY_MS)
      if (ctx.asOf < due) continue

      out.push({
        dedupeKey: `${rule.key}:${p.id}:${rx.medicationId}`,
        title: `${rx.medicationName} monitoring test overdue`,
        detectionReason:
          `${rx.medicationName} requires monitoring every ${interval} days. ` +
          (lastLab
            ? `The last monitoring test was ${fmtDate(lastLab.resultedAt)}, ${daysBetween(ctx.asOf, lastLab.resultedAt)} days ago.`
            : `No monitoring test has ever been recorded since the prescription was issued on ${fmtDate(rx.prescribedAt)}.`) +
          ` This is a medication-safety gap, not a revenue opportunity.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: ctx.physicianDepartment.get(rx.physicianId),
        specialtyId: ctx.physicianSpecialty.get(rx.physicianId),
        physicianId: rx.physicianId,
        potentialValue: value,
        clinicalUrgency: rule.clinicalUrgency + (lastLab ? 0 : 8),
        conversionProbability: conversionFor(p, 0.6),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.91,
        minimumPriority: 'HIGH',
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          prescriptionId: rx.id,
          medication: rx.medicationName,
          monitoringLoinc: rx.monitoringLoinc,
          lastMonitoredAt: lastLab?.resultedAt ?? null,
          monitoringIntervalDays: interval,
        },
      })
    }
  }
  return out
}

const medCourseIncomplete: Detector = (ctx, rule) => {
  const grace = num(rule.params, 'graceDays', 14)
  const lookback = num(rule.params, 'lookbackDays', 365)
  const value = num(rule.params, 'minPotentialValue', 160)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const rx of p.prescriptions) {
      if (!rx.courseEndsAt) continue
      if (rx.refillsUsed >= rx.refillsAuthorized) continue
      if (!within(ctx, rx.prescribedAt, lookback)) continue
      const due = new Date(rx.courseEndsAt.getTime() + grace * DAY_MS)
      if (ctx.asOf < due) continue

      const remaining = rx.refillsAuthorized - rx.refillsUsed
      out.push({
        dedupeKey: `${rule.key}:${rx.id}`,
        title: `${rx.medicationName} course left incomplete`,
        detectionReason:
          `${remaining} of ${rx.refillsAuthorized} authorised refills for ${rx.medicationName} were never collected, ` +
          `and the planned course ended ${fmtDate(rx.courseEndsAt)} — ${daysBetween(ctx.asOf, rx.courseEndsAt)} days ago. ` +
          `The prescribed treatment was not completed.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: ctx.physicianDepartment.get(rx.physicianId),
        specialtyId: ctx.physicianSpecialty.get(rx.physicianId),
        physicianId: rx.physicianId,
        potentialValue: Math.max(value, rx.unitPrice * rx.daysSupply * remaining),
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.38),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.8,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          prescriptionId: rx.id,
          medication: rx.medicationName,
          refillsAuthorized: rx.refillsAuthorized,
          refillsUsed: rx.refillsUsed,
          courseEndsAt: rx.courseEndsAt,
        },
      })
    }
  }
  return out
}

// ── INSURANCE RECOVERY ──────────────────────────────────────────────────

const insRejectionRecoverable: Detector = (ctx, rule) => {
  const minAmount = num(rule.params, 'minRejectedAmount', 200)
  const minRate = num(rule.params, 'minRecoveryRate', 0.15)
  const pathways = list(rule.params, 'pathways', [
    'RESUBMIT',
    'CORRECT_CODING',
    'OBTAIN_DOCUMENTATION',
    'APPEAL',
  ])
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    for (const claim of p.claims) {
      if (!['REJECTED', 'APPEALED'].includes(claim.status)) continue
      for (const rej of claim.rejections) {
        if (rej.rejectedAmount < minAmount) continue
        if (!rej.isAppealable) continue
        if (rej.historicalRecoveryRate < minRate) continue
        if (!rej.recommendedPathway || !pathways.includes(rej.recommendedPathway)) continue

        // The payer's resubmission window is the hard deadline; past it the
        // money is gone regardless of merit, so it drives the urgency.
        const deadline = new Date(
          rej.rejectedAt.getTime() + claim.resubmissionWindowDays * DAY_MS
        )
        const daysLeft = daysBetween(deadline, ctx.asOf)
        if (daysLeft < 0) continue

        const recoverable = rej.rejectedAmount * rej.historicalRecoveryRate
        out.push({
          dedupeKey: `${rule.key}:${rej.id}`,
          title: `Recoverable rejection — ${claim.serviceDescription}`,
          detectionReason:
            `Claim ${claim.claimNumber} for ${claim.serviceDescription} was rejected by ${claim.payerName} on ` +
            `${fmtDate(rej.rejectedAt)} for ${rej.reasonText} (${fmtMoney(rej.rejectedAmount)}). ` +
            `The recommended pathway is ${rej.recommendedPathway.replace(/_/g, ' ').toLowerCase()}, which recovers ` +
            `${Math.round(rej.historicalRecoveryRate * 100)}% of comparable rejections. ` +
            `${daysLeft} days remain in the ${claim.resubmissionWindowDays}-day resubmission window.`,
          patientId: p.id,
          hospitalId: claim.hospitalId,
          potentialValue: recoverable,
          clinicalUrgency: rule.clinicalUrgency,
          conversionProbability: rej.historicalRecoveryRate,
          // Urgency here is how close the window is to closing, expressed on
          // the same "days overdue" axis the scorer uses.
          daysOverdue: Math.max(0, claim.resubmissionWindowDays - daysLeft),
          confidence: 0.95,
          minimumPriority: daysLeft <= 10 ? 'HIGH' : undefined,
          recommendedAction: pathwayAction(rej.recommendedPathway),
          recommendedChannel: 'PORTAL',
          evidence: {
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            rejectionId: rej.id,
            payer: claim.payerName,
            reasonCode: rej.reasonCode,
            reasonText: rej.reasonText,
            rejectedAmount: rej.rejectedAmount,
            recoverableAmount: Math.round(recoverable),
            historicalRecoveryRate: rej.historicalRecoveryRate,
            pathway: rej.recommendedPathway,
            windowClosesAt: deadline,
            daysRemaining: daysLeft,
            responsibleDepartment: rej.responsibleDepartment,
            serviceCode: claim.serviceCode,
          },
        })
      }
    }
  }
  return out
}

const insRepeatRejection: Detector = (ctx, rule) => {
  const minOccurrences = num(rule.params, 'minOccurrences', 3)
  const windowDays = num(rule.params, 'windowDays', 120)
  const minTotal = num(rule.params, 'minTotalAmount', 1500)
  const since = new Date(ctx.asOf.getTime() - windowDays * DAY_MS)

  // This rule is about a process defect, so it aggregates across patients:
  // one opportunity per hospital + service code + reason, owned by the
  // department that generates the error.
  interface Group {
    hospitalId: string
    serviceCode: string
    serviceDescription: string
    reasonCode: string
    reasonText: string
    department: string
    payer: string
    count: number
    total: number
    claimNumbers: string[]
  }
  const groups = new Map<string, Group>()

  for (const p of ctx.patients) {
    for (const claim of p.claims) {
      for (const rej of claim.rejections) {
        if (rej.rejectedAt < since) continue
        const k = `${claim.hospitalId}|${claim.serviceCode}|${rej.reasonCode}`
        const g = groups.get(k)
        if (g) {
          g.count += 1
          g.total += rej.rejectedAmount
          if (g.claimNumbers.length < 8) g.claimNumbers.push(claim.claimNumber)
        } else {
          groups.set(k, {
            hospitalId: claim.hospitalId,
            serviceCode: claim.serviceCode,
            serviceDescription: claim.serviceDescription,
            reasonCode: rej.reasonCode,
            reasonText: rej.reasonText,
            department: rej.responsibleDepartment,
            payer: claim.payerName,
            count: 1,
            total: rej.rejectedAmount,
            claimNumbers: [claim.claimNumber],
          })
        }
      }
    }
  }

  const out: DetectedCandidate[] = []
  for (const [k, g] of groups) {
    if (g.count < minOccurrences || g.total < minTotal) continue
    out.push({
      dedupeKey: `${rule.key}:${k}`,
      title: `Repeat rejection pattern — ${g.serviceDescription}`,
      detectionReason:
        `${g.serviceCode} (${g.serviceDescription}) has been rejected ${g.count} times in the last ${windowDays} days ` +
        `for the same reason — ${g.reasonText} — totalling ${fmtMoney(g.total)}. ` +
        `A repeat of this size is a submission-process defect in ${g.department}, not ${g.count} unrelated claim errors.`,
      hospitalId: g.hospitalId,
      potentialValue: g.total * 0.45,
      clinicalUrgency: rule.clinicalUrgency,
      conversionProbability: 0.45,
      daysOverdue: windowDays,
      confidence: 0.9,
      minimumPriority: g.count >= minOccurrences * 2 ? 'HIGH' : undefined,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: 'PORTAL',
      evidence: {
        serviceCode: g.serviceCode,
        reasonCode: g.reasonCode,
        occurrences: g.count,
        totalRejected: Math.round(g.total),
        responsibleDepartment: g.department,
        sampleClaims: g.claimNumbers,
        windowDays,
      },
    })
  }
  return out
}

const insUnderpaidClaim: Detector = (ctx, rule) => {
  const minVariance = num(rule.params, 'minVariance', 150)
  const minPct = num(rule.params, 'minVariancePct', 0.05)
  const lookback = num(rule.params, 'lookbackDays', 180)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    for (const claim of p.claims) {
      if (!['PAID', 'PARTIALLY_PAID'].includes(claim.status)) continue
      if (!within(ctx, claim.serviceDate, lookback)) continue
      const variance = claim.approvedAmount - claim.paidAmount
      if (variance < minVariance) continue
      if (claim.approvedAmount <= 0 || variance / claim.approvedAmount < minPct) continue

      out.push({
        dedupeKey: `${rule.key}:${claim.id}`,
        title: `Underpayment — ${claim.serviceDescription}`,
        detectionReason:
          `${claim.payerName} approved ${fmtMoney(claim.approvedAmount)} on claim ${claim.claimNumber} but remitted ` +
          `${fmtMoney(claim.paidAmount)}, a shortfall of ${fmtMoney(variance)} ` +
          `(${Math.round((variance / claim.approvedAmount) * 100)}% of the approved amount).`,
        patientId: p.id,
        hospitalId: claim.hospitalId,
        potentialValue: variance,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: 0.55,
        daysOverdue: daysBetween(ctx.asOf, claim.serviceDate),
        confidence: 0.93,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PORTAL',
        evidence: {
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          payer: claim.payerName,
          approvedAmount: claim.approvedAmount,
          paidAmount: claim.paidAmount,
          variance: Math.round(variance),
          serviceCode: claim.serviceCode,
        },
      })
    }
  }
  return out
}

const insPendingStale: Detector = (ctx, rule) => {
  const staleDays = num(rule.params, 'staleDays', 45)
  const minBilled = num(rule.params, 'minBilledAmount', 300)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    for (const claim of p.claims) {
      if (!['SUBMITTED', 'PENDING'].includes(claim.status)) continue
      if (claim.billedAmount < minBilled) continue
      const submitted = claim.submittedAt ?? claim.serviceDate
      const age = daysBetween(ctx.asOf, submitted)
      if (age < staleDays) continue

      out.push({
        dedupeKey: `${rule.key}:${claim.id}`,
        title: `Claim pending ${age} days — ${claim.serviceDescription}`,
        detectionReason:
          `Claim ${claim.claimNumber} for ${fmtMoney(claim.billedAmount)} was submitted to ${claim.payerName} on ` +
          `${fmtDate(submitted)} and has had no adjudication response ${age} days later, against a ${staleDays}-day ` +
          `expected turnaround. Unadjudicated claims age out of the filing window.`,
        patientId: p.id,
        hospitalId: claim.hospitalId,
        potentialValue: claim.billedAmount * 0.8,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: 0.6,
        daysOverdue: age - staleDays,
        confidence: 0.88,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PORTAL',
        evidence: {
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          payer: claim.payerName,
          billedAmount: claim.billedAmount,
          submittedAt: submitted,
          ageDays: age,
        },
      })
    }
  }
  return out
}

const insPatientPathway: Detector = (ctx, rule) => {
  const minAmount = num(rule.params, 'minRejectedAmount', 300)
  const requireContactable = bool(rule.params, 'requireContactable', true)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (requireContactable && !isContactableSubject(p)) continue
    for (const claim of p.claims) {
      if (claim.status !== 'REJECTED') continue
      for (const rej of claim.rejections) {
        if (rej.rejectedAmount < minAmount) continue
        // Only where the payer route is genuinely closed. Anything still
        // appealable belongs to INS_REJECTION_RECOVERABLE — the hospital should
        // exhaust the insurer before asking the patient to pay.
        const payerRouteClosed =
          !rej.isAppealable ||
          ['SERVICE_NOT_COVERED', 'TIMELY_FILING'].includes(rej.reasonCode)
        if (!payerRouteClosed) continue

        out.push({
          dedupeKey: `${rule.key}:${rej.id}`,
          title: `Financial counselling needed — ${claim.serviceDescription}`,
          detectionReason:
            `${fmtMoney(rej.rejectedAmount)} for ${claim.serviceDescription} was rejected by ${claim.payerName} ` +
            `(${rej.reasonText}) and the payer route is closed. The patient has not been offered financial counselling. ` +
            `A self-pay option may be appropriate where it is clinically indicated and permitted under the payer contract — ` +
            `confirm eligibility before discussing pricing.`,
          patientId: p.id,
          hospitalId: claim.hospitalId,
          potentialValue: rej.rejectedAmount * 0.35,
          clinicalUrgency: rule.clinicalUrgency,
          conversionProbability: conversionFor(p, 0.3),
          daysOverdue: daysBetween(ctx.asOf, rej.rejectedAt),
          confidence: 0.82,
          recommendedAction: rule.recommendedAction,
          recommendedChannel: 'PHONE',
          evidence: {
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            rejectionId: rej.id,
            payer: claim.payerName,
            reasonCode: rej.reasonCode,
            rejectedAmount: rej.rejectedAmount,
            payerRouteClosed: true,
            complianceNote:
              'Self-pay offers require eligibility confirmation against the payer contract before any pricing discussion.',
          },
        })
      }
    }
  }
  return out
}

function pathwayAction(pathway: string): string {
  switch (pathway) {
    case 'CORRECT_CODING':
      return 'Review the coding against the clinical documentation, correct it and resubmit.'
    case 'OBTAIN_DOCUMENTATION':
      return 'Obtain the missing clinical documentation from the treating team and resubmit.'
    case 'APPEAL':
      return 'Prepare a formal appeal with supporting clinical justification.'
    default:
      return 'Resubmit the claim before the payer window closes.'
  }
}

// ── REACTIVATION ────────────────────────────────────────────────────────

const reactLapsedChronic: Detector = (ctx, rule) => {
  const inactiveDays = num(rule.params, 'inactiveDays', 270)
  const value = num(rule.params, 'minPotentialValue', 900)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    const chronic = p.diagnoses.filter((d) => d.isChronic)
    if (chronic.length === 0) continue
    const last = lastEncounter(p)
    if (!last) continue
    const idle = daysBetween(ctx.asOf, last.startedAt)
    if (idle < inactiveDays) continue

    const conditions = [...new Set(chronic.map((d) => d.description))]
    out.push({
      dedupeKey: `${rule.key}:${p.id}`,
      title: `Chronic patient lapsed — ${conditions[0]}`,
      detectionReason:
        `The patient carries ${conditions.length} active chronic diagnosis${conditions.length > 1 ? 'es' : ''} ` +
        `(${conditions.slice(0, 3).join(', ')}) and was last seen on ${fmtDate(last.startedAt)}, ${idle} days ago. ` +
        `Chronic care expects contact at least every ${inactiveDays} days.`,
      patientId: p.id,
      hospitalId: p.hospitalId,
      departmentId: last.departmentId,
      specialtyId: last.specialtyId,
      physicianId: last.physicianId ?? p.primaryPhysicianId ?? undefined,
      potentialValue: value,
      clinicalUrgency: rule.clinicalUrgency + Math.min(16, conditions.length * 5),
      conversionProbability: conversionFor(p, 0.34),
      daysOverdue: idle - inactiveDays,
      confidence: 0.87,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: p.preferredChannel,
      evidence: {
        chronicConditions: conditions,
        lastEncounterAt: last.startedAt,
        inactiveDays: idle,
        threshold: inactiveDays,
      },
    })
  }
  return out
}

const reactHighValueLapsed: Detector = (ctx, rule) => {
  const inactiveDays = num(rule.params, 'inactiveDays', 365)
  const minLtv = num(rule.params, 'minLifetimeValue', 12000)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    if (p.lifetimeValue < minLtv) continue
    const last = lastEncounter(p)
    if (!last) continue
    const idle = daysBetween(ctx.asOf, last.startedAt)
    if (idle < inactiveDays) continue

    out.push({
      dedupeKey: `${rule.key}:${p.id}`,
      title: `High-value patient inactive ${Math.round(idle / 30)} months`,
      detectionReason:
        `The patient has generated ${fmtMoney(p.lifetimeValue)} in gross charges across ${p.encounters.length} encounters ` +
        `and has not attended since ${fmtDate(last.startedAt)} — ${idle} days. ` +
        `Historic value of this size justifies personal outreach rather than a bulk campaign.`,
      patientId: p.id,
      hospitalId: p.hospitalId,
      departmentId: last.departmentId,
      specialtyId: last.specialtyId,
      physicianId: last.physicianId ?? p.primaryPhysicianId ?? undefined,
      // Projected annual value: a fraction of prior yearly spend, not the full
      // lifetime figure, which would wildly overstate the opportunity.
      potentialValue: Math.min(18000, p.lifetimeValue * 0.22),
      clinicalUrgency: rule.clinicalUrgency,
      conversionProbability: conversionFor(p, 0.26),
      daysOverdue: idle - inactiveDays,
      confidence: 0.8,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: 'PHONE',
      evidence: {
        lifetimeValue: Math.round(p.lifetimeValue),
        encounterCount: p.encounters.length,
        lastEncounterAt: last.startedAt,
        inactiveDays: idle,
        vip: p.vipFlag,
      },
    })
  }
  return out
}

const reactSpecialistPattern: Detector = (ctx, rule) => {
  const minVisits = num(rule.params, 'minVisits', 3)
  const multiplier = num(rule.params, 'intervalMultiplier', 2.0)
  const value = num(rule.params, 'minPotentialValue', 700)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    const bySpecialty = new Map<string, typeof p.encounters>()
    for (const e of p.encounters) {
      if (e.status !== 'COMPLETED') continue
      const arr = bySpecialty.get(e.specialtyId)
      if (arr) arr.push(e)
      else bySpecialty.set(e.specialtyId, [e])
    }

    for (const [specialtyId, encs] of bySpecialty) {
      if (encs.length < minVisits) continue
      const intervals: number[] = []
      for (let i = 1; i < encs.length; i++) {
        intervals.push(daysBetween(encs[i].startedAt, encs[i - 1].startedAt))
      }
      const cadence = median(intervals)
      if (cadence <= 0) continue
      const last = encs[encs.length - 1]
      const idle = daysBetween(ctx.asOf, last.startedAt)
      if (idle < cadence * multiplier) continue

      const specialtyName = ctx.specialtyNames.get(specialtyId) ?? 'this specialty'
      out.push({
        dedupeKey: `${rule.key}:${p.id}:${specialtyId}`,
        title: `${specialtyName} follow-up pattern broken`,
        detectionReason:
          `The patient attended ${specialtyName} ${encs.length} times on a roughly ${Math.round(cadence)}-day cadence. ` +
          `The last visit was ${fmtDate(last.startedAt)}, ${idle} days ago — ${(idle / cadence).toFixed(1)}× their own ` +
          `established interval, past the ${multiplier}× threshold.`,
        patientId: p.id,
        hospitalId: p.hospitalId,
        departmentId: last.departmentId,
        specialtyId,
        physicianId: last.physicianId,
        potentialValue: value,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.36),
        daysOverdue: Math.round(idle - cadence * multiplier),
        confidence: 0.83,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          specialty: specialtyName,
          visitCount: encs.length,
          medianIntervalDays: Math.round(cadence),
          lastVisitAt: last.startedAt,
          inactiveDays: idle,
          intervalMultiplier: multiplier,
        },
      })
    }
  }
  return out
}

const reactPostSurgical: Detector = (ctx, rule) => {
  const inactiveDays = num(rule.params, 'inactiveDays', 120)
  const lookback = num(rule.params, 'lookbackDays', 730)
  const value = num(rule.params, 'minPotentialValue', 500)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const s of p.surgeries) {
      if (s.status !== 'PERFORMED' || !s.performedAt) continue
      if (!within(ctx, s.performedAt, lookback)) continue
      if (hasEncounterAfter(p, s.performedAt)) continue
      const idle = daysBetween(ctx.asOf, s.performedAt)
      if (idle < inactiveDays) continue

      out.push({
        dedupeKey: `${rule.key}:${s.id}`,
        title: `Post-operative follow-up never happened`,
        detectionReason:
          `${s.description} was performed on ${fmtDate(s.performedAt)} and the patient has had no encounter ` +
          `with the group in the ${idle} days since. Post-operative review is unevidenced.`,
        patientId: p.id,
        hospitalId: s.hospitalId,
        departmentId: ctx.physicianDepartment.get(s.physicianId),
        specialtyId: ctx.physicianSpecialty.get(s.physicianId),
        physicianId: s.physicianId,
        potentialValue: value,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.48),
        daysOverdue: idle - inactiveDays,
        confidence: 0.86,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          surgeryId: s.id,
          procedure: s.description,
          performedAt: s.performedAt,
          inactiveDays: idle,
        },
      })
    }
  }
  return out
}

// ── APPOINTMENTS ────────────────────────────────────────────────────────

const apptNoShowNotRebooked: Detector = (ctx, rule) => {
  const rebookDays = num(rule.params, 'rebookWindowDays', 14)
  const lookback = num(rule.params, 'lookbackDays', 180)
  const value = num(rule.params, 'minPotentialValue', 250)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    // Only the most recent no-show: older ones in the same series describe the
    // same unresolved need.
    const noShows = p.appointments.filter(
      (a) => a.status === 'NO_SHOW' && within(ctx, a.scheduledFor, lookback)
    )
    if (noShows.length === 0) continue
    const latest = noShows[noShows.length - 1]
    const due = new Date(latest.scheduledFor.getTime() + rebookDays * DAY_MS)
    if (ctx.asOf < due) continue

    const rebooked = p.appointments.some(
      (a) => a.createdAt > latest.scheduledFor && ['BOOKED', 'COMPLETED'].includes(a.status)
    )
    if (rebooked) continue

    const specialtyName = ctx.specialtyNames.get(latest.specialtyId) ?? 'the clinic'
    out.push({
      dedupeKey: `${rule.key}:${latest.id}`,
      title: `Missed ${specialtyName} appointment, not rebooked`,
      detectionReason:
        `The patient did not attend a ${specialtyName} appointment on ${fmtDate(latest.scheduledFor)} ` +
        `and no replacement has been booked in the ${daysBetween(ctx.asOf, latest.scheduledFor)} days since, ` +
        `past the ${rebookDays}-day rebooking window.` +
        (noShows.length > 1 ? ` This is their ${ordinal(noShows.length)} no-show in the period.` : ''),
      patientId: p.id,
      hospitalId: latest.hospitalId,
      departmentId: ctx.physicianDepartment.get(latest.physicianId),
      specialtyId: latest.specialtyId,
      physicianId: latest.physicianId,
      potentialValue: value,
      clinicalUrgency: latest.isFollowUp ? rule.clinicalUrgency + 14 : rule.clinicalUrgency,
      conversionProbability: conversionFor(p, 0.44),
      daysOverdue: daysBetween(ctx.asOf, due),
      confidence: 0.9,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: p.preferredChannel,
      evidence: {
        appointmentId: latest.id,
        specialty: specialtyName,
        scheduledFor: latest.scheduledFor,
        wasFollowUp: latest.isFollowUp,
        noShowCountInPeriod: noShows.length,
      },
    })
  }
  return out
}

const apptRepeatCancellation: Detector = (ctx, rule) => {
  const minCancels = num(rule.params, 'minCancellations', 2)
  const windowDays = num(rule.params, 'windowDays', 180)
  const value = num(rule.params, 'minPotentialValue', 250)
  const since = new Date(ctx.asOf.getTime() - windowDays * DAY_MS)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    const cancels = p.appointments.filter(
      (a) => a.status === 'CANCELLED_PATIENT' && a.scheduledFor >= since
    )
    if (cancels.length < minCancels) continue
    const completedSince = p.appointments.some(
      (a) => a.status === 'COMPLETED' && a.scheduledFor >= cancels[0].scheduledFor
    )
    if (completedSince) continue

    const latest = cancels[cancels.length - 1]
    const specialtyName = ctx.specialtyNames.get(latest.specialtyId) ?? 'the clinic'
    out.push({
      dedupeKey: `${rule.key}:${p.id}:${latest.id}`,
      title: `${cancels.length} cancellations without a completed visit`,
      detectionReason:
        `The patient has cancelled ${cancels.length} ${specialtyName} appointments in the last ${windowDays} days ` +
        `(most recently ${fmtDate(latest.scheduledFor)}) and has not completed a visit in that period. ` +
        `Repeated cancellation usually signals an access barrier — timing, transport or cost — rather than disinterest.`,
      patientId: p.id,
      hospitalId: latest.hospitalId,
      departmentId: ctx.physicianDepartment.get(latest.physicianId),
      specialtyId: latest.specialtyId,
      physicianId: latest.physicianId,
      potentialValue: value,
      clinicalUrgency: rule.clinicalUrgency,
      conversionProbability: conversionFor(p, 0.38),
      daysOverdue: daysBetween(ctx.asOf, latest.scheduledFor),
      confidence: 0.85,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: 'PHONE',
      evidence: {
        cancellationCount: cancels.length,
        windowDays,
        specialty: specialtyName,
        lastCancelledAt: latest.scheduledFor,
        reasons: cancels.map((c) => c.cancelReason).filter(Boolean),
      },
    })
  }
  return out
}

const apptFollowUpIntervalExceeded: Detector = (ctx, rule) => {
  const grace = num(rule.params, 'graceDays', 14)
  const lookback = num(rule.params, 'lookbackDays', 400)
  const value = num(rule.params, 'minPotentialValue', 280)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    // Walk backwards to the newest encounter carrying a follow-up instruction;
    // earlier ones are superseded.
    const withFollowUp = p.encounters.filter(
      (e) => e.followUpRecommended && e.followUpDays && within(ctx, e.startedAt, lookback)
    )
    if (withFollowUp.length === 0) continue
    const enc = withFollowUp[withFollowUp.length - 1]
    const followUpDays = enc.followUpDays as number
    const due = new Date(enc.startedAt.getTime() + (followUpDays + grace) * DAY_MS)
    if (ctx.asOf < due) continue
    if (hasEncounterAfter(p, enc.startedAt)) continue

    const overdue = daysBetween(ctx.asOf, due)
    const specialtyName = ctx.specialtyNames.get(enc.specialtyId) ?? 'the clinic'
    out.push({
      dedupeKey: `${rule.key}:${enc.id}`,
      title: `Follow-up overdue by ${overdue} days — ${specialtyName}`,
      detectionReason:
        `At the ${specialtyName} encounter on ${fmtDate(enc.startedAt)}, ` +
        `${ctx.physicianNames.get(enc.physicianId) ?? 'the physician'} documented a ${followUpDays}-day follow-up. ` +
        `The patient has not returned, putting the follow-up ${overdue} days past its ${grace}-day grace period.`,
      patientId: p.id,
      hospitalId: enc.hospitalId,
      departmentId: enc.departmentId,
      specialtyId: enc.specialtyId,
      physicianId: enc.physicianId,
      potentialValue: value,
      clinicalUrgency: rule.clinicalUrgency,
      conversionProbability: conversionFor(p, 0.5),
      daysOverdue: overdue,
      confidence: 0.94,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: p.preferredChannel,
      evidence: {
        encounterId: enc.id,
        encounterAt: enc.startedAt,
        specialty: specialtyName,
        documentedFollowUpDays: followUpDays,
        graceDays: grace,
        note: enc.noteSummary,
      },
    })
  }
  return out
}

const apptBookedNeverCompleted: Detector = (ctx, rule) => {
  const staleDays = num(rule.params, 'staleDays', 7)
  const lookback = num(rule.params, 'lookbackDays', 120)
  const value = num(rule.params, 'minPotentialValue', 250)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (p.isDeceased) continue
    for (const a of p.appointments) {
      if (a.status !== 'BOOKED') continue
      if (!within(ctx, a.scheduledFor, lookback)) continue
      const overdue = daysBetween(ctx.asOf, a.scheduledFor)
      if (overdue < staleDays) continue

      const specialtyName = ctx.specialtyNames.get(a.specialtyId) ?? 'the clinic'
      out.push({
        dedupeKey: `${rule.key}:${a.id}`,
        title: `Unreconciled booking — ${specialtyName}`,
        detectionReason:
          `A ${specialtyName} appointment scheduled for ${fmtDate(a.scheduledFor)} is still recorded as booked ` +
          `${overdue} days later. It was never marked completed, cancelled or missed, so the outcome is unknown ` +
          `and the patient may be waiting.`,
        patientId: p.id,
        hospitalId: a.hospitalId,
        departmentId: ctx.physicianDepartment.get(a.physicianId),
        specialtyId: a.specialtyId,
        physicianId: a.physicianId,
        potentialValue: value,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.55),
        daysOverdue: overdue - staleDays,
        confidence: 0.9,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          appointmentId: a.id,
          specialty: specialtyName,
          scheduledFor: a.scheduledFor,
          unresolvedDays: overdue,
        },
      })
    }
  }
  return out
}

// ── REFERRALS ───────────────────────────────────────────────────────────

const refIssuedNotBooked: Detector = (ctx, rule) => {
  const bookingDays = num(rule.params, 'bookingWindowDays', 21)
  const lookback = num(rule.params, 'lookbackDays', 270)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const r of p.referrals) {
      if (r.status !== 'ISSUED') continue
      if (!within(ctx, r.issuedAt, lookback)) continue
      const due = new Date(r.issuedAt.getTime() + bookingDays * DAY_MS)
      if (ctx.asOf < due) continue

      const specialtyName = ctx.specialtyNames.get(r.toSpecialtyId) ?? 'the referred specialty'
      out.push({
        dedupeKey: `${rule.key}:${r.id}`,
        title: `${specialtyName} referral never booked`,
        detectionReason:
          `${ctx.physicianNames.get(r.fromPhysicianId) ?? 'A physician'} referred the patient to ${specialtyName} ` +
          `on ${fmtDate(r.issuedAt)} for ${r.reason}. No appointment has been booked in the ` +
          `${daysBetween(ctx.asOf, r.issuedAt)} days since, past the ${bookingDays}-day booking window.`,
        patientId: p.id,
        hospitalId: r.hospitalId,
        specialtyId: r.toSpecialtyId,
        physicianId: r.fromPhysicianId,
        departmentId: ctx.physicianDepartment.get(r.fromPhysicianId),
        potentialValue: r.estimatedValue,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.52),
        daysOverdue: daysBetween(ctx.asOf, due),
        confidence: 0.91,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: p.preferredChannel,
        evidence: {
          referralId: r.id,
          toSpecialty: specialtyName,
          issuedAt: r.issuedAt,
          reason: r.reason,
          estimatedValue: r.estimatedValue,
        },
      })
    }
  }
  return out
}

const refExpiredUnfulfilled: Detector = (ctx, rule) => {
  const lookback = num(rule.params, 'lookbackDays', 365)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    if (!isContactableSubject(p)) continue
    for (const r of p.referrals) {
      if (r.status !== 'EXPIRED') continue
      if (!within(ctx, r.issuedAt, lookback)) continue

      const specialtyName = ctx.specialtyNames.get(r.toSpecialtyId) ?? 'the referred specialty'
      const expired = r.expiresAt ?? r.issuedAt
      out.push({
        dedupeKey: `${rule.key}:${r.id}`,
        title: `${specialtyName} referral expired unused`,
        detectionReason:
          `A ${specialtyName} referral issued ${fmtDate(r.issuedAt)} for ${r.reason} expired on ${fmtDate(expired)} ` +
          `without an appointment. The onward care never happened and the referral must be re-issued.`,
        patientId: p.id,
        hospitalId: r.hospitalId,
        specialtyId: r.toSpecialtyId,
        physicianId: r.fromPhysicianId,
        departmentId: ctx.physicianDepartment.get(r.fromPhysicianId),
        potentialValue: r.estimatedValue,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: conversionFor(p, 0.4),
        daysOverdue: daysBetween(ctx.asOf, expired),
        confidence: 0.89,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PHONE',
        evidence: {
          referralId: r.id,
          toSpecialty: specialtyName,
          issuedAt: r.issuedAt,
          expiredAt: expired,
          reason: r.reason,
        },
      })
    }
  }
  return out
}

const refLeakage: Detector = (ctx, rule) => {
  const lookback = num(rule.params, 'lookbackDays', 270)
  const minValue = num(rule.params, 'minEstimatedValue', 400)
  const out: DetectedCandidate[] = []

  for (const p of ctx.patients) {
    for (const r of p.referrals) {
      if (r.status !== 'LEAKED' && r.direction !== 'EXTERNAL_OUT') continue
      if (r.status === 'CANCELLED') continue
      if (!within(ctx, r.issuedAt, lookback)) continue
      if (r.estimatedValue < minValue) continue

      const specialtyName = ctx.specialtyNames.get(r.toSpecialtyId) ?? 'the specialty'
      out.push({
        dedupeKey: `${rule.key}:${r.id}`,
        title: `${specialtyName} referral left the group`,
        detectionReason:
          `A ${specialtyName} referral issued ${fmtDate(r.issuedAt)} was fulfilled by ` +
          `${r.externalProvider ?? 'an external provider'}, worth roughly ${fmtMoney(r.estimatedValue)}. ` +
          `The group offers this service at ${ctx.hospitalNames.get(r.hospitalId) ?? 'this hospital'}, ` +
          `so this is retainable volume that left.`,
        patientId: p.id,
        hospitalId: r.hospitalId,
        specialtyId: r.toSpecialtyId,
        physicianId: r.fromPhysicianId,
        departmentId: ctx.physicianDepartment.get(r.fromPhysicianId),
        potentialValue: r.estimatedValue,
        clinicalUrgency: rule.clinicalUrgency,
        conversionProbability: 0.3,
        daysOverdue: daysBetween(ctx.asOf, r.issuedAt),
        confidence: 0.78,
        recommendedAction: rule.recommendedAction,
        recommendedChannel: 'PORTAL',
        evidence: {
          referralId: r.id,
          toSpecialty: specialtyName,
          externalProvider: r.externalProvider,
          estimatedValue: r.estimatedValue,
          issuedAt: r.issuedAt,
        },
      })
    }
  }
  return out
}

// ── SERVICE LINE (aggregate) ────────────────────────────────────────────

/** Sums the trailing N months of service-line metrics per hospital+specialty. */
function aggregateServiceLines(ctx: DetectionContext, months: number) {
  const periods = [...new Set(ctx.serviceLines.map((m) => m.periodMonth))].sort().slice(-months)
  const agg = new Map<
    string,
    {
      hospitalId: string
      specialtyId: string
      encounters: number
      revenue: number
      capacitySlots: number
      bookedSlots: number
      cancellations: number
      referralsOut: number
      referralsRetained: number
    }
  >()
  for (const m of ctx.serviceLines) {
    if (!periods.includes(m.periodMonth)) continue
    const k = `${m.hospitalId}:${m.specialtyId}`
    const cur = agg.get(k)
    if (cur) {
      cur.encounters += m.encounters
      cur.revenue += m.revenue
      cur.capacitySlots += m.capacitySlots
      cur.bookedSlots += m.bookedSlots
      cur.cancellations += m.cancellations
      cur.referralsOut += m.referralsOut
      cur.referralsRetained += m.referralsRetained
    } else {
      agg.set(k, {
        hospitalId: m.hospitalId,
        specialtyId: m.specialtyId,
        encounters: m.encounters,
        revenue: m.revenue,
        capacitySlots: m.capacitySlots,
        bookedSlots: m.bookedSlots,
        cancellations: m.cancellations,
        referralsOut: m.referralsOut,
        referralsRetained: m.referralsRetained,
      })
    }
  }
  return { agg, periods }
}

const slCapacityUnderutilised: Detector = (ctx, rule) => {
  const maxUtil = num(rule.params, 'maxUtilisation', 0.62)
  const minCapacity = num(rule.params, 'minCapacitySlots', 120)
  const months = num(rule.params, 'months', 3)
  const { agg, periods } = aggregateServiceLines(ctx, months)
  const out: DetectedCandidate[] = []

  for (const [k, m] of agg) {
    if (m.capacitySlots < minCapacity) continue
    const util = m.bookedSlots / m.capacitySlots
    if (util >= maxUtil) continue

    const idleSlots = m.capacitySlots - m.bookedSlots
    const revenuePerSlot = m.encounters > 0 ? m.revenue / m.encounters : 320
    const specialtyName = ctx.specialtyNames.get(m.specialtyId) ?? 'this specialty'
    out.push({
      dedupeKey: `${rule.key}:${k}:${periods[periods.length - 1] ?? 'na'}`,
      title: `${specialtyName} running at ${Math.round(util * 100)}% capacity`,
      detectionReason:
        `Over the last ${months} months ${specialtyName} at ${ctx.hospitalNames.get(m.hospitalId) ?? 'this hospital'} ` +
        `booked ${m.bookedSlots.toLocaleString()} of ${m.capacitySlots.toLocaleString()} contracted slots ` +
        `(${Math.round(util * 100)}%, against a ${Math.round(maxUtil * 100)}% floor). ` +
        `That leaves ${idleSlots.toLocaleString()} unused slots worth roughly ${fmtMoney(idleSlots * revenuePerSlot)}.`,
      hospitalId: m.hospitalId,
      specialtyId: m.specialtyId,
      potentialValue: idleSlots * revenuePerSlot,
      clinicalUrgency: rule.clinicalUrgency,
      conversionProbability: 0.35,
      daysOverdue: months * 30,
      confidence: 0.85,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: 'PORTAL',
      evidence: {
        specialty: specialtyName,
        months,
        capacitySlots: m.capacitySlots,
        bookedSlots: m.bookedSlots,
        utilisation: Number(util.toFixed(3)),
        idleSlots,
        revenuePerSlot: Math.round(revenuePerSlot),
      },
    })
  }
  return out
}

const slReferralLeakage: Detector = (ctx, rule) => {
  const maxRetention = num(rule.params, 'maxRetentionRate', 0.7)
  const minReferrals = num(rule.params, 'minReferrals', 25)
  const months = num(rule.params, 'months', 3)
  const { agg, periods } = aggregateServiceLines(ctx, months)
  const out: DetectedCandidate[] = []

  for (const [k, m] of agg) {
    const total = m.referralsOut + m.referralsRetained
    if (total < minReferrals) continue
    const retention = m.referralsRetained / total
    if (retention >= maxRetention) continue

    const specialtyName = ctx.specialtyNames.get(m.specialtyId) ?? 'this specialty'
    const revenuePerReferral = m.encounters > 0 ? m.revenue / m.encounters : 450
    out.push({
      dedupeKey: `${rule.key}:${k}:${periods[periods.length - 1] ?? 'na'}`,
      title: `${specialtyName} leaking ${Math.round((1 - retention) * 100)}% of referrals`,
      detectionReason:
        `${specialtyName} at ${ctx.hospitalNames.get(m.hospitalId) ?? 'this hospital'} retained ` +
        `${m.referralsRetained} of ${total} referrals over ${months} months (${Math.round(retention * 100)}%, ` +
        `against a ${Math.round(maxRetention * 100)}% target). ${m.referralsOut} referrals were fulfilled outside ` +
        `the group, worth roughly ${fmtMoney(m.referralsOut * revenuePerReferral)}.`,
      hospitalId: m.hospitalId,
      specialtyId: m.specialtyId,
      potentialValue: m.referralsOut * revenuePerReferral,
      clinicalUrgency: rule.clinicalUrgency,
      conversionProbability: 0.3,
      daysOverdue: months * 30,
      confidence: 0.82,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: 'PORTAL',
      evidence: {
        specialty: specialtyName,
        months,
        referralsRetained: m.referralsRetained,
        referralsOut: m.referralsOut,
        retentionRate: Number(retention.toFixed(3)),
      },
    })
  }
  return out
}

const slHighCancellation: Detector = (ctx, rule) => {
  const maxRate = num(rule.params, 'maxCancellationRate', 0.18)
  const minEncounters = num(rule.params, 'minEncounters', 80)
  const months = num(rule.params, 'months', 3)
  const { agg, periods } = aggregateServiceLines(ctx, months)
  const out: DetectedCandidate[] = []

  for (const [k, m] of agg) {
    if (m.encounters < minEncounters) continue
    const denominator = m.encounters + m.cancellations
    const rate = denominator > 0 ? m.cancellations / denominator : 0
    if (rate <= maxRate) continue

    const specialtyName = ctx.specialtyNames.get(m.specialtyId) ?? 'this specialty'
    const revenuePerEncounter = m.encounters > 0 ? m.revenue / m.encounters : 320
    out.push({
      dedupeKey: `${rule.key}:${k}:${periods[periods.length - 1] ?? 'na'}`,
      title: `${specialtyName} cancellation rate ${Math.round(rate * 100)}%`,
      detectionReason:
        `${specialtyName} at ${ctx.hospitalNames.get(m.hospitalId) ?? 'this hospital'} recorded ${m.cancellations} ` +
        `cancellations against ${m.encounters} completed encounters over ${months} months — a ${Math.round(rate * 100)}% ` +
        `cancellation rate, above the ${Math.round(maxRate * 100)}% threshold. ` +
        `That capacity could have served waiting patients, worth roughly ${fmtMoney(m.cancellations * revenuePerEncounter)}.`,
      hospitalId: m.hospitalId,
      specialtyId: m.specialtyId,
      potentialValue: m.cancellations * revenuePerEncounter,
      clinicalUrgency: rule.clinicalUrgency,
      conversionProbability: 0.4,
      daysOverdue: months * 30,
      confidence: 0.84,
      recommendedAction: rule.recommendedAction,
      recommendedChannel: 'PORTAL',
      evidence: {
        specialty: specialtyName,
        months,
        cancellations: m.cancellations,
        encounters: m.encounters,
        cancellationRate: Number(rate.toFixed(3)),
      },
    })
  }
  return out
}

// ── registry ────────────────────────────────────────────────────────────

export const DETECTORS: Record<string, Detector> = {
  LAB_ABNORMAL_NO_FOLLOWUP: labAbnormalNoFollowUp,
  LAB_CRITICAL_UNACTIONED: labCriticalUnactioned,
  LAB_PENDING_ORDER: labPendingOrder,
  LAB_RECURRING_LAPSED: labRecurringLapsed,
  LAB_NO_PHYSICIAN_RETURN: labNoPhysicianReturn,

  SURG_RECOMMENDED_NOT_SCHEDULED: surgRecommendedNotScheduled,
  SURG_WORKUP_DONE_NOT_PERFORMED: surgWorkupDoneNotPerformed,
  SURG_CANCELLED_NOT_REBOOKED: surgCancelledNotRebooked,
  SURG_CONSULT_PATIENT_INACTIVE: surgConsultPatientInactive,

  MED_REFILL_OVERDUE: medRefillOverdue,
  MED_REFILL_ABANDONED: medRefillAbandoned,
  MED_CHRONIC_NO_REVIEW: medChronicNoReview,
  MED_MONITORING_DUE: medMonitoringDue,
  MED_COURSE_INCOMPLETE: medCourseIncomplete,

  INS_REJECTION_RECOVERABLE: insRejectionRecoverable,
  INS_REPEAT_REJECTION: insRepeatRejection,
  INS_UNDERPAID_CLAIM: insUnderpaidClaim,
  INS_PENDING_STALE: insPendingStale,
  INS_PATIENT_PATHWAY: insPatientPathway,

  REACT_LAPSED_CHRONIC: reactLapsedChronic,
  REACT_HIGH_VALUE_LAPSED: reactHighValueLapsed,
  REACT_SPECIALIST_PATTERN: reactSpecialistPattern,
  REACT_POST_SURGICAL: reactPostSurgical,

  APPT_NO_SHOW_NOT_REBOOKED: apptNoShowNotRebooked,
  APPT_REPEAT_CANCELLATION: apptRepeatCancellation,
  APPT_FOLLOWUP_INTERVAL_EXCEEDED: apptFollowUpIntervalExceeded,
  APPT_BOOKED_NEVER_COMPLETED: apptBookedNeverCompleted,

  REF_ISSUED_NOT_BOOKED: refIssuedNotBooked,
  REF_EXPIRED_UNFULFILLED: refExpiredUnfulfilled,
  REF_LEAKAGE: refLeakage,

  SL_CAPACITY_UNDERUTILISED: slCapacityUnderutilised,
  SL_REFERRAL_LEAKAGE: slReferralLeakage,
  SL_HIGH_CANCELLATION: slHighCancellation,
}

// ── formatting helpers ──────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtMoney(v: number): string {
  return `SAR ${Math.round(v).toLocaleString('en-US')}`
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export { availabilityFor, personName, median }
