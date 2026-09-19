/** Display formatting shared by server components and client widgets. */

const SAR = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'SAR',
  maximumFractionDigits: 0,
})

export function money(value: number | null | undefined): string {
  if (value == null) return '—'
  return SAR.format(value)
}

/**
 * Compact currency for KPI tiles, where "SAR 4.1M" carries the same decision
 * information as "SAR 4,079,783" in a quarter of the width.
 */
export function moneyCompact(value: number | null | undefined): string {
  if (value == null) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `SAR ${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `SAR ${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return SAR.format(value)
}

export function count(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('en-US')
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function shortDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Elapsed time in the coarsest useful unit. Operational users think in "11 days
 * old", not in timestamps — aging is the thing they act on.
 */
export function relative(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  const diff = Date.now() - date.getTime()
  const days = Math.floor(Math.abs(diff) / 86_400_000)
  const future = diff < 0
  if (days === 0) return 'today'
  if (days === 1) return future ? 'tomorrow' : 'yesterday'
  if (days < 30) return future ? `in ${days} days` : `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 24) return future ? `in ${months} months` : `${months} months ago`
  return future ? `in ${Math.floor(months / 12)} years` : `${Math.floor(months / 12)} years ago`
}

export function ageDays(d: Date | string | null | undefined): number {
  if (!d) return 0
  const date = typeof d === 'string' ? new Date(d) : d
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
}

/** "APPOINTMENT_SCHEDULED" -> "Appointment scheduled" */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—'
  const lower = value.replace(/_/g, ' ').toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((p) => !/^(dr|prof)\.?$/i.test(p))
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Signed change with its direction. `goodWhen` decides whether an increase is
 * good — rising revenue is, rising rejection value is not, and the tile colour
 * must follow the meaning rather than the sign.
 */
export function delta(
  current: number,
  previous: number,
  goodWhen: 'up' | 'down' = 'up'
): { value: number; pct: number | null; direction: 'up' | 'down' | 'flat'; good: boolean } {
  const value = current - previous
  const pct = previous === 0 ? null : value / Math.abs(previous)
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const good = direction === 'flat' ? true : goodWhen === 'up' ? direction === 'up' : direction === 'down'
  return { value, pct, direction, good }
}
