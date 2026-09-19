'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { Database, ChevronDown, AlertTriangle, Settings2 } from 'lucide-react'
import { lineageFor, isPlatformOnly, feedLabel } from '@/lib/lineage'

export interface FeedStatusView {
  domain: string
  sourceName: string
  sourceCode: string
  connectionMode: string
  lastRunAt: string | null
  lastRecords: number
  state: 'OK' | 'STALE' | 'DEGRADED' | 'NEVER'
  rejectRate: number
  qualityFailures: number
  criticalQualityFailures: number
}

/**
 * The provenance bar, shown on every page.
 *
 * This is the link between the source applications and the rest of the
 * product. Without it, a director reading a conversion figure has no way to
 * know it depends on a pharmacy feed that stopped three days ago — the chart
 * renders identically either way, which is the most dangerous failure mode a
 * platform like this has.
 *
 * Collapsed by default so it does not compete with the page. It only asserts
 * itself when a feed this particular page depends on is actually in trouble.
 */
export function DataProvenance({
  feedStatus,
  canViewIntegration,
}: {
  feedStatus: Record<string, FeedStatusView>
  canViewIntegration: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const entry = lineageFor(pathname)
  if (!entry) return null

  // Sign-in and the refusal page have no data story worth telling.
  if (pathname.startsWith('/forbidden')) return null

  const platformOnly = isPlatformOnly(entry)
  const statuses = platformOnly
    ? []
    : entry.feeds.map((f) => feedStatus[f]).filter((s): s is FeedStatusView => Boolean(s))

  const stale = statuses.filter((s) => s.state === 'STALE' || s.state === 'NEVER')
  const degraded = statuses.filter((s) => s.state === 'DEGRADED')
  const criticalQuality = statuses.filter((s) => s.criticalQualityFailures > 0)
  const problems = stale.length + degraded.length + criticalQuality.length

  // Distinct source applications behind this page, since several feeds often
  // come from one system and the reader thinks in systems.
  const sources = [...new Map(statuses.map((s) => [s.sourceCode, s])).values()]

  return (
    <div
      className={clsx(
        'mb-4 rounded-lg border text-sm transition-colors',
        problems > 0
          ? 'border-warn-100 bg-warn-50/70 dark:border-warn-700 dark:bg-warn-700/10'
          : 'border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900'
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-left"
      >
        {platformOnly ? (
          <Settings2 className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        ) : problems > 0 ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn-600" />
        ) : (
          <Database className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        )}

        <span className="text-2xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
          Data source
        </span>

        {platformOnly ? (
          <span className="text-xs text-ink-600 dark:text-ink-300">
            Platform configuration — not fed from a source system
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            {sources.map((s) => (
              <span
                key={s.sourceCode}
                className={clsx(
                  'chip',
                  s.state === 'OK'
                    ? 'border-ink-200 bg-ink-50 text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300'
                    : s.state === 'DEGRADED'
                      ? 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                      : 'border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
                )}
              >
                <span
                  className={clsx(
                    'h-1.5 w-1.5 rounded-full',
                    s.state === 'OK' ? 'bg-positive-500' : s.state === 'DEGRADED' ? 'bg-warn-500' : 'bg-critical-solid'
                  )}
                />
                {s.sourceName}
              </span>
            ))}
          </span>
        )}

        {problems > 0 && (
          <span className="text-xs font-medium text-warn-700 dark:text-warn-500">
            {stale.length > 0 && `${stale.length} stale`}
            {stale.length > 0 && (degraded.length > 0 || criticalQuality.length > 0) && ' · '}
            {degraded.length > 0 && `${degraded.length} degraded`}
            {degraded.length > 0 && criticalQuality.length > 0 && ' · '}
            {criticalQuality.length > 0 && `${criticalQuality.length} failing quality`}
            {' — figures on this page may be understated'}
          </span>
        )}

        <ChevronDown
          className={clsx(
            'ml-auto h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="border-t border-ink-100 px-3 py-3 dark:border-ink-800">
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-ink-600 dark:text-ink-300">
            {entry.impact}
          </p>

          {!platformOnly && statuses.length > 0 && (
            <div className="scroll-x">
              <table className="w-full min-w-[620px] border-collapse">
                <thead className="border-b border-ink-100 dark:border-ink-800">
                  <tr>
                    <th className="th">Feed</th>
                    <th className="th">Source application</th>
                    <th className="th">Transport</th>
                    <th className="th">Last load</th>
                    <th className="th text-right">Records</th>
                    <th className="th text-right">Rejected</th>
                    <th className="th">Quality</th>
                    <th className="th">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {statuses.map((s) => (
                    <tr key={s.domain}>
                      <td className="td text-xs font-medium text-ink-900 dark:text-ink-100">
                        {feedLabel(s.domain)}
                      </td>
                      <td className="td text-xs">{s.sourceName}</td>
                      <td className="td text-2xs text-ink-500">{humanise(s.connectionMode)}</td>
                      <td className="td whitespace-nowrap text-2xs text-ink-500">
                        {s.lastRunAt ? relativeFrom(s.lastRunAt) : 'Never'}
                      </td>
                      <td className="td tabular text-right text-xs">
                        {s.lastRecords.toLocaleString()}
                      </td>
                      <td className="td tabular text-right text-xs">
                        {s.rejectRate > 0 ? (
                          <span className="text-warn-700 dark:text-warn-500">
                            {(s.rejectRate * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-ink-400">0%</span>
                        )}
                      </td>
                      <td className="td text-xs">
                        {s.criticalQualityFailures > 0 ? (
                          <span className="text-critical-text dark:text-red-300">
                            {s.criticalQualityFailures} critical
                          </span>
                        ) : s.qualityFailures > 0 ? (
                          <span className="text-warn-700 dark:text-warn-500">
                            {s.qualityFailures} warning
                          </span>
                        ) : (
                          <span className="text-positive-600 dark:text-positive-500">Passing</span>
                        )}
                      </td>
                      <td className="td">
                        <span
                          className={clsx(
                            'chip',
                            s.state === 'OK'
                              ? 'border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
                              : s.state === 'DEGRADED'
                                ? 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                                : 'border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
                          )}
                        >
                          {s.state === 'OK' ? 'Current' : humanise(s.state)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {entry.derivedBy && entry.derivedBy.length > 0 && (
            <p className="mt-3 text-2xs text-ink-500 dark:text-ink-400">
              <span className="font-semibold uppercase tracking-wide">Derived by</span>{' '}
              {entry.derivedBy.join(' → ')}. Figures on this page are computed, not read directly
              from the source.
            </p>
          )}

          {canViewIntegration && (
            <div className="mt-3 flex flex-wrap gap-3 border-t border-ink-100 pt-3 dark:border-ink-800">
              <Link href="/integration" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                Integration overview →
              </Link>
              <Link href="/integration/lineage" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                Full lineage map →
              </Link>
              {!platformOnly && (
                <Link href="/integration/pipelines" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                  Pipeline health →
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function humanise(value: string): string {
  const lower = value.replace(/_/g, ' ').toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Client-side relative time; the server hands over an ISO string. */
function relativeFrom(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
