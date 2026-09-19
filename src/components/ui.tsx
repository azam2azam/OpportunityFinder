import type { ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { money, moneyCompact, count as fmtCount, percent, relative, humanise } from '@/lib/format'
import type { Priority } from '@/lib/enums'
import { STATUS_LABEL, type OpportunityStatus } from '@/lib/enums'

/**
 * Shared presentational primitives.
 *
 * Server components by default — none of these hold state. Anything needing
 * interactivity lives in components/client/*.
 */

// ── surfaces ────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
  pad = true,
}: {
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return <div className={clsx('card', pad && 'card-pad', className)}>{children}</div>
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function PageHeader({
  title,
  question,
  description,
  actions,
}: {
  title: string
  /** The operational question this page answers — spec section 26. */
  question?: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-50">
          {title}
        </h1>
        {question && (
          <p className="mt-1 text-sm font-medium text-brand-700 dark:text-brand-300">{question}</p>
        )}
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-ink-500 dark:text-ink-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 px-6 py-12 text-center dark:border-ink-700">
      <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{title}</p>
      {description && (
        <p className="max-w-md text-sm text-ink-500 dark:text-ink-400">{description}</p>
      )}
      {action}
    </div>
  )
}

// ── badges ──────────────────────────────────────────────────────────────

const PRIORITY_CLASS: Record<Priority, string> = {
  CRITICAL: 'border-critical-border bg-critical-bg text-critical-text dark:bg-critical-dark dark:text-red-200 dark:border-red-900',
  HIGH: 'border-high-border bg-high-bg text-high-text dark:bg-high-dark dark:text-orange-200 dark:border-orange-900',
  MEDIUM: 'border-medium-border bg-medium-bg text-medium-text dark:bg-medium-dark dark:text-yellow-200 dark:border-yellow-900',
  LOW: 'border-low-border bg-low-bg text-low-text dark:bg-low-dark dark:text-sky-200 dark:border-sky-900',
}

export function PriorityBadge({ priority }: { priority: string }) {
  const cls = PRIORITY_CLASS[priority as Priority] ?? PRIORITY_CLASS.LOW
  return (
    <span className={clsx('chip', cls)}>
      <span
        className={clsx(
          'h-1.5 w-1.5 rounded-full',
          priority === 'CRITICAL' && 'bg-critical-solid',
          priority === 'HIGH' && 'bg-high-solid',
          priority === 'MEDIUM' && 'bg-medium-solid',
          priority === 'LOW' && 'bg-low-solid'
        )}
      />
      {humanise(priority)}
    </span>
  )
}

/** Status colour tracks outcome, not stage: green converted, red rejected. */
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'CONVERTED'
      ? 'border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
      : status === 'REJECTED' || status === 'NOT_APPLICABLE'
        ? 'border-ink-200 bg-ink-100 text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-400'
        : status === 'DETECTED'
          ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200'
          : 'border-ink-200 bg-white text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
  return (
    <span className={clsx('chip', tone)}>
      {STATUS_LABEL[status as OpportunityStatus] ?? humanise(status)}
    </span>
  )
}

export function CategoryBadge({ category, label }: { category: string; label?: string }) {
  const tone: Record<string, string> = {
    LAB: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200',
    SURGERY: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200',
    MEDICATION: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-200',
    INSURANCE: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    REACTIVATION: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
    APPOINTMENT: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200',
    REFERRAL: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200',
    SERVICE_LINE: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200',
  }
  return (
    <span className={clsx('chip', tone[category] ?? tone.SERVICE_LINE)}>{label ?? humanise(category)}</span>
  )
}

export function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 78 ? 'bg-critical-solid' : score >= 62 ? 'bg-high-solid' : score >= 42 ? 'bg-medium-solid' : 'bg-low-solid'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular text-sm font-semibold text-ink-900 dark:text-ink-100">
        {score.toFixed(0)}
      </span>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700">
        <span className={clsx('block h-full rounded-full', tone)} style={{ width: `${Math.min(100, score)}%` }} />
      </span>
    </span>
  )
}

/** Red when the SLA has passed and the work is still open. */
export function SlaBadge({ dueAt, closed }: { dueAt: Date | null; closed: boolean }) {
  if (!dueAt) return <span className="text-xs text-ink-400">—</span>
  const overdue = !closed && dueAt.getTime() < Date.now()
  return (
    <span
      className={clsx(
        'text-xs tabular',
        overdue ? 'font-semibold text-danger-600 dark:text-danger-500' : 'text-ink-500 dark:text-ink-400'
      )}
    >
      {overdue ? `${relative(dueAt).replace(' ago', '')} overdue` : relative(dueAt)}
    </span>
  )
}

// ── KPI tiles ───────────────────────────────────────────────────────────

export interface KpiProps {
  label: string
  value: number
  previous?: number
  format?: 'count' | 'money' | 'moneyCompact' | 'percent'
  /** Whether an increase is a good thing; drives the arrow colour. */
  goodWhen?: 'up' | 'down'
  target?: number
  hint?: string
  href?: string
  accent?: 'default' | 'critical' | 'positive'
}

export function KpiCard({
  label,
  value,
  previous,
  format = 'count',
  goodWhen = 'up',
  target,
  hint,
  href,
  accent = 'default',
}: KpiProps) {
  const fmt = (v: number) =>
    format === 'money' ? money(v) : format === 'moneyCompact' ? moneyCompact(v) : format === 'percent' ? percent(v) : fmtCount(v)

  const hasPrev = previous != null && Number.isFinite(previous)
  const change = hasPrev ? value - (previous as number) : 0
  const pct = hasPrev && previous !== 0 ? change / Math.abs(previous as number) : null
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  const good = direction === 'flat' ? true : goodWhen === 'up' ? direction === 'up' : direction === 'down'

  const variance = target != null && target !== 0 ? (value - target) / Math.abs(target) : null

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="label">{label}</p>
        {accent === 'critical' && value > 0 && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-critical-solid" aria-hidden />
        )}
      </div>
      <p
        className={clsx(
          'mt-2 tabular text-3xl font-semibold tracking-tight',
          accent === 'critical' ? 'text-critical-text dark:text-red-300' : 'text-ink-900 dark:text-ink-50'
        )}
      >
        {fmt(value)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {hasPrev && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 font-medium',
              direction === 'flat'
                ? 'text-ink-400'
                : good
                  ? 'text-positive-600 dark:text-positive-500'
                  : 'text-danger-600 dark:text-danger-500'
            )}
          >
            <span aria-hidden>{direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—'}</span>
            <span className="tabular">
              {pct != null ? percent(Math.abs(pct), 0) : fmt(Math.abs(change))}
            </span>
            <span className="font-normal text-ink-400">vs prior period</span>
          </span>
        )}
        {target != null && (
          <span className="tabular text-ink-500 dark:text-ink-400">
            Target {fmt(target)}
            {variance != null && (
              <span className={clsx('ml-1', variance >= 0 ? 'text-positive-600' : 'text-warn-600')}>
                ({variance >= 0 ? '+' : ''}
                {percent(variance, 0)})
              </span>
            )}
          </span>
        )}
      </div>
      {hint && <p className="mt-2 text-xs text-ink-400 dark:text-ink-500">{hint}</p>}
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="card card-pad block transition-shadow hover:shadow-raised focus-visible:shadow-raised"
      >
        {body}
      </Link>
    )
  }
  return <div className="card card-pad">{body}</div>
}

// ── tables ──────────────────────────────────────────────────────────────

export function TableShell({
  head,
  children,
  caption,
}: {
  head: ReactNode
  children: ReactNode
  caption?: string
}) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[720px] border-collapse">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-b border-ink-200 dark:border-ink-800">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">{children}</tbody>
      </table>
    </div>
  )
}

/** Horizontal bar used inside tables to make magnitudes scannable. */
export function MiniBar({ value, max, tone = 'brand' }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const bg: Record<string, string> = {
    brand: 'bg-brand-500',
    positive: 'bg-positive-500',
    warn: 'bg-warn-500',
    danger: 'bg-danger-500',
  }
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700 align-middle">
      <span className={clsx('block h-full rounded-full', bg[tone] ?? bg.brand)} style={{ width: `${pct}%` }} />
    </span>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={clsx('mt-0.5 text-sm font-medium text-ink-900 dark:text-ink-100', tone)}>{value}</dd>
    </div>
  )
}
