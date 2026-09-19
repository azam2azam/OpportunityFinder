import Link from 'next/link'
import clsx from 'clsx'
import { withParam, type SearchParams } from '@/lib/params'
import { CATEGORY_LABEL, PRIORITIES, OPPORTUNITY_STATUSES, STATUS_LABEL } from '@/lib/enums'
import { visibleCategories, type Principal } from '@/lib/rbac'

/**
 * Filter chips for the opportunity modules.
 *
 * Links rather than form controls: every filter state gets a real URL, so a
 * director can send "the 14 critical cardiology follow-ups past SLA at Riyadh"
 * to someone as a link and they open exactly that view. A client-side filter
 * panel would make that shareable state invisible.
 *
 * `locked` names the dimensions a module pins (the insurance page is always
 * `category=INSURANCE`); those groups are hidden rather than rendered as
 * controls that appear broken when clicking them changes nothing.
 */
export function FilterBar({
  principal,
  params,
  hospitals,
  specialties,
  locked = [],
}: {
  principal: Principal
  params: SearchParams
  hospitals?: Array<{ id: string; name: string }>
  specialties?: Array<{ id: string; name: string }>
  locked?: Array<'category' | 'priority' | 'status' | 'lifecycle' | 'hospital' | 'specialty'>
}) {
  const current = (key: string) => {
    const v = params[key]
    return Array.isArray(v) ? v[0] : v
  }
  const isLocked = (k: (typeof locked)[number]) => locked.includes(k)
  const categories = visibleCategories(principal)

  return (
    <div className="mb-4 space-y-2.5">
      {!isLocked('lifecycle') && (
        <FilterGroup label="Lifecycle">
          <Chip params={params} name="lifecycle" value="open" label="Open" current={current('lifecycle') ?? 'open'} />
          <Chip params={params} name="lifecycle" value="closed" label="Closed" current={current('lifecycle') ?? 'open'} />
          <Chip params={params} name="lifecycle" value="all" label="All" current={current('lifecycle') ?? 'open'} />
        </FilterGroup>
      )}

      {!isLocked('priority') && (
        <FilterGroup label="Priority">
          <Chip params={params} name="priority" value={undefined} label="Any" current={current('priority')} />
          {PRIORITIES.map((p) => (
            <Chip
              key={p}
              params={params}
              name="priority"
              value={p}
              label={p.charAt(0) + p.slice(1).toLowerCase()}
              current={current('priority')}
            />
          ))}
        </FilterGroup>
      )}

      {!isLocked('category') && categories.length > 1 && (
        <FilterGroup label="Type">
          <Chip params={params} name="category" value={undefined} label="All types" current={current('category')} />
          {categories.map((c) => (
            <Chip
              key={c}
              params={params}
              name="category"
              value={c}
              label={CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
              current={current('category')}
            />
          ))}
        </FilterGroup>
      )}

      {!isLocked('hospital') && hospitals && hospitals.length > 1 && (
        <FilterGroup label="Hospital">
          <Chip params={params} name="hospital" value={undefined} label="All in scope" current={current('hospital')} />
          {hospitals.map((h) => (
            <Chip key={h.id} params={params} name="hospital" value={h.id} label={h.name} current={current('hospital')} />
          ))}
        </FilterGroup>
      )}

      {!isLocked('specialty') && specialties && specialties.length > 0 && (
        <FilterGroup label="Specialty">
          <Chip params={params} name="specialty" value={undefined} label="All" current={current('specialty')} />
          {specialties.map((s) => (
            <Chip key={s.id} params={params} name="specialty" value={s.id} label={s.name} current={current('specialty')} />
          ))}
        </FilterGroup>
      )}

      <FilterGroup label="Attention">
        <Chip params={params} name="sla" value="breached" label="Past SLA" current={current('sla')} />
        <Chip params={params} name="owner" value="unassigned" label="Unassigned" current={current('owner')} />
        <Chip params={params} name="owner" value="me" label="Assigned to me" current={current('owner')} />
      </FilterGroup>

      <FilterGroup label="Sort">
        <Chip params={params} name="sort" value="score" label="Score" current={current('sort') ?? 'score'} />
        <Chip params={params} name="sort" value="value" label="Value" current={current('sort') ?? 'score'} />
        <Chip params={params} name="sort" value="sla" label="SLA due" current={current('sort') ?? 'score'} />
        <Chip params={params} name="sort" value="detected" label="Newest" current={current('sort') ?? 'score'} />
      </FilterGroup>

      {!isLocked('status') && current('status') && (
        <FilterGroup label="Status">
          <Chip params={params} name="status" value={undefined} label="Any" current={current('status')} />
          {OPPORTUNITY_STATUSES.map((s) => (
            <Chip key={s} params={params} name="status" value={s} label={STATUS_LABEL[s]} current={current('status')} />
          ))}
        </FilterGroup>
      )}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-2xs font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({
  params,
  name,
  value,
  label,
  current,
}: {
  params: SearchParams
  name: string
  value: string | undefined
  label: string
  current: string | undefined
}) {
  const active = current === value || (value === undefined && current === undefined)
  // Clicking an active toggle-style chip clears it, so a filter can always be
  // removed without hunting for an "any" option.
  const target = active && value !== undefined ? undefined : value
  return (
    <Link
      href={withParam(params, { [name]: target })}
      className={clsx(
        'chip transition-colors',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
      )}
    >
      {label}
    </Link>
  )
}

/** Page-number links that keep every other filter intact. */
export function Pagination({
  params,
  page,
  total,
  pageSize,
}: {
  params: SearchParams
  page: number
  total: number
  pageSize: number
}) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  // A window around the current page: a 200-page result set must not render
  // 200 links.
  const window = 2
  const numbers: number[] = []
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= window) numbers.push(p)
  }

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-xs text-ink-500 dark:text-ink-400">
        Showing <span className="tabular font-medium">{from.toLocaleString()}</span>–
        <span className="tabular font-medium">{to.toLocaleString()}</span> of{' '}
        <span className="tabular font-medium">{total.toLocaleString()}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {page > 1 && (
          <Link href={withParam(params, { page: String(page - 1) })} className="btn btn-secondary px-2 py-1 text-xs">
            Previous
          </Link>
        )}
        {numbers.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            {i > 0 && numbers[i - 1] !== p - 1 && <span className="px-1 text-xs text-ink-400">…</span>}
            <Link
              href={withParam(params, { page: String(p) })}
              aria-current={p === page ? 'page' : undefined}
              className={clsx(
                'min-w-[28px] rounded-md border px-2 py-1 text-center text-xs tabular',
                p === page
                  ? 'border-brand-600 bg-brand-600 font-medium text-white'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
              )}
            >
              {p}
            </Link>
          </span>
        ))}
        {page < pages && (
          <Link href={withParam(params, { page: String(page + 1) })} className="btn btn-secondary px-2 py-1 text-xs">
            Next
          </Link>
        )}
      </div>
    </nav>
  )
}
