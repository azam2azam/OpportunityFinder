import type { Principal } from '../rbac'

/**
 * Ask Data contract.
 *
 * The spec says the hospital already operates a natural-language-to-SQL engine
 * and that this platform should integrate it. That is exactly what this
 * interface is for: `NlSqlProvider` is the seam. The shipped implementation is
 * a deterministic template engine (see templates.ts), and an enterprise engine
 * is dropped in by implementing this interface and registering it — nothing
 * downstream changes, because validation, scope enforcement, execution and
 * auditing all happen on this side of the seam regardless of who generated the
 * SQL.
 *
 * That ordering is deliberate. An external engine is untrusted input: its
 * output is validated before it reaches the database, never after.
 */

export interface NlSqlRequest {
  question: string
  principal: Principal
  /** Hospital ids the caller may read; empty means unrestricted (group scope). */
  hospitalIds: string[]
}

export interface NlSqlGeneration {
  sql: string
  /** Positional parameters for the SQL, in order. */
  params: unknown[]
  /** What the query is understood to be asking, in plain language. */
  interpretation: string
  /** Chart type the result is best shown as. */
  visualization: VisualizationKind
  /** Which column is the label and which the measure, for charting. */
  labelColumn?: string
  valueColumns?: string[]
  /** 0..1 confidence that this reading matches the question. */
  confidence: number
  /** Identifier of the template or model that produced this. */
  source: string
}

export type VisualizationKind = 'table' | 'bar' | 'line' | 'donut' | 'funnel' | 'scalar'

export type ValidationCode =
  | 'PASSED'
  | 'BLOCKED_WRITE'
  | 'BLOCKED_TABLE'
  | 'BLOCKED_SCOPE'
  | 'BLOCKED_PARSE'
  | 'ERROR'

export interface ValidationResult {
  code: ValidationCode
  ok: boolean
  note?: string
  /** The SQL actually sent to the database, after limits are applied. */
  effectiveSql?: string
}

export interface AskResult {
  question: string
  interpretation: string
  validation: ValidationCode
  validationNote?: string
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  visualization: VisualizationKind
  labelColumn?: string
  valueColumns?: string[]
  explanation: string
  /** Only populated for principals holding askdata.viewsql. */
  sql?: string
  /** Suggested follow-up questions the engine can also answer. */
  suggestions: string[]
  source: string
}

export interface NlSqlProvider {
  name: string
  generate(request: NlSqlRequest): Promise<NlSqlGeneration | null>
}
