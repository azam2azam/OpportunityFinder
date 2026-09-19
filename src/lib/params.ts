import type { OpportunityFilters, SortKey } from './queries'

/** Next 15+ hands search params in as a promise of possibly-repeated values. */
export type SearchParams = Record<string, string | string[] | undefined>

export function one(params: SearchParams, key: string): string | undefined {
  const v = params[key]
  const s = Array.isArray(v) ? v[0] : v
  return s && s.length > 0 ? s : undefined
}

export function num(params: SearchParams, key: string): number | undefined {
  const s = one(params, key)
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Builds the shared opportunity filter from the query string.
 *
 * `defaults` lets a module pin the filters that define it — the Insurance
 * Recovery page is the opportunity list with `category=INSURANCE` — while the
 * user still controls everything else. Pinned values win, so a crafted URL
 * cannot turn the clinical page into a financial one.
 */
export function parseFilters(
  params: SearchParams,
  defaults: Partial<OpportunityFilters> = {}
): OpportunityFilters {
  const owner = one(params, 'owner')
  return {
    hospitalId: one(params, 'hospital'),
    category: one(params, 'category'),
    priority: one(params, 'priority'),
    status: one(params, 'status'),
    lifecycle: (one(params, 'lifecycle') as OpportunityFilters['lifecycle']) ?? 'open',
    specialtyId: one(params, 'specialty'),
    departmentId: one(params, 'department'),
    physicianId: one(params, 'physician'),
    owner: owner === 'me' || owner === 'unassigned' ? owner : undefined,
    search: one(params, 'q'),
    slaBreached: one(params, 'sla') === 'breached' ? true : undefined,
    minScore: num(params, 'minScore'),
    ...defaults,
  }
}

const SORTS: SortKey[] = ['score', 'value', 'detected', 'sla', 'priority']

export function parseSort(params: SearchParams): SortKey {
  const s = one(params, 'sort') as SortKey | undefined
  return s && SORTS.includes(s) ? s : 'score'
}

export function parsePage(params: SearchParams, pageSize = 40): { page: number; skip: number; take: number } {
  const page = Math.max(1, num(params, 'page') ?? 1)
  return { page, skip: (page - 1) * pageSize, take: pageSize }
}

/** Serialises a filter change while preserving everything else in the URL. */
export function withParam(
  params: SearchParams,
  changes: Record<string, string | undefined>
): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    const s = Array.isArray(v) ? v[0] : v
    if (s) sp.set(k, s)
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === '') sp.delete(k)
    else sp.set(k, v)
  }
  // A filter change always returns to the first page; staying on page 7 of a
  // now-shorter result set shows an empty table for no visible reason.
  if (!('page' in changes)) sp.delete('page')
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}
