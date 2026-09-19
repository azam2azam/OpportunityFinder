import clsx from 'clsx'
import { count, percent } from '@/lib/format'
import type { FunnelStage } from '@/lib/queries'

/**
 * The opportunity funnel (spec section 6).
 *
 * Rendered as proportional bars rather than a tapering trapezoid: the useful
 * comparison is between adjacent stages — where the drop-off is — and a
 * classic funnel shape makes small later stages unreadable while adding no
 * information. Each row carries its step conversion, because "68% of contacted
 * patients booked" is the number that drives an intervention; the cumulative
 * figure only says how far things have fallen overall.
 */
export function Funnel({ stages, showValue = true }: { stages: FunnelStage[]; showValue?: boolean }) {
  const top = stages[0]?.count ?? 0
  if (top === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-400">
        No opportunities in range — run detection to populate the funnel.
      </p>
    )
  }

  return (
    <ol className="space-y-2">
      {stages.map((s, i) => {
        const width = top > 0 ? Math.max(1.5, (s.count / top) * 100) : 0
        // The biggest single drop is worth calling out explicitly; it is the
        // one stage where fixing the process moves everything downstream.
        const isWorstDrop =
          i > 0 &&
          s.stepRate ===
            Math.min(...stages.slice(1).map((x) => x.stepRate).filter((r) => Number.isFinite(r)))

        return (
          <li key={s.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
                <span className="tabular text-2xs text-ink-400">{i + 1}</span>
                {s.label}
                {isWorstDrop && (
                  <span className="chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20">
                    largest drop-off
                  </span>
                )}
              </span>
              <span className="flex items-baseline gap-2.5 text-xs">
                {i > 0 && (
                  <span
                    className={clsx(
                      'tabular',
                      s.stepRate < 0.4 ? 'text-warn-600 dark:text-warn-500' : 'text-ink-500 dark:text-ink-400'
                    )}
                  >
                    {percent(s.stepRate, 0)} of previous
                  </span>
                )}
                <span className="tabular font-semibold text-ink-900 dark:text-ink-100">
                  {count(s.count)}
                </span>
              </span>
            </div>
            <div className="h-6 overflow-hidden rounded bg-ink-100 dark:bg-ink-800">
              <div
                className={clsx(
                  'flex h-full items-center rounded px-2 transition-all',
                  i === stages.length - 1
                    ? 'bg-positive-500'
                    : i === 0
                      ? 'bg-brand-600'
                      : 'bg-brand-500'
                )}
                style={{ width: `${width}%`, opacity: 1 - i * 0.07 }}
              >
                {showValue && width > 18 && (
                  <span className="tabular text-2xs font-medium text-white">
                    {percent(s.overallRate, 0)} of detected
                  </span>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
