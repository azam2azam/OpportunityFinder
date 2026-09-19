import Link from 'next/link'
import clsx from 'clsx'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { scopeWhere } from '@/lib/queries'
import { parseFilters, one, withParam, type SearchParams } from '@/lib/params'
import { money, moneyCompact, count, percent } from '@/lib/format'
import { isTerminal } from '@/lib/enums'
import { PageHeader, Card, TableShell, MiniBar, KpiCard, EmptyState } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * Physicians — service-line and follow-up performance.
 *
 * Presented as workload and follow-up closure, not as a league table. A
 * physician with many open follow-up opportunities usually has a large or
 * complex panel, so the columns that matter are the rate at which loops close
 * and the age of what is outstanding — not the raw count, which mostly measures
 * how many patients they see.
 */
export default async function Physicians({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('physician.view')
  const params = await searchParams
  const filters = parseFilters(params, { lifecycle: 'all' })
  const specialtyFilter = one(params, 'specialty')

  const [physicians, opportunities, specialties, encounterCounts] = await Promise.all([
    prisma.physician.findMany({
      where: {
        isActive: true,
        ...(principal.scopeLevel === 'GROUP' ? {} : { hospitalId: { in: principal.hospitalIds } }),
        ...(specialtyFilter ? { specialtyId: specialtyFilter } : {}),
      },
      select: {
        id: true, name: true, code: true, weeklySlots: true,
        hospital: { select: { id: true, name: true, code: true } },
        specialty: { select: { id: true, name: true, line: true } },
        department: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.opportunity.findMany({
      where: scopeWhere(principal, filters),
      select: {
        physicianId: true, status: true, priority: true, potentialValue: true,
        realisedValue: true, detectedAt: true, slaDueAt: true, category: true,
      },
    }),
    prisma.specialty.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.encounter.groupBy({
      by: ['physicianId'],
      where: principal.scopeLevel === 'GROUP' ? {} : { hospitalId: { in: principal.hospitalIds } },
      _count: true,
    }),
  ])

  const encountersBy = new Map(encounterCounts.map((e) => [e.physicianId, e._count]))
  const now = Date.now()

  const rows = physicians
    .map((p) => {
      const mine = opportunities.filter((o) => o.physicianId === p.id)
      const open = mine.filter((o) => !isTerminal(o.status))
      const converted = mine.filter((o) => o.status === 'CONVERTED')
      const encounters = encountersBy.get(p.id) ?? 0
      return {
        ...p,
        encounters,
        total: mine.length,
        open: open.length,
        critical: open.filter((o) => o.priority === 'CRITICAL' || o.priority === 'HIGH').length,
        potentialValue: open.reduce((s, o) => s + o.potentialValue, 0),
        realisedValue: converted.reduce((s, o) => s + o.realisedValue, 0),
        converted: converted.length,
        closureRate: mine.length > 0 ? (mine.length - open.length) / mine.length : 0,
        breached: open.filter((o) => o.slaDueAt && o.slaDueAt.getTime() < now).length,
        // Normalised: open loops per hundred encounters. This is the figure
        // that compares a busy consultant with a part-time one fairly.
        openPerHundred: encounters > 0 ? (open.length / encounters) * 100 : 0,
        avgAge:
          open.length > 0
            ? Math.round(
                open.reduce((s, o) => s + (now - o.detectedAt.getTime()) / 86_400_000, 0) / open.length
              )
            : 0,
      }
    })
    .filter((p) => p.total > 0)
    .sort((a, b) => b.open - a.open)

  const maxOpen = Math.max(1, ...rows.map((r) => r.open))
  const totalOpen = rows.reduce((s, r) => s + r.open, 0)
  const totalValue = rows.reduce((s, r) => s + r.potentialValue, 0)
  const avgClosure =
    rows.length > 0 ? rows.reduce((s, r) => s + r.closureRate, 0) / rows.length : 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Physicians"
        question="Where are clinical loops staying open, and who needs support closing them?"
        description="Open opportunities attributed to each physician, normalised by encounter volume so panel size does not distort the comparison."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Physicians with open work" value={rows.length} />
        <KpiCard label="Open opportunities" value={totalOpen} />
        <KpiCard label="Potential value" value={totalValue} format="moneyCompact" />
        <KpiCard
          label="Average closure rate"
          value={avgClosure}
          format="percent"
          hint="Share of attributed opportunities reaching a terminal state."
        />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-2xs font-semibold uppercase tracking-wide text-ink-400">
            Specialty
          </span>
          <Link
            href={withParam(params, { specialty: undefined })}
            className={clsx(
              'chip',
              !specialtyFilter
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
            )}
          >
            All
          </Link>
          {specialties.map((s) => (
            <Link
              key={s.id}
              href={withParam(params, { specialty: specialtyFilter === s.id ? undefined : s.id })}
              className={clsx(
                'chip',
                specialtyFilter === s.id
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
              )}
            >
              {s.name}
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No physicians with attributed opportunities"
            description="Try clearing the specialty filter, or run detection to populate the pipeline."
          />
        ) : (
          <TableShell
            head={
              <>
                <th className="th">Physician</th>
                <th className="th">Specialty</th>
                <th className="th">Hospital</th>
                <th className="th text-right">Encounters</th>
                <th className="th text-right">Open</th>
                <th className="th">Volume</th>
                <th className="th text-right">Per 100 enc.</th>
                <th className="th text-right">High priority</th>
                <th className="th text-right">Potential</th>
                <th className="th text-right">Closure</th>
                <th className="th text-right">Past SLA</th>
                <th className="th text-right">Avg age</th>
              </>
            }
          >
            {rows.map((p) => (
              <tr key={p.id} className="row-link">
                <td className="td">
                  <Link
                    href={`/opportunities?physician=${p.id}&lifecycle=open`}
                    className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                  >
                    {p.name}
                  </Link>
                  <span className="block font-mono text-2xs text-ink-400">{p.code}</span>
                </td>
                <td className="td text-xs">
                  {p.specialty.name}
                  <span className="block text-2xs text-ink-400">{p.specialty.line}</span>
                </td>
                <td className="td text-xs">{p.hospital.name}</td>
                <td className="td tabular text-right">{count(p.encounters)}</td>
                <td className="td tabular text-right font-medium">{count(p.open)}</td>
                <td className="td">
                  <MiniBar value={p.open} max={maxOpen} />
                </td>
                <td className="td tabular text-right">{p.openPerHundred.toFixed(1)}</td>
                <td className="td tabular text-right">
                  {p.critical > 0 ? (
                    <span className="font-medium text-critical-text dark:text-red-300">{count(p.critical)}</span>
                  ) : (
                    <span className="text-ink-400">0</span>
                  )}
                </td>
                <td className="td tabular text-right">{moneyCompact(p.potentialValue)}</td>
                <td className="td tabular text-right">
                  <span
                    className={clsx(
                      p.closureRate < 0.3 ? 'text-warn-700 dark:text-warn-500' : 'text-ink-700 dark:text-ink-200'
                    )}
                  >
                    {percent(p.closureRate, 0)}
                  </span>
                </td>
                <td className="td tabular text-right">
                  {p.breached > 0 ? (
                    <span className="font-medium text-danger-600 dark:text-danger-500">{count(p.breached)}</span>
                  ) : (
                    <span className="text-ink-400">0</span>
                  )}
                </td>
                <td className="td tabular text-right">{p.avgAge}d</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>

      <p className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
        These figures describe where clinical loops remain open, not clinical quality. An open
        opportunity attributed to a physician frequently reflects a patient who did not return
        rather than anything the physician did or failed to do — which is why closure rate and
        age are shown alongside the raw count. Use this to direct support, not to rank clinicians.
        Total realised value across the listed physicians:{' '}
        {money(rows.reduce((s, r) => s + r.realisedValue, 0))}.
      </p>
    </div>
  )
}
