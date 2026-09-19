/*
 * Not marked 'server-only': the reset pipeline and operational scripts invoke
 * this from the command line, as they do the detection engine. Web access is
 * gated at the route handlers that call it.
 */
import { prisma } from '../db'

/**
 * Data quality evaluation.
 *
 * Ingestion tells you a row loaded. Quality tells you whether the loaded data
 * can actually drive the rules that depend on it — and those are different
 * questions. A patient feed can load ten thousand rows cleanly and still be
 * useless if `consent_marketing` is empty on all of them, because every
 * outreach rule then excludes every patient and the platform quietly produces
 * nothing.
 *
 * Each check is keyed, so a rule row in the database names the implementation
 * here. Thresholds and severities stay configuration.
 */

export interface QualityEvaluation {
  ruleKey: string
  ruleId: string
  name: string
  dimension: string
  passed: boolean
  measuredValue: number
  threshold: number
  recordsTested: number
  recordsFailed: number
  sampleKeys: string[]
  severity: string
  /** What the operator should do about a failure. */
  remediation: string
}

type Check = () => Promise<{
  measured: number
  tested: number
  failed: number
  samples: string[]
  remediation: string
}>

const SAMPLE_LIMIT = 8
const rate = (ok: number, total: number) => (total === 0 ? 1 : ok / total)

/**
 * Check implementations, keyed by DataQualityRule.key.
 *
 * Each returns a pass *rate* in 0..1, compared against the rule's threshold.
 * Expressing everything as a rate means one comparison covers completeness,
 * validity and uniqueness alike.
 */
const CHECKS: Record<string, Check> = {
  PATIENT_CONTACT_COMPLETENESS: async () => {
    const [total, withPhone, samples] = await Promise.all([
      prisma.patient.count(),
      prisma.patient.count({ where: { phone: { not: null } } }),
      prisma.patient.findMany({ where: { phone: null }, select: { mrn: true }, take: SAMPLE_LIMIT }),
    ])
    return {
      measured: rate(withPhone, total),
      tested: total,
      failed: total - withPhone,
      samples: samples.map((s) => s.mrn),
      remediation:
        'Patients without a phone number cannot be reached by call or SMS, so every outreach rule skips them. Check whether the source column is mapped.',
    }
  },

  PATIENT_CONSENT_POPULATED: async () => {
    // Consent defaults to false on ingest, so an unmapped column looks
    // identical to a population that has genuinely all refused. That ambiguity
    // is exactly what this check exists to surface.
    const [total, consented, samples] = await Promise.all([
      prisma.patient.count(),
      prisma.patient.count({ where: { consentMarketing: true } }),
      prisma.patient.findMany({ where: { consentMarketing: false }, select: { mrn: true }, take: SAMPLE_LIMIT }),
    ])
    return {
      measured: rate(consented, total),
      tested: total,
      failed: total - consented,
      samples: samples.map((s) => s.mrn),
      remediation:
        'Consent defaults to false when the column is absent. If this rate is near zero, the consent column is probably not mapped — not that every patient refused.',
    }
  },

  PATIENT_DOB_VALIDITY: async () => {
    const now = new Date()
    const oldest = new Date(now.getFullYear() - 120, 0, 1)
    const [total, valid, samples] = await Promise.all([
      prisma.patient.count(),
      prisma.patient.count({ where: { dateOfBirth: { gte: oldest, lte: now } } }),
      prisma.patient.findMany({
        where: { OR: [{ dateOfBirth: { lt: oldest } }, { dateOfBirth: { gt: now } }] },
        select: { mrn: true },
        take: SAMPLE_LIMIT,
      }),
    ])
    return {
      measured: rate(valid, total),
      tested: total,
      failed: total - valid,
      samples: samples.map((s) => s.mrn),
      remediation:
        'Dates outside a plausible lifespan usually indicate a placeholder such as 1900-01-01, or a date format parsed wrongly upstream.',
    }
  },

  ENCOUNTER_FOLLOWUP_INTERVAL: async () => {
    const [flagged, withInterval, samples] = await Promise.all([
      prisma.encounter.count({ where: { followUpRecommended: true } }),
      prisma.encounter.count({ where: { followUpRecommended: true, followUpDays: { not: null } } }),
      prisma.encounter.findMany({
        where: { followUpRecommended: true, followUpDays: null },
        select: { sourceId: true },
        take: SAMPLE_LIMIT,
      }),
    ])
    return {
      measured: rate(withInterval, flagged),
      tested: flagged,
      failed: flagged - withInterval,
      samples: samples.map((s) => s.sourceId),
      remediation:
        'A follow-up flagged without an interval cannot be measured against anything, so the follow-up-overdue rule ignores the encounter entirely.',
    }
  },

  ENCOUNTER_PATIENT_LINKAGE: async () => {
    // Orphans cannot arise through ingestion — the reference resolver rejects
    // an unknown MRN — but can survive a direct database load or a migration
    // run with foreign keys disabled, which SQLite permits. A raw anti-join is
    // the only way to see them, because the Prisma relation is declared
    // required and so cannot be queried for null.
    const [total, orphanRows] = await Promise.all([
      prisma.encounter.count(),
      prisma.$queryRaw<Array<{ n: bigint | number }>>`
        SELECT COUNT(*) AS n
        FROM "Encounter" e
        LEFT JOIN "Patient" p ON p."id" = e."patientId"
        WHERE p."id" IS NULL
      `,
    ])
    const orphans = Number(orphanRows[0]?.n ?? 0)
    return {
      measured: rate(total - orphans, total),
      tested: total,
      failed: orphans,
      samples: [],
      remediation:
        'Encounters with no matching patient indicate a load that bypassed reference resolution, or a migration run with foreign keys disabled.',
    }
  },

  LAB_FLAG_VALIDITY: async () => {
    const valid = ['NORMAL', 'HIGH', 'LOW', 'CRITICAL_HIGH', 'CRITICAL_LOW', 'PENDING']
    const [total, ok, samples] = await Promise.all([
      prisma.labResult.count(),
      prisma.labResult.count({ where: { flag: { in: valid } } }),
      prisma.labResult.findMany({ where: { flag: { notIn: valid } }, select: { sourceSystem: true, testName: true }, take: SAMPLE_LIMIT }),
    ])
    return {
      measured: rate(ok, total),
      tested: total,
      failed: total - ok,
      samples: samples.map((s) => s.testName),
      remediation:
        'The platform does not re-derive abnormality from the reference range; an unrecognised flag makes the result invisible to every laboratory rule.',
    }
  },

  LAB_REPEAT_INTERVAL_COVERAGE: async () => {
    // Only monitoring panels need a cadence, so measuring against the whole
    // table would fail permanently for a correct feed.
    const monitoring = ['Diabetes', 'Lipids', 'Renal', 'Hepatic', 'Endocrine', 'Coagulation']
    const [total, withInterval, samples] = await Promise.all([
      prisma.labResult.count({ where: { panel: { in: monitoring } } }),
      prisma.labResult.count({ where: { panel: { in: monitoring }, repeatIntervalDays: { not: null } } }),
      prisma.labResult.findMany({
        where: { panel: { in: monitoring }, repeatIntervalDays: null },
        select: { testName: true },
        take: SAMPLE_LIMIT,
      }),
    ])
    return {
      measured: rate(withInterval, total),
      tested: total,
      failed: total - withInterval,
      samples: samples.map((s) => s.testName),
      remediation:
        'Without a repeat interval on monitoring panels, the recurring-monitoring rule has nothing to measure lateness against and stays silent.',
    }
  },

  CLAIM_REJECTION_REASON: async () => {
    const [rejected, withReason, samples] = await Promise.all([
      prisma.insuranceClaim.count({ where: { status: 'REJECTED' } }),
      prisma.insuranceClaim.count({ where: { status: 'REJECTED', rejections: { some: {} } } }),
      prisma.insuranceClaim.findMany({
        where: { status: 'REJECTED', rejections: { none: {} } },
        select: { claimNumber: true },
        take: SAMPLE_LIMIT,
      }),
    ])
    return {
      measured: rate(withReason, rejected),
      tested: rejected,
      failed: rejected - withReason,
      samples: samples.map((s) => s.claimNumber),
      remediation:
        'A rejected claim with no reason code cannot be assigned a recovery pathway and never appears as recoverable revenue.',
    }
  },

  CLAIM_RECOVERY_RATE_POPULATED: async () => {
    const [total, populated, samples] = await Promise.all([
      prisma.insuranceRejection.count(),
      prisma.insuranceRejection.count({ where: { historicalRecoveryRate: { gt: 0 } } }),
      prisma.insuranceRejection.findMany({
        where: { historicalRecoveryRate: { lte: 0 } },
        select: { reasonCode: true },
        take: SAMPLE_LIMIT,
      }),
    ])
    return {
      measured: rate(populated, total),
      tested: total,
      failed: total - populated,
      samples: samples.map((s) => s.reasonCode),
      remediation:
        'A zero recovery rate puts every rejection below the recoverable threshold, so the insurance module reports nothing to work. Supply your own historical rates per reason and payer.',
    }
  },

  CLAIM_AMOUNT_CONSISTENCY: async () => {
    // Paid should never exceed approved; when it does, one of the two columns
    // is mapped to the wrong source field.
    const rows = await prisma.insuranceClaim.findMany({
      select: { claimNumber: true, approvedAmount: true, paidAmount: true, status: true },
    })
    const relevant = rows.filter((r) => r.status === 'PAID' || r.status === 'PARTIALLY_PAID')
    const bad = relevant.filter((r) => r.paidAmount > r.approvedAmount + 0.01)
    return {
      measured: rate(relevant.length - bad.length, relevant.length),
      tested: relevant.length,
      failed: bad.length,
      samples: bad.slice(0, SAMPLE_LIMIT).map((r) => r.claimNumber),
      remediation: 'Paid exceeding approved usually means the two amount columns are transposed in the mapping.',
    }
  },

  PHARMACY_DAYS_SUPPLY: async () => {
    const [total, valid, samples] = await Promise.all([
      prisma.pharmacyTransaction.count(),
      prisma.pharmacyTransaction.count({ where: { daysSupply: { gt: 0, lte: 365 } } }),
      prisma.pharmacyTransaction.findMany({
        where: { OR: [{ daysSupply: { lte: 0 } }, { daysSupply: { gt: 365 } }] },
        select: { id: true },
        take: SAMPLE_LIMIT,
      }),
    ])
    return {
      measured: rate(valid, total),
      tested: total,
      failed: total - valid,
      samples: samples.map((s) => s.id),
      remediation:
        'Days supply is what the supply-exhausted date is computed from. A zero makes every refill look permanently overdue.',
    }
  },

  SURGERY_PATHWAY_COVERAGE: async () => {
    // A theatre-only feed shows performed cases and nothing else, which makes
    // surgical conversion unmeasurable — the whole point of the domain.
    const [total, preTheatre] = await Promise.all([
      prisma.surgery.count(),
      prisma.surgery.count({
        where: { status: { in: ['RECOMMENDED', 'CONSULT_DONE', 'WORKUP_DONE', 'SCHEDULED'] } },
      }),
    ])
    return {
      measured: rate(preTheatre, total),
      tested: total,
      failed: total - preTheatre,
      samples: [],
      remediation:
        'If nearly every surgical row is PERFORMED, the feed is theatre-only. Recommendations and consultations are what the conversion rules need.',
    }
  },

  REFERRAL_EXPIRY_POPULATED: async () => {
    const [total, withExpiry, samples] = await Promise.all([
      prisma.referral.count(),
      prisma.referral.count({ where: { expiresAt: { not: null } } }),
      prisma.referral.findMany({ where: { expiresAt: null }, select: { id: true }, take: SAMPLE_LIMIT }),
    ])
    return {
      measured: rate(withExpiry, total),
      tested: total,
      failed: total - withExpiry,
      samples: samples.map((s) => s.id),
      remediation: 'A referral with no expiry date never expires, so the expired-referral rule cannot fire on it.',
    }
  },

  DIAGNOSIS_CHRONIC_FLAG: async () => {
    const [total, chronic] = await Promise.all([
      prisma.diagnosis.count(),
      prisma.diagnosis.count({ where: { isChronic: true } }),
    ])
    // Roughly a third of coded diagnoses in a mixed population are chronic. A
    // rate near zero means the flag is not being sent.
    return {
      measured: chronic === 0 ? 0 : 1,
      tested: total,
      failed: chronic === 0 ? total : 0,
      samples: [],
      remediation:
        'The chronic flag gates the monitoring and reactivation rule families. If no diagnosis is chronic, derive the flag upstream from an ICD-10 chronic-condition list.',
    }
  },

  PATIENT_FRESHNESS: async () => {
    const latest = await prisma.patient.findFirst({
      orderBy: { registeredAt: 'desc' },
      select: { registeredAt: true },
    })
    if (!latest) return { measured: 0, tested: 0, failed: 0, samples: [], remediation: 'No patients loaded.' }
    const days = (Date.now() - latest.registeredAt.getTime()) / 86_400_000
    // Expressed as a rate so it compares against a threshold like everything
    // else: fresh within 7 days scores 1, decaying to 0 at 90.
    const measured = Math.max(0, Math.min(1, 1 - Math.max(0, days - 7) / 83))
    return {
      measured,
      tested: 1,
      failed: measured < 1 ? 1 : 0,
      samples: [],
      remediation: `The most recent registration is ${Math.round(days)} days old. Check the pipeline schedule and the watermark.`,
    }
  },

  ENCOUNTER_FRESHNESS: async () => {
    const latest = await prisma.encounter.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    })
    if (!latest) return { measured: 0, tested: 0, failed: 0, samples: [], remediation: 'No encounters loaded.' }
    const days = (Date.now() - latest.startedAt.getTime()) / 86_400_000
    const measured = Math.max(0, Math.min(1, 1 - Math.max(0, days - 2) / 28))
    return {
      measured,
      tested: 1,
      failed: measured < 1 ? 1 : 0,
      samples: [],
      remediation: `The most recent encounter is ${Math.round(days)} days old. Detection scores stale activity, so freshness here affects every clinical rule.`,
    }
  },
}

/**
 * Evaluates every enabled quality rule, optionally scoped to one pipeline, and
 * records the results against the run that produced them.
 */
export async function evaluateQuality(options: {
  pipelineId?: string
  runId?: string
  persist?: boolean
}): Promise<QualityEvaluation[]> {
  const rules = await prisma.dataQualityRule.findMany({
    where: { enabled: true, ...(options.pipelineId ? { pipelineId: options.pipelineId } : {}) },
    include: { pipeline: { select: { name: true, domain: true } } },
  })

  const evaluations: QualityEvaluation[] = []

  for (const rule of rules) {
    const check = CHECKS[rule.key]
    if (!check) {
      // A rule row with no implementation is a deployment mismatch, not a pass.
      console.warn(`[quality] no check registered for rule ${rule.key}`)
      continue
    }

    try {
      const result = await check()
      const passed = result.measured >= rule.threshold
      const evaluation: QualityEvaluation = {
        ruleKey: rule.key,
        ruleId: rule.id,
        name: rule.name,
        dimension: rule.dimension,
        passed,
        measuredValue: Math.round(result.measured * 10000) / 10000,
        threshold: rule.threshold,
        recordsTested: result.tested,
        recordsFailed: result.failed,
        sampleKeys: result.samples,
        severity: rule.severity,
        remediation: result.remediation,
      }
      evaluations.push(evaluation)

      if (options.persist !== false) {
        await prisma.dataQualityResult.create({
          data: {
            ruleId: rule.id,
            runId: options.runId,
            passed,
            measuredValue: evaluation.measuredValue,
            threshold: rule.threshold,
            recordsTested: result.tested,
            recordsFailed: result.failed,
            sampleKeys: JSON.stringify(result.samples),
          },
        })
      }
    } catch (err) {
      console.error(`[quality] rule ${rule.key} failed to evaluate`, err)
    }
  }

  return evaluations
}

export const QUALITY_CHECK_KEYS = Object.keys(CHECKS)
