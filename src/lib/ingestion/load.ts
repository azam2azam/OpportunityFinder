/*
 * Not marked 'server-only': the reset pipeline and operational scripts invoke
 * this from the command line, as they do the detection engine. Web access is
 * gated at the route handlers that call it.
 */
import { prisma } from '../db'
import { DOMAIN_BY_KEY, type DomainSpec, type TargetField } from './domains'
import { coerce, parseForDomain, type ParsedRow } from './parse'

/**
 * The ingestion loader.
 *
 * Validate → resolve references → upsert, with every rejection carrying the row
 * number, field and raw value that caused it.
 *
 * Two properties are deliberate:
 *
 *   Dry run first. Nothing is written until the operator has seen what would
 *   happen. Loading a malformed extract into a platform that then generates
 *   patient outreach from it is not a mistake you want to discover afterwards.
 *
 *   Idempotent. Rows upsert on the domain's declared natural key, so replaying
 *   a file after a partial failure updates rather than duplicates — which is
 *   what makes "just re-send the file" a safe instruction to give an integrator.
 */

export interface LoadIssue {
  rowNumber: number
  severity: 'ERROR' | 'WARNING'
  code: string
  field?: string
  message: string
  rawValue?: string
}

export interface LoadResult {
  domain: string
  dryRun: boolean
  recordsRead: number
  recordsInserted: number
  recordsUpdated: number
  recordsRejected: number
  recordsSkipped: number
  issues: LoadIssue[]
  /** First few accepted rows, for the operator's preview. */
  preview: Array<Record<string, unknown>>
  unknownHeaders: string[]
  missingRequired: string[]
  durationMs: number
}

const MAX_ISSUES = 500

/** Business-key → id caches, so a 10,000-row file does one lookup per code. */
type RefCache = Map<string, Map<string, string>>

export async function loadCsv(
  domainKey: string,
  csv: string,
  options: { dryRun: boolean }
): Promise<LoadResult> {
  const started = Date.now()
  const domain = DOMAIN_BY_KEY[domainKey]
  if (!domain) throw new Error(`Unknown ingestion domain: ${domainKey}`)

  const parsed = parseForDomain(csv, domain)
  const issues: LoadIssue[] = []
  const preview: Array<Record<string, unknown>> = []

  // A file missing a required column is a structural failure. Reporting it once
  // beats emitting the same rejection on every one of ten thousand rows.
  if (parsed.missingRequired.length > 0) {
    for (const field of parsed.missingRequired) {
      issues.push({
        rowNumber: 1,
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_COLUMN',
        field,
        message: `The file has no "${field}" column, which this feed requires.`,
      })
    }
    return {
      domain: domainKey,
      dryRun: options.dryRun,
      recordsRead: parsed.rows.length,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsRejected: parsed.rows.length,
      recordsSkipped: 0,
      issues,
      preview: [],
      unknownHeaders: parsed.unknownHeaders,
      missingRequired: parsed.missingRequired,
      durationMs: Date.now() - started,
    }
  }

  for (const header of parsed.unknownHeaders) {
    // Ignored rather than fatal: source systems routinely carry extra columns,
    // and refusing the file over one would block a valid load.
    issues.push({
      rowNumber: 1,
      severity: 'WARNING',
      code: 'UNKNOWN_COLUMN',
      field: header,
      message: `Column "${header}" is not part of this feed and was ignored.`,
    })
  }

  const refCache: RefCache = new Map()
  let inserted = 0
  let updated = 0
  let rejected = 0
  // No current path skips a row — every row is accepted or rejected. The count
  // is reported so the shape of a run is stable for consumers, and so a future
  // no-op optimisation (skipping rows identical to what is already stored) has
  // somewhere to report itself.
  const skipped = 0

  for (const row of parsed.rows) {
    const built = await buildRecord(domain, row, refCache, issues)
    if (!built) {
      rejected++
      continue
    }

    if (preview.length < 5) preview.push({ _row: row.rowNumber, ...built.display })

    if (options.dryRun) {
      // A dry run still reports which rows would insert and which would update,
      // because "this file will overwrite 4,000 records" is the thing an
      // operator most needs to know before committing.
      const exists = await recordExists(domain, built.where)
      if (exists) updated++
      else inserted++
      continue
    }

    try {
      const outcome = await upsert(domain, built.where, built.data)
      if (outcome === 'inserted') inserted++
      else updated++

      if (built.afterWrite) await built.afterWrite()
    } catch (err) {
      rejected++
      pushIssue(issues, {
        rowNumber: row.rowNumber,
        severity: 'ERROR',
        code: 'WRITE_FAILED',
        message: err instanceof Error ? err.message : 'The row could not be written.',
      })
    }
  }

  return {
    domain: domainKey,
    dryRun: options.dryRun,
    recordsRead: parsed.rows.length,
    recordsInserted: inserted,
    recordsUpdated: updated,
    recordsRejected: rejected,
    recordsSkipped: skipped,
    issues,
    preview,
    unknownHeaders: parsed.unknownHeaders,
    missingRequired: parsed.missingRequired,
    durationMs: Date.now() - started,
  }
}

interface BuiltRecord {
  where: Record<string, unknown>
  data: Record<string, unknown>
  display: Record<string, unknown>
  /** Side effects that belong with the row, e.g. a claim's rejection record. */
  afterWrite?: () => Promise<void>
}

async function buildRecord(
  domain: DomainSpec,
  row: ParsedRow,
  refCache: RefCache,
  issues: LoadIssue[]
): Promise<BuiltRecord | null> {
  const data: Record<string, unknown> = {}
  const display: Record<string, unknown> = {}
  let failed = false

  for (const field of domain.fields) {
    const raw = row.values[field.name] ?? ''
    const result = coerce(field, raw)

    if (!result.ok) {
      failed = true
      pushIssue(issues, {
        rowNumber: row.rowNumber,
        severity: 'ERROR',
        code: result.error.code,
        field: result.error.field,
        message: result.error.message,
        rawValue: result.error.rawValue,
      })
      continue
    }

    if (result.value === null) continue

    if (field.reference) {
      const id = await resolveReference(field, String(result.value), refCache)
      if (!id) {
        failed = true
        pushIssue(issues, {
          rowNumber: row.rowNumber,
          severity: 'ERROR',
          code: 'UNRESOLVED_REFERENCE',
          field: field.name,
          message: `No ${field.reference.entity} with ${field.reference.lookupBy} = "${result.value}". Load that reference data first; the platform does not create placeholder records.`,
          rawValue: raw,
        })
        continue
      }
      data[field.reference.foreignKey] = id
      display[field.name] = result.value
      continue
    }

    const target = toPlatformField(field.name)
    data[target] = result.value
    display[field.name] = result.value
  }

  if (failed) return null

  // Feed-specific shaping that cannot be expressed as a field mapping.
  const shaped = shapeForDomain(domain, data, row, issues)
  if (!shaped) return null

  const where = buildWhere(domain, shaped.data)
  if (!where) {
    pushIssue(issues, {
      rowNumber: row.rowNumber,
      severity: 'ERROR',
      code: 'MISSING_NATURAL_KEY',
      message: `The row has no complete natural key (${domain.naturalKey.join(' + ')}), so it cannot be matched or inserted.`,
    })
    return null
  }

  return { where, data: shaped.data, display, afterWrite: shaped.afterWrite }
}

/** `first_name` → `firstName`; the CSV contract is snake_case, Prisma is camel. */
function toPlatformField(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

async function resolveReference(
  field: TargetField,
  value: string,
  cache: RefCache
): Promise<string | null> {
  const ref = field.reference
  if (!ref) return null

  const key = `${ref.entity}:${ref.lookupBy}`
  let entityCache = cache.get(key)
  if (!entityCache) {
    entityCache = new Map()
    cache.set(key, entityCache)
  }

  const hit = entityCache.get(value)
  if (hit !== undefined) return hit || null

  const client = prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<{ id: string } | null> }>
  const model = client[ref.entity.charAt(0).toLowerCase() + ref.entity.slice(1)]
  if (!model) return null

  const found = await model.findFirst({
    where: { [ref.lookupBy]: value },
    select: { id: true },
  })

  // Misses are cached too — a file with 2,000 rows referencing one bad code
  // should cost one query, not two thousand.
  entityCache.set(value, found?.id ?? '')
  return found?.id ?? null
}

interface ShapedRecord {
  data: Record<string, unknown>
  afterWrite?: () => Promise<void>
}

/**
 * Per-domain adjustments: defaults the platform relies on, and rows that expand
 * into more than one record.
 */
function shapeForDomain(
  domain: DomainSpec,
  data: Record<string, unknown>,
  row: ParsedRow,
  issues: LoadIssue[]
): ShapedRecord | null {
  switch (domain.key) {
    case 'PATIENT': {
      data.sourceSystem = data.sourceSystem ?? 'INGESTED'
      data.contactable = data.contactable ?? true
      // Consent absent means no consent. Defaulting the other way would opt
      // patients into outreach they never agreed to.
      data.consentMarketing = data.consentMarketing ?? false
      data.isDeceased = data.isDeceased ?? false
      data.vipFlag = data.vipFlag ?? false
      data.nationalIdMasked = data.nationalIdMasked ?? '**********'
      data.district = data.district ?? ''
      data.latitude = data.latitude ?? 0
      data.longitude = data.longitude ?? 0
      data.distanceKm = data.distanceKm ?? 0
      data.preferredChannel = data.preferredChannel ?? 'SMS'
      data.language = data.language ?? 'ar'
      data.insuranceStatus = data.insuranceStatus ?? 'UNKNOWN'
      return { data }
    }

    case 'ENCOUNTER': {
      data.sourceSystem = 'INGESTED'
      data.status = data.status ?? 'COMPLETED'
      data.followUpRecommended = data.followUpRecommended ?? false
      data.grossCharge = data.grossCharge ?? 0
      // A follow-up flagged without an interval cannot be measured against
      // anything, so the rule would never fire on it — say so rather than
      // letting it look ingested and working.
      if (data.followUpRecommended === true && data.followUpDays == null) {
        pushIssue(issues, {
          rowNumber: row.rowNumber,
          severity: 'WARNING',
          code: 'FOLLOW_UP_WITHOUT_INTERVAL',
          field: 'follow_up_days',
          message:
            'follow_up_recommended is true but follow_up_days is empty. The follow-up-overdue rule needs an interval and will ignore this encounter.',
        })
      }
      return { data }
    }

    case 'LAB_RESULT': {
      data.sourceSystem = 'INGESTED'
      data.isPending = data.isPending ?? false
      if (data.isPending === true && data.value != null) {
        pushIssue(issues, {
          rowNumber: row.rowNumber,
          severity: 'WARNING',
          code: 'PENDING_WITH_VALUE',
          field: 'value',
          message: 'Marked pending but carries a value. The value was kept and is_pending honoured as sent.',
        })
      }
      return { data }
    }

    case 'APPOINTMENT': {
      data.sourceSystem = 'INGESTED'
      data.isFollowUp = data.isFollowUp ?? false
      data.channel = data.channel ?? 'WALK_IN'
      return { data }
    }

    case 'CLAIM': {
      data.sourceSystem = 'INGESTED'
      data.approvedAmount = data.approvedAmount ?? 0
      data.paidAmount = data.paidAmount ?? 0
      data.resubmissionCount = data.resubmissionCount ?? 0

      // A rejection arrives on the claim row and becomes its own record.
      const reasonCode = data.rejectionReasonCode as string | undefined
      const rejectionFields = [
        'rejectionReasonCode', 'rejectionReasonText', 'rejectionAmount', 'rejectionDate',
        'rejectionAppealable', 'rejectionPathway', 'rejectionRecoveryRate', 'rejectionDepartment',
      ]
      const rejection = Object.fromEntries(rejectionFields.map((f) => [f, data[f]]))
      for (const f of rejectionFields) delete data[f]

      if (data.status === 'REJECTED' && !reasonCode) {
        pushIssue(issues, {
          rowNumber: row.rowNumber,
          severity: 'WARNING',
          code: 'REJECTED_WITHOUT_REASON',
          field: 'rejection_reason_code',
          message:
            'Status is REJECTED but no rejection_reason_code was sent. The recovery module cannot assign a pathway and this claim will not appear as recoverable.',
        })
      }

      if (!reasonCode) return { data }

      const claimNumber = data.claimNumber as string
      const afterWrite = async () => {
        const claim = await prisma.insuranceClaim.findUnique({
          where: { claimNumber },
          select: { id: true },
        })
        if (!claim) return
        const rejectedAmount = (rejection.rejectionAmount as number) ?? (data.billedAmount as number) ?? 0
        const rejectedAt = (rejection.rejectionDate as Date) ?? (data.serviceDate as Date) ?? new Date()

        // One rejection per claim: replay replaces rather than stacks.
        await prisma.insuranceRejection.deleteMany({ where: { claimId: claim.id } })
        await prisma.insuranceRejection.create({
          data: {
            claimId: claim.id,
            reasonCode,
            reasonText: (rejection.rejectionReasonText as string) ?? reasonCode,
            rejectedAmount,
            rejectedAt,
            isAppealable: (rejection.rejectionAppealable as boolean) ?? true,
            recommendedPathway: (rejection.rejectionPathway as string) ?? null,
            historicalRecoveryRate: (rejection.rejectionRecoveryRate as number) ?? 0,
            responsibleDepartment:
              (rejection.rejectionDepartment as string) ?? (data.departmentName as string) ?? 'Unassigned',
          },
        })
      }
      return { data, afterWrite }
    }

    case 'PHARMACY': {
      data.isRefill = data.isRefill ?? false
      data.amount = data.amount ?? 0
      return { data }
    }

    case 'SURGERY': {
      data.workupComplete = data.workupComplete ?? false
      data.estimatedValue = data.estimatedValue ?? 0
      data.urgency = data.urgency ?? 'ELECTIVE'
      return { data }
    }

    case 'REFERRAL': {
      data.direction = data.direction ?? 'INTERNAL'
      data.estimatedValue = data.estimatedValue ?? 0
      return { data }
    }

    case 'DIAGNOSIS': {
      data.rank = data.rank ?? 'PRIMARY'
      data.isChronic = data.isChronic ?? false
      return { data }
    }

    default:
      return { data }
  }
}

function buildWhere(domain: DomainSpec, data: Record<string, unknown>): Record<string, unknown> | null {
  const where: Record<string, unknown> = {}
  for (const key of domain.naturalKey) {
    const value = data[key]
    if (value == null) return null
    where[key] = value
  }
  return where
}

type PrismaDelegate = {
  findFirst: (a: unknown) => Promise<{ id: string } | null>
  create: (a: unknown) => Promise<{ id: string }>
  update: (a: unknown) => Promise<{ id: string }>
}

function delegateFor(entity: string): PrismaDelegate {
  const client = prisma as unknown as Record<string, PrismaDelegate>
  const delegate = client[entity.charAt(0).toLowerCase() + entity.slice(1)]
  if (!delegate) throw new Error(`No Prisma delegate for ${entity}`)
  return delegate
}

async function recordExists(domain: DomainSpec, where: Record<string, unknown>): Promise<boolean> {
  const found = await delegateFor(domain.targetEntity).findFirst({ where, select: { id: true } })
  return Boolean(found)
}

/**
 * Upsert on the natural key.
 *
 * `findFirst` then create-or-update rather than Prisma's `upsert`, because a
 * natural key like `patientId + icd10 + diagnosedAt` is not a declared unique
 * constraint and `upsert` requires one.
 */
async function upsert(
  domain: DomainSpec,
  where: Record<string, unknown>,
  data: Record<string, unknown>
): Promise<'inserted' | 'updated'> {
  const delegate = delegateFor(domain.targetEntity)
  const existing = await delegate.findFirst({ where, select: { id: true } })
  if (existing) {
    await delegate.update({ where: { id: existing.id }, data })
    return 'updated'
  }
  await delegate.create({ data })
  return 'inserted'
}

function pushIssue(issues: LoadIssue[], issue: LoadIssue): void {
  // Capped: a completely misaligned file would otherwise generate one issue per
  // row per field and overwhelm both the response and the issue table.
  if (issues.length >= MAX_ISSUES) return
  issues.push(issue)
}

export { MAX_ISSUES }
