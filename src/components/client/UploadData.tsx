'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileText } from 'lucide-react'

export interface DomainOption {
  key: string
  label: string
  description: string
  targetEntity: string
  naturalKey: string[]
  requiredFields: string[]
  fieldCount: number
  pipelineId: string
  operatorNotes: string[]
}

interface UploadResponse {
  ok: boolean
  error?: string
  runId?: string | null
  status?: string
  dryRun?: boolean
  load?: {
    recordsRead: number
    recordsInserted: number
    recordsUpdated: number
    recordsRejected: number
    issues: Array<{
      rowNumber: number
      severity: string
      code: string
      field?: string
      message: string
      rawValue?: string
    }>
    preview: Array<Record<string, unknown>>
    unknownHeaders: string[]
    missingRequired: string[]
    durationMs: number
  }
  quality?: Array<{
    name: string
    passed: boolean
    measuredValue: number
    threshold: number
    severity: string
    remediation: string
  }>
}

/**
 * The upload workflow: choose a feed, validate, then commit.
 *
 * Commit is gated on a dry run having been done for the exact file in hand.
 * Loading an unvalidated extract into a platform that generates patient
 * outreach from it is not a mistake worth allowing in a single click, and the
 * dry run costs seconds.
 */
export function UploadData({
  domains,
  initialDomain,
}: {
  domains: DomainOption[]
  initialDomain?: string
}) {
  const router = useRouter()
  const [domainKey, setDomainKey] = useState(initialDomain ?? domains[0]?.key ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [csv, setCsv] = useState<string>('')
  const [busy, setBusy] = useState<'validate' | 'commit' | null>(null)
  const [result, setResult] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The file the dry run actually validated, so a swapped file re-locks commit. */
  const [validatedSignature, setValidatedSignature] = useState<string | null>(null)

  const domain = domains.find((d) => d.key === domainKey)
  const signature = file ? `${domainKey}:${file.name}:${file.size}` : null
  const canCommit =
    validatedSignature !== null && validatedSignature === signature && (result?.load?.recordsRead ?? 0) > 0

  async function readFile(f: File) {
    const text = await f.text()
    setCsv(text)
    setFile(f)
    setResult(null)
    setValidatedSignature(null)
    setError(null)
  }

  async function submit(dryRun: boolean) {
    if (!csv || !domain) return
    setBusy(dryRun ? 'validate' : 'commit')
    setError(null)
    try {
      const res = await fetch('/api/integration/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineId: domain.pipelineId,
          fileName: file?.name ?? 'pasted.csv',
          csv,
          dryRun,
        }),
      })
      const data: UploadResponse = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'The upload failed.')
        setResult(null)
      } else {
        setResult(data)
        if (dryRun) setValidatedSignature(signature)
        else {
          // A committed file must be re-validated before it can be sent again,
          // so a double-click cannot load it twice.
          setValidatedSignature(null)
          router.refresh()
        }
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(null)
    }
  }

  const load = result?.load
  const errors = load?.issues.filter((i) => i.severity === 'ERROR') ?? []
  const warnings = load?.issues.filter((i) => i.severity === 'WARNING') ?? []

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <label htmlFor="domain" className="label mb-1.5 block">
          Which feed is this?
        </label>
        <select
          id="domain"
          value={domainKey}
          onChange={(e) => {
            setDomainKey(e.target.value)
            setResult(null)
            setValidatedSignature(null)
          }}
          className="input max-w-md"
        >
          {domains.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>

        {domain && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-600 dark:text-ink-300">{domain.description}</p>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="label">Natural key</dt>
                <dd className="mt-0.5 font-mono text-xs text-ink-900 dark:text-ink-100">
                  {domain.naturalKey.join(' + ')}
                </dd>
              </div>
              <div>
                <dt className="label">Required columns</dt>
                <dd className="mt-0.5 text-xs text-ink-900 dark:text-ink-100">
                  {domain.requiredFields.length} of {domain.fieldCount}
                </dd>
              </div>
              <div>
                <dt className="label">Template</dt>
                <dd className="mt-0.5">
                  <a
                    href={`/api/integration/template/${domain.key}`}
                    className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                  >
                    Download CSV template →
                  </a>
                </dd>
              </div>
            </dl>
            <div className="rounded-md border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/40">
              <p className="text-2xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">
                Before you upload
              </p>
              <ul className="mt-1.5 space-y-1">
                {domain.operatorNotes.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-brand-900/90 dark:text-brand-100/90">
                    <span aria-hidden className="text-brand-400">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="card card-pad">
        <label htmlFor="file" className="label mb-1.5 block">
          CSV file
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readFile(f)
            }}
            className="input max-w-sm file:mr-3 file:rounded file:border-0 file:bg-brand-600 file:px-3 file:py-1 file:text-xs file:font-medium file:text-white"
          />
          {file && (
            <span className="flex items-center gap-1.5 text-xs text-ink-600 dark:text-ink-300">
              <FileText className="h-3.5 w-3.5" />
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
          <button
            onClick={() => submit(true)}
            disabled={!csv || busy !== null}
            className="btn btn-secondary"
          >
            {busy === 'validate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {busy === 'validate' ? 'Validating…' : 'Validate (dry run)'}
          </button>
          <button
            onClick={() => submit(false)}
            disabled={!canCommit || busy !== null}
            className="btn btn-primary"
            title={canCommit ? undefined : 'Run a dry run on this file first.'}
          >
            {busy === 'commit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy === 'commit' ? 'Loading…' : 'Commit to platform'}
          </button>
          {!canCommit && csv && (
            <span className="text-xs text-ink-500 dark:text-ink-400">
              Commit unlocks once this exact file has passed a dry run.
            </span>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="card card-pad border-danger-100 bg-danger-50 dark:border-danger-700 dark:bg-danger-700/15">
          <p className="text-sm text-danger-700 dark:text-danger-500">{error}</p>
        </div>
      )}

      {load && (
        <>
          <div
            className={clsx(
              'card card-pad',
              result?.dryRun
                ? 'border-brand-200 dark:border-brand-800'
                : 'border-positive-100 dark:border-positive-900'
            )}
          >
            <div className="flex items-start gap-2.5">
              {errors.length > 0 ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn-600" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                  {result?.dryRun
                    ? 'Validation complete — nothing was written'
                    : 'Loaded into the platform'}
                </p>
                <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
                  {load.recordsRead.toLocaleString()} rows read.{' '}
                  {result?.dryRun ? 'Would insert' : 'Inserted'}{' '}
                  <strong>{load.recordsInserted.toLocaleString()}</strong>,{' '}
                  {result?.dryRun ? 'would update' : 'updated'}{' '}
                  <strong>{load.recordsUpdated.toLocaleString()}</strong>
                  {load.recordsRejected > 0 && (
                    <>
                      , rejected{' '}
                      <strong className="text-warn-700 dark:text-warn-500">
                        {load.recordsRejected.toLocaleString()}
                      </strong>
                    </>
                  )}
                  . ({load.durationMs} ms)
                </p>
                {load.recordsUpdated > 0 && result?.dryRun && (
                  <p className="mt-1 text-xs text-warn-700 dark:text-warn-500">
                    This file will overwrite {load.recordsUpdated.toLocaleString()} existing records.
                    Check that is intended before committing.
                  </p>
                )}
              </div>
            </div>
          </div>

          {load.missingRequired.length > 0 && (
            <div className="card card-pad border-critical-border bg-critical-bg dark:border-red-900 dark:bg-critical-dark">
              <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                The file is missing required columns
              </p>
              <p className="mt-1 text-sm text-ink-700 dark:text-ink-200">
                No rows can load until these are present:{' '}
                <span className="font-mono">{load.missingRequired.join(', ')}</span>
              </p>
            </div>
          )}

          {load.preview.length > 0 && (
            <div className="card card-pad">
              <p className="label mb-2">Preview — first accepted rows as the platform read them</p>
              <div className="scroll-x">
                <table className="w-full min-w-[520px] border-collapse">
                  <thead className="border-b border-ink-200 dark:border-ink-800">
                    <tr>
                      {Object.keys(load.preview[0]).map((k) => (
                        <th key={k} className="th">
                          {k.replace(/^_/, '')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {load.preview.map((r, i) => (
                      <tr key={i}>
                        {Object.keys(load.preview[0]).map((k) => (
                          <td key={k} className="td whitespace-nowrap text-xs">
                            {formatCell(r[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div className="card card-pad">
              <p className="label mb-2">
                Rejected rows ({errors.length}
                {errors.length >= 500 ? '+, capped' : ''})
              </p>
              <div className="scroll-x">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead className="border-b border-ink-200 dark:border-ink-800">
                    <tr>
                      <th className="th text-right">Row</th>
                      <th className="th">Code</th>
                      <th className="th">Field</th>
                      <th className="th">Value</th>
                      <th className="th">What to fix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {errors.slice(0, 50).map((issue, i) => (
                      <tr key={i}>
                        <td className="td tabular text-right text-xs">{issue.rowNumber}</td>
                        <td className="td font-mono text-2xs text-ink-700 dark:text-ink-300">{issue.code}</td>
                        <td className="td font-mono text-2xs text-ink-500">{issue.field ?? '—'}</td>
                        <td className="td font-mono text-2xs text-danger-600 dark:text-danger-500">
                          {issue.rawValue ?? '—'}
                        </td>
                        <td className="td max-w-md text-xs text-ink-600 dark:text-ink-300">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errors.length > 50 && (
                <p className="mt-2 text-xs text-ink-400">
                  Showing the first 50. The full list is recorded against the run.
                </p>
              )}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="card card-pad border-warn-100 dark:border-warn-700">
              <p className="label mb-2">Warnings — these rows loaded, but read them</p>
              <ul className="space-y-1.5">
                {warnings.slice(0, 12).map((w, i) => (
                  <li key={i} className="text-sm text-ink-600 dark:text-ink-300">
                    <span className="font-mono text-2xs text-ink-400">
                      {w.rowNumber > 1 ? `row ${w.rowNumber} · ` : ''}
                      {w.code}
                    </span>{' '}
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result?.quality && result.quality.length > 0 && (
            <div className="card card-pad">
              <p className="label mb-2">Data quality after this load</p>
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {result.quality.map((q, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink-800 dark:text-ink-200">{q.name}</span>
                      {!q.passed && (
                        <span className="block text-xs text-warn-700 dark:text-warn-500">{q.remediation}</span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="tabular text-sm font-medium text-ink-900 dark:text-ink-100">
                        {(q.measuredValue * 100).toFixed(1)}%
                      </span>
                      <span
                        className={clsx(
                          'chip',
                          q.passed
                            ? 'border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
                            : 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                        )}
                      >
                        {q.passed ? 'Pass' : 'Fail'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function formatCell(v: unknown): string {
  if (v == null) return '—'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}
