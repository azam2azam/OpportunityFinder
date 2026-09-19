'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { Send, Loader2, ShieldAlert, Info } from 'lucide-react'
import { HorizontalBars, TrendLines, Donut } from './Charts'

interface AskResponse {
  question: string
  interpretation: string
  validation: string
  validationNote?: string
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  visualization: 'table' | 'bar' | 'line' | 'donut' | 'funnel' | 'scalar'
  labelColumn?: string
  valueColumns?: string[]
  explanation: string
  sql?: string
  suggestions: string[]
  source: string
}

/**
 * The Ask Data console.
 *
 * Results are shown as answer → visualisation → data → provenance, in that
 * order. The explanation leads because a number without a reading of it is how
 * dashboards get misinterpreted; the SQL sits at the bottom, collapsed, for the
 * authorised technical users who need to check the engine's work.
 */
export function AskData({
  examples,
  canViewSql,
}: {
  examples: string[]
  canViewSql: boolean
}) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AskResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSql, setShowSql] = useState(false)
  const [history, setHistory] = useState<string[]>([])

  async function submit(q: string) {
    const text = q.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'The question could not be answered.')
        setResult(null)
      } else {
        setResult(data)
        setHistory((h) => [text, ...h.filter((x) => x !== text)].slice(0, 8))
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const blocked = result && result.validation !== 'PASSED'

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(question)
        }}
        className="card card-pad"
      >
        <label htmlFor="ask" className="label mb-1.5 block">
          Ask the hospital data
        </label>
        <div className="flex gap-2">
          <input
            id="ask"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Which hospitals have the highest number of rejected claims?"
            className="input flex-1"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !question.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">{busy ? 'Thinking…' : 'Ask'}</span>
          </button>
        </div>

        <div className="mt-3">
          <p className="label mb-1.5">Try one of these</p>
          <div className="flex flex-wrap gap-1.5">
            {examples.slice(0, 8).map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setQuestion(ex)
                  submit(ex)
                }}
                className="chip border-ink-200 bg-white text-left text-ink-600 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {history.length > 0 && (
          <div className="mt-3 border-t border-ink-100 pt-3 dark:border-ink-800">
            <p className="label mb-1.5">Recent</p>
            <div className="flex flex-wrap gap-1.5">
              {history.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setQuestion(h)
                    submit(h)
                  }}
                  className="chip border-transparent bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300"
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>

      {error && (
        <div role="alert" className="card card-pad border-danger-100 bg-danger-50 dark:border-danger-700 dark:bg-danger-700/15">
          <p className="text-sm text-danger-700 dark:text-danger-500">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div
            className={clsx(
              'card card-pad',
              blocked && 'border-warn-100 bg-warn-50 dark:border-warn-700 dark:bg-warn-700/10'
            )}
          >
            <div className="flex items-start gap-2.5">
              {blocked ? (
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-600" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                  {result.interpretation || 'Not understood'}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                  {result.explanation}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-400">
                  <span>
                    Validation:{' '}
                    <span
                      className={clsx(
                        'font-medium',
                        result.validation === 'PASSED'
                          ? 'text-positive-600 dark:text-positive-500'
                          : 'text-warn-700 dark:text-warn-500'
                      )}
                    >
                      {result.validation}
                    </span>
                  </span>
                  <span>Engine: {result.source}</span>
                  <span>{result.durationMs} ms</span>
                  <span>{result.rowCount} rows</span>
                  <span>Logged to the audit trail</span>
                </p>
                {result.validationNote && (
                  <p className="mt-1.5 text-xs text-warn-700 dark:text-warn-500">{result.validationNote}</p>
                )}
              </div>
            </div>
          </div>

          {result.rowCount > 0 && (
            <>
              {result.visualization !== 'table' && (
                <div className="card card-pad">
                  <p className="label mb-2">Visualisation</p>
                  <Visualisation result={result} />
                </div>
              )}

              <div className="card card-pad">
                <div className="mb-2 flex items-center justify-between">
                  <p className="label">Data</p>
                  <button
                    onClick={() => downloadCsv(result)}
                    className="btn btn-secondary px-2 py-1 text-xs"
                  >
                    Download CSV
                  </button>
                </div>
                <div className="scroll-x">
                  <table className="w-full min-w-[520px] border-collapse">
                    <thead className="border-b border-ink-200 dark:border-ink-800">
                      <tr>
                        {result.columns.map((c) => (
                          <th key={c} className="th">
                            {c.replace(/_/g, ' ')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                      {result.rows.slice(0, 100).map((row, i) => (
                        <tr key={i}>
                          {result.columns.map((c) => (
                            <td
                              key={c}
                              className={clsx('td', typeof row[c] === 'number' && 'tabular text-right')}
                            >
                              {formatCell(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.rows.length > 100 && (
                  <p className="mt-2 text-xs text-ink-400">
                    Showing the first 100 of {result.rowCount} rows. Download the CSV for the full
                    result.
                  </p>
                )}
              </div>
            </>
          )}

          {canViewSql && result.sql && (
            <div className="card card-pad">
              <button
                onClick={() => setShowSql((v) => !v)}
                className="flex w-full items-center justify-between text-left"
                aria-expanded={showSql}
              >
                <span className="label">Generated SQL</span>
                <span className="text-xs text-ink-400">{showSql ? 'Hide' : 'Show'}</span>
              </button>
              {showSql && (
                <pre className="mt-2 overflow-x-auto rounded-md bg-ink-900 p-3 text-xs leading-relaxed text-ink-100 dark:bg-ink-950">
                  <code>{formatSql(result.sql)}</code>
                </pre>
              )}
              <p className="mt-2 text-xs text-ink-400">
                Visible because your role holds askdata.viewsql. The query was validated as
                read-only, restricted to the Ask Data semantic model, and bounded before execution.
              </p>
            </div>
          )}

          {result.suggestions.length > 0 && (
            <div className="card card-pad">
              <p className="label mb-2">Ask next</p>
              <div className="flex flex-wrap gap-1.5">
                {result.suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setQuestion(s)
                      submit(s)
                    }}
                    className="chip border-ink-200 bg-white text-left text-ink-600 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Visualisation({ result }: { result: AskResponse }) {
  const label = result.labelColumn ?? result.columns[0]
  const values = result.valueColumns?.length
    ? result.valueColumns
    : [result.columns.find((c) => typeof result.rows[0]?.[c] === 'number') ?? result.columns[1]]

  const primary = values[0]
  if (!label || !primary) return null

  const isMoney = /value|amount|revenue|rejected/i.test(primary)

  if (result.visualization === 'line') {
    return (
      <TrendLines
        data={result.rows.map((r) => ({
          period: String(r[label]),
          ...Object.fromEntries(values.map((v) => [v, Number(r[v] ?? 0)])),
        }))}
        series={values.map((v) => ({ key: v, name: v.replace(/_/g, ' ') }))}
        money={isMoney}
      />
    )
  }

  if (result.visualization === 'donut') {
    return (
      <Donut
        data={result.rows.map((r) => ({ label: String(r[label]), value: Number(r[primary] ?? 0) }))}
        money={isMoney}
      />
    )
  }

  return (
    <HorizontalBars
      data={result.rows.slice(0, 16).map((r) => ({
        label: String(r[label]),
        value: Number(r[primary] ?? 0),
      }))}
      money={isMoney}
      height={Math.max(200, Math.min(16, result.rows.length) * 32)}
    />
  )
}

function formatCell(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return v.toLocaleString('en-US')
  return String(v)
}

/** Light formatting so a one-line query is readable without a SQL formatter. */
function formatSql(sql: string): string {
  return sql
    .replace(/\s+(FROM|WHERE|GROUP BY|ORDER BY|LIMIT|LEFT JOIN|JOIN|AND|HAVING)\s+/gi, '\n$1 ')
    .replace(/,\s*/g, ',\n       ')
    .trim()
}

function downloadCsv(result: AskResponse) {
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    result.columns.join(','),
    ...result.rows.map((r) => result.columns.map((c) => escape(r[c])).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ask-data-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
