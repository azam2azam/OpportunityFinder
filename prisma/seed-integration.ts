/**
 * Seeds the ingestion control plane: source systems, pipelines, field mappings,
 * data-quality rules and a realistic run history.
 *
 * Separate from seed.ts because it describes the *integration* rather than the
 * clinical population, and is re-runnable on its own when a mapping or rule
 * changes without regenerating three thousand patients.
 *
 * Field mappings are generated from the domain contracts in
 * src/lib/ingestion/domains.ts rather than retyped, so the mapping screen and
 * the loader can never disagree about what a feed accepts.
 */
import { PrismaClient } from '@prisma/client'
import { DOMAINS } from '../src/lib/ingestion/domains'

const prisma = new PrismaClient()
const DAY = 86_400_000

let _state = 424242
function rnd() {
  _state |= 0
  _state = (_state + 0x6d2b79f5) | 0
  let t = Math.imul(_state ^ (_state >>> 15), 1 | _state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (a: number, b: number) => Math.floor(rnd() * (b - a + 1)) + a
const chance = (p: number) => rnd() < p

const SOURCES = [
  {
    code: 'VIDA_HIS',
    name: 'VIDA Hospital Information System',
    vendor: 'VIDA Health',
    type: 'HIS',
    description:
      'The group’s core clinical system: registration, encounters, appointments, diagnoses and orders across all five hospitals.',
    connectionMode: 'CDC_STREAM',
    endpoint: 'kafka://cdc.vida.internal:9092/vida.public',
    authMode: 'MTLS',
    ownerTeam: 'Clinical Systems',
    status: 'CONNECTED',
    operatorNotes:
      'Change-data-capture via Debezium on the VIDA Postgres replica. Never read the primary — the DBA team blocks direct connections to it. Schema changes are announced on #vida-releases with two weeks notice.',
  },
  {
    code: 'VIDA_LIS',
    name: 'VIDA Laboratory Information System',
    vendor: 'VIDA Health',
    type: 'LIS',
    description:
      'Laboratory orders and results, including outstanding orders that have not yet been resulted.',
    connectionMode: 'API_PULL',
    endpoint: 'https://lis.vida.internal/api/v2/results',
    authMode: 'OAUTH2',
    ownerTeam: 'Laboratory IT',
    status: 'CONNECTED',
    operatorNotes:
      'Paginated at 500 results per page. The API returns results only — pending orders come from the /orders endpoint and must be merged before load, otherwise the ordered-never-resulted rule finds nothing.',
  },
  {
    code: 'VIDA_RCM',
    name: 'VIDA Revenue Cycle Management',
    vendor: 'VIDA Health',
    type: 'RCM',
    description: 'Claims, adjudication outcomes, rejections and remittance.',
    connectionMode: 'FILE_DROP',
    endpoint: 'sftp://rcm-exchange.vida.internal/outbound/opportuna/',
    authMode: 'API_KEY',
    ownerTeam: 'Revenue Cycle',
    status: 'CONNECTED',
    operatorNotes:
      'Nightly CSV drop at 02:00. Files are named claims_YYYYMMDD.csv and are not re-dropped if a load fails — re-request from the RCM team rather than waiting for the next cycle.',
  },
  {
    code: 'PHARMA_SYS',
    name: 'Pharmacy Dispensing System',
    vendor: 'Nahdi Enterprise',
    type: 'PHARMACY',
    description: 'Dispense events across hospital and outpatient pharmacies.',
    connectionMode: 'API_PULL',
    endpoint: 'https://rx.group.internal/api/dispense',
    authMode: 'API_KEY',
    ownerTeam: 'Pharmacy IT',
    status: 'DEGRADED',
    operatorNotes:
      'Outpatient pharmacy dispenses lag by up to 24 hours because the retail sites batch overnight. Refill-overdue thresholds allow for this; do not tighten the grace period below ten days without discussing it with Pharmacy.',
  },
  {
    code: 'THEATRE',
    name: 'Theatre Management System',
    vendor: 'Meditech Surgical',
    type: 'HIS',
    description: 'Surgical bookings, pre-operative workup status and theatre outcomes.',
    connectionMode: 'API_PULL',
    endpoint: 'https://theatre.group.internal/api/cases',
    authMode: 'OAUTH2',
    ownerTeam: 'Surgical Services',
    status: 'CONNECTED',
    operatorNotes:
      'The API defaults to performed cases only. Pass includePlanned=true or the entire surgical conversion pipeline stays invisible — this is the single most common integration mistake on this feed.',
  },
  {
    code: 'REFERRAL_NET',
    name: 'Regional Referral Network',
    vendor: 'MOH Referral Platform',
    type: 'EXTERNAL_API',
    description:
      'Inbound and outbound referrals, including those fulfilled by providers outside the group.',
    connectionMode: 'API_PULL',
    endpoint: 'https://referrals.moh.gov.sa/api/v1',
    authMode: 'OAUTH2',
    ownerTeam: 'Patient Access',
    status: 'DEGRADED',
    operatorNotes:
      'External fulfilment status arrives late and is sometimes never sent. Leakage figures are therefore a floor, not an exact count — state that when reporting them.',
  },
  {
    code: 'MANUAL',
    name: 'Manual File Upload',
    vendor: 'Opportuna',
    type: 'FILE',
    description:
      'Operator-driven CSV upload for backfills, corrections and sources without an automated connector.',
    connectionMode: 'MANUAL_UPLOAD',
    endpoint: null,
    authMode: 'NONE',
    ownerTeam: 'Data Platform',
    status: 'CONNECTED',
    operatorNotes:
      'Every upload runs a dry run first and is attributed to the operator in the audit trail. Use for corrections, not as a substitute for a connector.',
  },
]

/** domain → the source that owns it, plus its scheduling characteristics. */
const PIPELINE_SPECS: Array<{
  domain: string
  source: string
  mode: string
  schedule: string | null
  slaMinutes: number
  expected: number
  watermarkField: string | null
  description: string
}> = [
  {
    domain: 'PATIENT', source: 'VIDA_HIS', mode: 'CDC', schedule: '*/15 * * * *',
    slaMinutes: 20, expected: 180, watermarkField: 'updated_at',
    description: 'Registration and demographic changes, streamed from VIDA CDC. Must lead every clinical feed.',
  },
  {
    domain: 'ENCOUNTER', source: 'VIDA_HIS', mode: 'CDC', schedule: '*/15 * * * *',
    slaMinutes: 20, expected: 850, watermarkField: 'updated_at',
    description: 'Outpatient, inpatient, emergency and day-case activity with the documented follow-up instruction.',
  },
  {
    domain: 'APPOINTMENT', source: 'VIDA_HIS', mode: 'CDC', schedule: '*/15 * * * *',
    slaMinutes: 20, expected: 640, watermarkField: 'updated_at',
    description: 'Bookings and their outcomes, including no-shows and cancellations.',
  },
  {
    domain: 'DIAGNOSIS', source: 'VIDA_HIS', mode: 'INCREMENTAL', schedule: '0 * * * *',
    slaMinutes: 90, expected: 420, watermarkField: 'diagnosed_at',
    description: 'Coded diagnoses with the chronic flag that gates the monitoring and reactivation rules.',
  },
  {
    domain: 'LAB_RESULT', source: 'VIDA_LIS', mode: 'INCREMENTAL', schedule: '0 * * * *',
    slaMinutes: 90, expected: 1250, watermarkField: 'resulted_at',
    description: 'Results and outstanding orders. Critical flags drive the highest-urgency clinical rules.',
  },
  {
    domain: 'CLAIM', source: 'VIDA_RCM', mode: 'FULL', schedule: '0 3 * * *',
    slaMinutes: 240, expected: 2100, watermarkField: null,
    description: 'Nightly claims and rejection extract from the revenue-cycle system.',
  },
  {
    domain: 'PHARMACY', source: 'PHARMA_SYS', mode: 'INCREMENTAL', schedule: '0 */4 * * *',
    slaMinutes: 300, expected: 520, watermarkField: 'dispensed_at',
    description: 'Dispense events. Cadence between them separates a late refill from an abandoned course.',
  },
  {
    domain: 'SURGERY', source: 'THEATRE', mode: 'INCREMENTAL', schedule: '0 */6 * * *',
    slaMinutes: 420, expected: 45, watermarkField: 'updated_at',
    description: 'The full surgical pathway from recommendation through to performance.',
  },
  {
    domain: 'REFERRAL', source: 'REFERRAL_NET', mode: 'INCREMENTAL', schedule: '0 2 * * *',
    slaMinutes: 1440, expected: 70, watermarkField: 'issued_at',
    description: 'Referrals issued and their fulfilment, including those that left the group.',
  },
]

/** Quality rules, keyed to the implementations in src/lib/ingestion/quality.ts. */
const QUALITY_RULES: Array<{
  domain: string
  key: string
  name: string
  dimension: string
  description: string
  expression: string
  threshold: number
  severity: string
}> = [
  { domain: 'PATIENT', key: 'PATIENT_CONTACT_COMPLETENESS', name: 'Patients have a contact number', dimension: 'COMPLETENESS', description: 'Patients without a phone number are unreachable by every outreach rule.', expression: 'count(phone is not null) / count(*)', threshold: 0.8, severity: 'WARNING' },
  { domain: 'PATIENT', key: 'PATIENT_CONSENT_POPULATED', name: 'Marketing consent is being sent', dimension: 'COMPLETENESS', description: 'Consent defaults to false when the column is absent, which silently excludes everyone.', expression: 'count(consent_marketing = true) / count(*)', threshold: 0.5, severity: 'CRITICAL' },
  { domain: 'PATIENT', key: 'PATIENT_DOB_VALIDITY', name: 'Dates of birth are plausible', dimension: 'VALIDITY', description: 'Dates outside a plausible lifespan indicate placeholders or a misparsed format.', expression: 'count(dob between now-120y and now) / count(*)', threshold: 0.99, severity: 'WARNING' },
  { domain: 'PATIENT', key: 'PATIENT_FRESHNESS', name: 'Patient feed is current', dimension: 'TIMELINESS', description: 'The most recent registration should be days old, not months.', expression: 'freshness(max(registered_at))', threshold: 0.5, severity: 'WARNING' },
  { domain: 'ENCOUNTER', key: 'ENCOUNTER_FOLLOWUP_INTERVAL', name: 'Follow-up flags carry an interval', dimension: 'CONSISTENCY', description: 'A follow-up with no interval cannot be measured and the rule ignores it.', expression: 'count(follow_up_days is not null) / count(follow_up_recommended = true)', threshold: 0.9, severity: 'CRITICAL' },
  { domain: 'ENCOUNTER', key: 'ENCOUNTER_PATIENT_LINKAGE', name: 'Encounters resolve to a patient', dimension: 'CONSISTENCY', description: 'Orphaned encounters indicate a load that bypassed reference resolution.', expression: 'count(patient is not null) / count(*)', threshold: 1.0, severity: 'CRITICAL' },
  { domain: 'ENCOUNTER', key: 'ENCOUNTER_FRESHNESS', name: 'Encounter feed is current', dimension: 'TIMELINESS', description: 'Detection scores staleness, so encounter freshness affects every clinical rule.', expression: 'freshness(max(started_at))', threshold: 0.6, severity: 'WARNING' },
  { domain: 'LAB_RESULT', key: 'LAB_FLAG_VALIDITY', name: 'Result flags are recognised', dimension: 'VALIDITY', description: 'An unrecognised flag makes the result invisible to every laboratory rule.', expression: 'count(flag in allowed) / count(*)', threshold: 0.99, severity: 'CRITICAL' },
  { domain: 'LAB_RESULT', key: 'LAB_REPEAT_INTERVAL_COVERAGE', name: 'Monitoring panels carry a cadence', dimension: 'COMPLETENESS', description: 'Without a repeat interval the recurring-monitoring rule has nothing to measure.', expression: 'count(repeat_interval_days is not null) / count(monitoring panels)', threshold: 0.85, severity: 'WARNING' },
  { domain: 'CLAIM', key: 'CLAIM_REJECTION_REASON', name: 'Rejected claims carry a reason', dimension: 'COMPLETENESS', description: 'A rejection with no reason cannot be assigned a recovery pathway.', expression: 'count(rejection exists) / count(status = REJECTED)', threshold: 0.95, severity: 'CRITICAL' },
  { domain: 'CLAIM', key: 'CLAIM_RECOVERY_RATE_POPULATED', name: 'Recovery rates are supplied', dimension: 'COMPLETENESS', description: 'A zero recovery rate puts every rejection below the recoverable threshold.', expression: 'count(recovery_rate > 0) / count(*)', threshold: 0.9, severity: 'CRITICAL' },
  { domain: 'CLAIM', key: 'CLAIM_AMOUNT_CONSISTENCY', name: 'Paid never exceeds approved', dimension: 'CONSISTENCY', description: 'Paid above approved usually means the amount columns are transposed.', expression: 'count(paid <= approved) / count(settled)', threshold: 0.99, severity: 'WARNING' },
  { domain: 'PHARMACY', key: 'PHARMACY_DAYS_SUPPLY', name: 'Days supply is plausible', dimension: 'VALIDITY', description: 'Days supply is what the supply-exhausted date is computed from.', expression: 'count(days_supply between 1 and 365) / count(*)', threshold: 0.99, severity: 'CRITICAL' },
  { domain: 'SURGERY', key: 'SURGERY_PATHWAY_COVERAGE', name: 'Pre-theatre stages are present', dimension: 'COMPLETENESS', description: 'A theatre-only feed makes surgical conversion unmeasurable.', expression: 'count(status in pre-theatre) / count(*)', threshold: 0.3, severity: 'CRITICAL' },
  { domain: 'REFERRAL', key: 'REFERRAL_EXPIRY_POPULATED', name: 'Referrals carry an expiry', dimension: 'COMPLETENESS', description: 'A referral with no expiry never expires and never raises an opportunity.', expression: 'count(expires_at is not null) / count(*)', threshold: 0.9, severity: 'WARNING' },
  { domain: 'DIAGNOSIS', key: 'DIAGNOSIS_CHRONIC_FLAG', name: 'Chronic flag is being sent', dimension: 'COMPLETENESS', description: 'The chronic flag gates the monitoring and reactivation rule families.', expression: 'count(is_chronic = true) > 0', threshold: 1.0, severity: 'CRITICAL' },
]

export async function seedIntegration(): Promise<void> {
  // Children first — issues and results reference runs, runs reference pipelines.
  await prisma.dataQualityResult.deleteMany({})
  await prisma.dataQualityRule.deleteMany({})
  await prisma.ingestionIssue.deleteMany({})
  await prisma.ingestionRun.deleteMany({})
  await prisma.fieldMapping.deleteMany({})
  await prisma.ingestionPipeline.deleteMany({})
  await prisma.sourceSystem.deleteMany({})

  const sourceIds = new Map<string, string>()
  for (const s of SOURCES) {
    const created = await prisma.sourceSystem.create({
      data: {
        ...s,
        lastContactAt: s.status === 'CONNECTED' ? new Date(Date.now() - int(2, 40) * 60_000) : new Date(Date.now() - int(3, 30) * 3600_000),
      },
    })
    sourceIds.set(s.code, created.id)
  }

  const pipelineIds = new Map<string, string>()
  for (const spec of PIPELINE_SPECS) {
    const domain = DOMAINS.find((d) => d.key === spec.domain)
    if (!domain) continue

    const pipeline = await prisma.ingestionPipeline.create({
      data: {
        key: `${spec.source}_${spec.domain}`,
        name: `${domain.label} — ${SOURCES.find((s) => s.code === spec.source)?.name ?? spec.source}`,
        sourceSystemId: sourceIds.get(spec.source)!,
        domain: spec.domain,
        targetEntity: domain.targetEntity,
        mode: spec.mode,
        schedule: spec.schedule,
        slaMinutes: spec.slaMinutes,
        expectedRecordsPerRun: spec.expected,
        watermarkField: spec.watermarkField,
        lastWatermark: spec.watermarkField ? new Date(Date.now() - int(10, 90) * 60_000).toISOString() : null,
        description: spec.description,
      },
    })
    pipelineIds.set(spec.domain, pipeline.id)

    // Mappings are derived from the domain contract, so the screen and the
    // loader cannot drift apart.
    await prisma.fieldMapping.createMany({
      data: domain.fields.map((f) => ({
        pipelineId: pipeline.id,
        sourceField: f.name,
        sourceType: f.type,
        targetField: f.reference ? f.reference.foreignKey : toCamel(f.name),
        targetType: f.reference ? 'reference' : f.type,
        required: f.required,
        isKey: domain.naturalKey.includes(toCamel(f.name)),
        transform: f.reference ? `lookup:${f.reference.entity}.${f.reference.lookupBy}` : null,
        notes: f.description,
      })),
    })
  }

  // Manual upload pipelines: one per domain, so any feed can be backfilled or
  // corrected by hand without an automated connector.
  for (const domain of DOMAINS) {
    await prisma.ingestionPipeline.create({
      data: {
        key: `MANUAL_${domain.key}`,
        name: `${domain.label} — manual upload`,
        sourceSystemId: sourceIds.get('MANUAL')!,
        domain: domain.key,
        targetEntity: domain.targetEntity,
        mode: 'FULL',
        schedule: null,
        slaMinutes: 1440,
        expectedRecordsPerRun: 0,
        description: `Operator-driven CSV upload for ${domain.label.toLowerCase()}. Validated as a dry run before anything is written.`,
      },
    })
  }

  for (const rule of QUALITY_RULES) {
    const pipelineId = pipelineIds.get(rule.domain)
    if (!pipelineId) continue
    await prisma.dataQualityRule.create({
      data: {
        pipelineId,
        key: rule.key,
        name: rule.name,
        dimension: rule.dimension,
        description: rule.description,
        expression: rule.expression,
        threshold: rule.threshold,
        severity: rule.severity,
      },
    })
  }

  await seedRunHistory(pipelineIds)

  const [sources, pipelines, mappings, rules, runs] = await Promise.all([
    prisma.sourceSystem.count(),
    prisma.ingestionPipeline.count(),
    prisma.fieldMapping.count(),
    prisma.dataQualityRule.count(),
    prisma.ingestionRun.count(),
  ])
  console.log(
    `  integration: ${sources} sources, ${pipelines} pipelines, ${mappings} field mappings, ${rules} quality rules, ${runs} runs`
  )
}

/**
 * Fourteen days of run history.
 *
 * Deliberately imperfect: the pharmacy feed has a gap where the retail batch
 * failed, and the referral feed rejects a slice of rows. A history in which
 * everything always succeeded would make the monitoring screens untestable —
 * you could not tell a working alert from one that never fires.
 */
async function seedRunHistory(pipelineIds: Map<string, string>): Promise<void> {
  const runs: Array<Record<string, unknown>> = []
  const issues: Array<Record<string, unknown>> = []
  let issueSeq = 0

  for (const spec of PIPELINE_SPECS) {
    const pipelineId = pipelineIds.get(spec.domain)
    if (!pipelineId) continue

    // Runs per day implied by the cron cadence, capped so a 15-minute feed does
    // not generate 1,300 rows of history.
    const runsPerDay = spec.schedule?.startsWith('*/15') ? 6 : spec.schedule?.startsWith('0 *') ? 4 : 1

    for (let day = 13; day >= 0; day--) {
      for (let r = 0; r < runsPerDay; r++) {
        const startedAt = new Date(Date.now() - day * DAY - int(0, 23) * 3600_000 - int(0, 59) * 60_000)
        if (startedAt.getTime() > Date.now()) continue

        // The pharmacy outage: a two-day gap five days ago.
        const isOutage = spec.domain === 'PHARMACY' && day >= 4 && day <= 5
        if (isOutage) continue

        const read = Math.max(1, Math.round(spec.expected * (0.7 + rnd() * 0.6)))
        // The referral feed's external provider sends incomplete rows.
        const rejectRate = spec.domain === 'REFERRAL' ? 0.06 + rnd() * 0.08 : chance(0.12) ? rnd() * 0.04 : 0
        const rejected = Math.round(read * rejectRate)
        const accepted = read - rejected
        const inserted = Math.round(accepted * (0.25 + rnd() * 0.3))
        const updated = accepted - inserted
        const durationMs = int(1200, 42_000)
        const status = rejected === 0 ? 'SUCCEEDED' : accepted === 0 ? 'FAILED' : 'PARTIAL'

        const runId = `irun${String(runs.length + 1).padStart(7, '0')}`
        runs.push({
          id: runId,
          pipelineId,
          startedAt,
          finishedAt: new Date(startedAt.getTime() + durationMs),
          status,
          trigger: 'SCHEDULE',
          triggeredBy: 'scheduler',
          recordsRead: read,
          recordsInserted: inserted,
          recordsUpdated: updated,
          recordsRejected: rejected,
          bytesProcessed: read * int(180, 640),
          durationMs,
          errorSummary:
            rejected > 0
              ? `${rejected} of ${read} rows rejected. Most common: ${spec.domain === 'REFERRAL' ? 'UNRESOLVED_REFERENCE' : 'INVALID_DATE'}.`
              : null,
        })

        // A sample of issue rows on the worst runs, so the drill-down has
        // something real to show.
        if (rejected > 0 && issueSeq < 220) {
          const sampleCount = Math.min(4, rejected)
          for (let i = 0; i < sampleCount; i++) {
            issueSeq++
            issues.push({
              id: `iiss${String(issueSeq).padStart(7, '0')}`,
              runId,
              rowNumber: int(2, read),
              severity: 'ERROR',
              code: spec.domain === 'REFERRAL' ? 'UNRESOLVED_REFERENCE' : 'INVALID_DATE',
              field: spec.domain === 'REFERRAL' ? 'to_specialty_code' : 'resulted_at',
              message:
                spec.domain === 'REFERRAL'
                  ? 'No Specialty with code = "GENMED". Load that reference data first; the platform does not create placeholder records.'
                  : 'resulted_at must be ISO 8601 (2026-06-18 or 2026-06-18T10:30:00Z). Ambiguous formats like 06/18/2026 are rejected rather than guessed.',
              rawValue: spec.domain === 'REFERRAL' ? 'GENMED' : '06/18/2026',
            })
          }
        }
      }
    }
  }

  for (let i = 0; i < runs.length; i += 300) {
    await prisma.ingestionRun.createMany({ data: runs.slice(i, i + 300) as never })
  }
  for (let i = 0; i < issues.length; i += 300) {
    await prisma.ingestionIssue.createMany({ data: issues.slice(i, i + 300) as never })
  }
}

function toCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

// Runnable on its own: `npx tsx prisma/seed-integration.ts`
if (process.argv[1]?.includes('seed-integration')) {
  seedIntegration()
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
