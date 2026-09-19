import 'server-only'
import { prisma } from '../db'
import { audit } from '../audit'
import { can, type Principal } from '../rbac'
import { templateProvider, EXAMPLE_QUESTIONS } from './templates'
import { validateSql } from './validator'
import type { AskResult, NlSqlProvider } from './types'

/**
 * Ask Data orchestration: NL → SQL → validation → execution → visualisation →
 * explanation (spec section 18).
 *
 * The order matters and is not negotiable. Generation is untrusted, so nothing
 * generated reaches the database until `validateSql` has passed it, and the
 * hospital scope is bound by the provider rather than appended here — appending
 * a scope clause to arbitrary SQL is not safely possible, whereas requiring the
 * provider to bind it is.
 *
 * Every question is written to NlQuery whether it succeeded, was blocked or
 * errored. The spec requires AI interaction auditing, and a log that only
 * records successes is precisely the wrong half.
 */

let provider: NlSqlProvider = templateProvider

/** Swap in the enterprise NL-to-SQL engine at startup. */
export function registerProvider(next: NlSqlProvider): void {
  provider = next
}

export async function ask(principal: Principal, question: string): Promise<AskResult> {
  const started = Date.now()
  const trimmed = question.trim().slice(0, 500)

  const base: AskResult = {
    question: trimmed,
    interpretation: '',
    validation: 'BLOCKED_PARSE',
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs: 0,
    visualization: 'table',
    explanation: '',
    suggestions: EXAMPLE_QUESTIONS.slice(0, 6),
    source: provider.name,
  }

  // Group-scope principals pass an empty list, which the provider reads as
  // "no restriction". Everyone else is bound to their own hospitals.
  const hospitalIds = principal.scopeLevel === 'GROUP' ? [] : principal.hospitalIds

  let generation
  try {
    generation = await provider.generate({ question: trimmed, principal, hospitalIds })
  } catch (err) {
    return finish(principal, {
      ...base,
      validation: 'ERROR',
      validationNote: err instanceof Error ? err.message : 'The query engine failed.',
      explanation: 'The question could not be processed. Try rephrasing it, or pick one of the suggestions.',
      durationMs: Date.now() - started,
    })
  }

  if (!generation) {
    return finish(principal, {
      ...base,
      validation: 'BLOCKED_PARSE',
      validationNote: 'No matching query pattern.',
      interpretation: 'Not understood',
      explanation:
        'This question does not match anything in the Ask Data semantic model. The engine answers questions about opportunities, claims and rejections, laboratory follow-up, surgery conversion, medication adherence, referral leakage, capacity, conversion rates and SLA performance. Try one of the suggestions below, or use the Opportunity Center filters for a specific cohort.',
      durationMs: Date.now() - started,
    })
  }

  const validation = validateSql(generation.sql)
  if (!validation.ok || !validation.effectiveSql) {
    return finish(principal, {
      ...base,
      interpretation: generation.interpretation,
      validation: validation.code,
      validationNote: validation.note,
      visualization: generation.visualization,
      sql: can(principal, 'askdata.viewsql') ? generation.sql : undefined,
      explanation:
        'The generated query was blocked before it reached the database. ' +
        (validation.note ?? '') +
        ' Ask Data is read-only by design and cannot modify or delete anything.',
      durationMs: Date.now() - started,
      source: generation.source,
    })
  }

  let rows: Array<Record<string, unknown>> = []
  try {
    rows = (await prisma.$queryRawUnsafe(
      validation.effectiveSql,
      ...generation.params
    )) as Array<Record<string, unknown>>
  } catch (err) {
    return finish(principal, {
      ...base,
      interpretation: generation.interpretation,
      validation: 'ERROR',
      validationNote: err instanceof Error ? err.message : 'Query execution failed.',
      sql: can(principal, 'askdata.viewsql') ? validation.effectiveSql : undefined,
      explanation: 'The query was valid but failed during execution. This has been recorded for review.',
      durationMs: Date.now() - started,
      source: generation.source,
    })
  }

  // BigInt comes back from SQLite COUNT(); JSON cannot serialise it.
  const normalised = rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])
    )
  )

  const columns = normalised.length > 0 ? Object.keys(normalised[0]) : []
  const durationMs = Date.now() - started

  return finish(principal, {
    question: trimmed,
    interpretation: generation.interpretation,
    validation: 'PASSED',
    columns,
    rows: normalised,
    rowCount: normalised.length,
    durationMs,
    visualization: normalised.length === 0 ? 'table' : generation.visualization,
    labelColumn: generation.labelColumn,
    valueColumns: generation.valueColumns,
    explanation: explain(generation.interpretation, normalised, columns, generation.confidence, hospitalIds.length),
    sql: can(principal, 'askdata.viewsql') ? validation.effectiveSql : undefined,
    suggestions: EXAMPLE_QUESTIONS.filter((q) => q.toLowerCase() !== trimmed.toLowerCase()).slice(0, 6),
    source: generation.source,
  })
}

/**
 * Writes the interaction to the audit trail, then returns the result.
 *
 * The stored preview is capped and kept small on purpose: it exists so an
 * auditor can see what was disclosed, not so the result set is duplicated into
 * a second table that then needs its own retention policy.
 */
async function finish(principal: Principal, result: AskResult): Promise<AskResult> {
  try {
    await prisma.nlQuery.create({
      data: {
        userId: principal.userId,
        question: result.question,
        generatedSql: result.sql ?? null,
        validation: result.validation,
        validationNote: result.validationNote,
        rowCount: result.rowCount,
        durationMs: result.durationMs,
        visualization: result.visualization,
        explanation: result.explanation.slice(0, 1000),
        resultPreview: JSON.stringify(result.rows.slice(0, 3)),
        engine: result.source,
      },
    })
  } catch (err) {
    console.error('[askdata] failed to record query', err)
  }

  await audit(principal, {
    category: result.validation === 'PASSED' ? 'NL_QUERY' : 'SECURITY',
    action: result.validation === 'PASSED' ? 'ASK_DATA_QUERY' : `ASK_DATA_${result.validation}`,
    detail: {
      question: result.question,
      rowCount: result.rowCount,
      engine: result.source,
      note: result.validationNote,
    },
    outcome: result.validation === 'PASSED' ? 'SUCCESS' : 'DENIED',
  })

  return result
}

/** Turns the result into a sentence, so the number is never handed over bare. */
function explain(
  interpretation: string,
  rows: Array<Record<string, unknown>>,
  columns: string[],
  confidence: number,
  scopedHospitals: number
): string {
  const parts: string[] = [interpretation]

  if (rows.length === 0) {
    parts.push('No rows matched. That may be a genuine nil result, or the filters may be narrower than intended.')
  } else {
    parts.push(`${rows.length} row${rows.length === 1 ? '' : 's'} returned.`)

    // Lead with the top row on a ranked result: that is the answer the reader
    // is usually after, and making them find it in a table is a wasted step.
    const labelCol = columns[0]
    const numericCol = columns.find((c) => typeof rows[0][c] === 'number' && c !== labelCol)
    if (labelCol && numericCol && rows.length > 1) {
      const top = rows[0]
      parts.push(
        `Highest: ${String(top[labelCol])} at ${formatNumber(top[numericCol])} ${humaniseColumn(numericCol)}.`
      )
      const total = rows.reduce((s, r) => s + (typeof r[numericCol] === 'number' ? (r[numericCol] as number) : 0), 0)
      if (total > 0) {
        const share = ((top[numericCol] as number) / total) * 100
        if (share >= 25) {
          parts.push(`That is ${Math.round(share)}% of the total across all rows.`)
        }
      }
    }
  }

  if (scopedHospitals > 0) {
    parts.push(
      `Results are restricted to the ${scopedHospitals} hospital${scopedHospitals === 1 ? '' : 's'} in your access scope.`
    )
  }

  if (confidence < 0.65) {
    parts.push(
      'The question matched more than one pattern equally well, so check the interpretation above reflects what you meant.'
    )
  }

  return parts.join(' ')
}

function formatNumber(v: unknown): string {
  if (typeof v === 'number') return v.toLocaleString('en-US')
  return String(v)
}

function humaniseColumn(c: string): string {
  return c.replace(/_/g, ' ')
}

export { EXAMPLE_QUESTIONS }
export type { AskResult } from './types'
