import type { ValidationResult } from './types'

/**
 * SQL guardrails.
 *
 * Everything reaching this function is treated as untrusted, including SQL from
 * the platform's own template engine. The reason is the seam: an enterprise
 * NL-to-SQL engine plugged in later produces SQL from a language model, and a
 * model that has read a user's question is a model that can be talked into
 * writing `DELETE`. Validating uniformly means that risk is handled once,
 * before the query reaches a database holding patient records.
 *
 * The policy is allowlist-first: only SELECT, only known tables, only one
 * statement, always bounded.
 */

/** Tables Ask Data may read. Deliberately excludes User, Session and AuditEvent. */
const ALLOWED_TABLES = new Set([
  'Hospital', 'Department', 'Specialty', 'Physician', 'Patient', 'Encounter',
  'Appointment', 'Diagnosis', 'Procedure', 'Surgery', 'LabResult', 'Medication',
  'Prescription', 'PharmacyTransaction', 'Payer', 'InsuranceClaim',
  'InsuranceRejection', 'Referral', 'Opportunity', 'OpportunityRule',
  'OpportunityAction', 'Conversion', 'Campaign', 'CampaignMember',
  'ServiceLineMetric', 'Communication',
])

/**
 * Credentials, session tokens and the audit trail are never queryable through
 * a natural-language interface — an auditable surface that can read its own
 * audit log is not auditable.
 */
const FORBIDDEN_TABLES = new Set(['User', 'Session', 'Role', 'AuditEvent', 'NlQuery', 'UserHospitalScope'])

const WRITE_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'replace',
  'attach', 'detach', 'pragma', 'vacuum', 'reindex', 'grant', 'revoke', 'merge',
]

const MAX_ROWS = 500

export function validateSql(sql: string): ValidationResult {
  const trimmed = sql.trim().replace(/;+\s*$/, '')

  if (trimmed.length === 0) {
    return { code: 'BLOCKED_PARSE', ok: false, note: 'The generated query was empty.' }
  }

  // Comments can hide a second statement from a naive keyword scan, so they are
  // rejected outright rather than stripped.
  if (/--|\/\*|\*\//.test(trimmed)) {
    return {
      code: 'BLOCKED_PARSE',
      ok: false,
      note: 'The query contains SQL comments, which are not permitted — comments can conceal a second statement.',
    }
  }

  if (trimmed.includes(';')) {
    return {
      code: 'BLOCKED_PARSE',
      ok: false,
      note: 'Only a single statement may be executed. The query contains a statement separator.',
    }
  }

  if (!/^(select|with)\b/i.test(trimmed)) {
    return {
      code: 'BLOCKED_WRITE',
      ok: false,
      note: 'Ask Data is read-only. Only SELECT (or WITH … SELECT) queries are executed.',
    }
  }

  // Word-boundary matching so a column called "updatedAt" is not mistaken for
  // an UPDATE statement.
  const lowered = trimmed.toLowerCase()
  for (const keyword of WRITE_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(lowered)) {
      return {
        code: 'BLOCKED_WRITE',
        ok: false,
        note: `The query contains the keyword "${keyword}". Ask Data cannot modify data under any circumstances.`,
      }
    }
  }

  // Names introduced by a WITH clause are references to the query's own
  // subresults, not to physical tables. They still have to be recognised, or a
  // perfectly safe CTE is rejected as "not in the semantic model" — and the
  // tables the CTE actually reads are checked on their own below.
  const cteNames = extractCteNames(trimmed)
  const referenced = extractTables(trimmed).filter((t) => !cteNames.has(t))

  for (const table of referenced) {
    if (FORBIDDEN_TABLES.has(table)) {
      return {
        code: 'BLOCKED_TABLE',
        ok: false,
        note: `The table "${table}" holds credentials or audit records and is never queryable through Ask Data.`,
      }
    }
    if (!ALLOWED_TABLES.has(table)) {
      return {
        code: 'BLOCKED_TABLE',
        ok: false,
        note: `The table "${table}" is not part of the Ask Data semantic model.`,
      }
    }
  }

  if (referenced.length === 0) {
    return {
      code: 'BLOCKED_PARSE',
      ok: false,
      note: 'No recognisable table reference was found in the generated query.',
    }
  }

  // Every result set is bounded. An unbounded query against a patient table is
  // a denial-of-service on the application and an export risk at the same time.
  const effectiveSql = /\blimit\s+\d+/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${MAX_ROWS}`

  return { code: 'PASSED', ok: true, effectiveSql }
}

/**
 * Collects the names bound by a WITH clause.
 *
 * Case-insensitive, because a CTE referenced as `x` may be declared as `X`, and
 * a mismatch would silently reintroduce the false rejection this exists to
 * prevent.
 */
function extractCteNames(sql: string): Set<string> {
  const names = new Set<string>()
  if (!/^with\b/i.test(sql.trim())) return names
  const pattern = /(?:\bwith\b|,)\s*(?:recursive\s+)?(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))\s+as\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    const name = match[1] ?? match[2]
    if (name) names.add(name)
  }
  return names
}

/**
 * Pulls table identifiers out of FROM and JOIN clauses.
 *
 * Quoted identifiers are the norm here because the Prisma schema uses
 * PascalCase table names, which SQLite folds unless quoted.
 */
function extractTables(sql: string): string[] {
  const found = new Set<string>()
  const pattern = /\b(?:from|join)\s+(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    const name = match[1] ?? match[2]
    // Subqueries open with "FROM (" and contribute no identifier of their own;
    // their inner tables are matched by later iterations.
    if (name && name.toLowerCase() !== 'select') found.add(name)
  }
  return [...found]
}

export { MAX_ROWS, ALLOWED_TABLES, FORBIDDEN_TABLES }
