import Link from 'next/link'
import clsx from 'clsx'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { scopeWhere } from '@/lib/queries'
import { parseFilters, type SearchParams } from '@/lib/params'
import { money, moneyCompact, count, percent } from '@/lib/format'
import {
  PageHeader, Card, SectionHeader, KpiCard, TableShell, MiniBar, PriorityBadge, EmptyState,
} from '@/components/ui'
import { HorizontalBars, GroupedBars } from '@/components/client/Charts'

export const dynamic = 'force-dynamic'

/**
 * Service-Line Growth (spec section 14).
 *
 * Aggregate rather than patient-level: the unit of action is a clinic, not a
 * person. Three signals drive it — capacity that is contracted but unbooked,
 * referrals leaving the group for services the group provides, and capacity
 * consumed by cancellations — because each has a different owner and a
 * different fix.
 */
export default async function ServiceLines({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('analytics.view')
  const params = await searchParams
  const filters = parseFilters(params, { category: 'SERVICE_LINE', lifecycle: 'open' })

  const hospitalScope =
    principal.scopeLevel === 'GROUP' ? {} : { hospitalId: { in: principal.hospitalIds } }

  const [metrics, opportunities, specialties, hospitals] = await Promise.all([
    prisma.serviceLineMetric.findMany({
      where: hospitalScope,
      include: { specialty: true, hospital: { select: { id: true, name: true, code: true } } },
    }),
    prisma.opportunity.findMany({
      where: scopeWhere(principal, filters),
      select: {
        id: true, reference: true, title: true, priority: true, score: true,
        potentialValue: true, status: true, detectionReason: true, recommendedAction: true,
        hospital: { select: { name: true, code: true } },
        specialty: { select: { name: true, line: true } },
      },
      orderBy: { potentialValue: 'desc' },
      take: 40,
    }),
    prisma.specialty.findMany({ orderBy: { name: 'asc' } }),
    prisma.hospital.findMany({
      where: principal.scopeLevel === 'GROUP' ? {} : { id: { in: principal.hospitalIds } },
      select: { id: true, name: true },
    }),
  ])

  // Trailing three months is the comparison window every service-line rule uses;
  // matching it here keeps the page consistent with the opportunities it shows.
  const periods = [...new Set(metrics.map((m) => m.periodMonth))].sort()
  const recent = periods.slice(-3)

  interface LineAgg {
    specialtyId: string
    specialty: string
    line: string
    encounters: number
    revenue: number
    capacity: number
    booked: number
    cancellations: number
    referralsOut: number
    referralsRetained: number
    newPatients: number
  }

  const bySpecialty = new Map<string, LineAgg>()
  for (const m of metrics) {
    if (!recent.includes(m.periodMonth)) continue
    let a = bySpecialty.get(m.specialtyId)
    if (!a) {
      a = {
        specialtyId: m.specialtyId,
        specialty: m.specialty.name,
        line: m.specialty.line,
        encounters: 0, revenue: 0, capacity: 0, booked: 0,
        cancellations: 0, referralsOut: 0, referralsRetained: 0, newPatients: 0,
      }
      bySpecialty.set(m.specialtyId, a)
    }
    a.encounters += m.encounters
    a.revenue += m.revenue
    a.capacity += m.capacitySlots
    a.booked += m.bookedSlots
    a.cancellations += m.cancellations
    a.referralsOut += m.referralsOut
    a.referralsRetained += m.referralsRetained
    a.newPatients += m.newPatients
  }

  const lines = [...bySpecialty.values()]
    .map((a) => {
      const utilisation = a.capacity > 0 ? a.booked / a.capacity : 0
      const referralTotal = a.referralsOut + a.referralsRetained
      const retention = referralTotal > 0 ? a.referralsRetained / referralTotal : 1
      const cancellationRate =
        a.encounters + a.cancellations > 0 ? a.cancellations / (a.encounters + a.cancellations) : 0
      const idleSlots = Math.max(0, a.capacity - a.booked)
      const revenuePerEncounter = a.encounters > 0 ? a.revenue / a.encounters : 0
      return {
        ...a,
        utilisation,
        retention,
        cancellationRate,
        idleSlots,
        // What the idle capacity would be worth if it were filled at the line's
        // own observed revenue per encounter.
        idleValue: idleSlots * revenuePerEncounter,
        leakedValue: a.referralsOut * revenuePerEncounter,
      }
    })
    .sort((a, b) => a.utilisation - b.utilisation)

  const totalIdleValue = lines.reduce((s, l) => s + l.idleValue, 0)
  const totalLeakedValue = lines.reduce((s, l) => s + l.leakedValue, 0)
  const underused = lines.filter((l) => l.utilisation < 0.62 && l.capacity >= 120).length
  const leaking = lines.filter((l) => l.retention < 0.7 && l.referralsOut + l.referralsRetained >= 25).length

  // Roll specialties up to their service line for the executive view.
  const byLine = new Map<string, { revenue: number; encounters: number; idleValue: number; leakedValue: number }>()
  for (const l of lines) {
    const g = byLine.get(l.line) ?? { revenue: 0, encounters: 0, idleValue: 0, leakedValue: 0 }
    g.revenue += l.revenue
    g.encounters += l.encounters
    g.idleValue += l.idleValue
    g.leakedValue += l.leakedValue
    byLine.set(l.line, g)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service-Line Growth"
        question="Where is capacity going unused, and where is volume leaving the group?"
        description={`Trailing ${recent.length} months across ${count(specialties.length)} specialties and ${count(hospitals.length)} hospitals. Capacity is contracted clinic slots; leakage is referrals fulfilled outside the group for services we provide.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Unused capacity value"
          value={totalIdleValue}
          format="moneyCompact"
          hint="Idle clinic slots valued at each line's own revenue per encounter."
        />
        <KpiCard
          label="Referral leakage value"
          value={totalLeakedValue}
          format="moneyCompact"
          goodWhen="down"
          hint="Volume fulfilled by external providers for services the group offers."
        />
        <KpiCard
          label="Lines below capacity floor"
          value={underused}
          goodWhen="down"
          hint="Running under 62% of contracted slots at meaningful volume."
        />
        <KpiCard
          label="Lines leaking referrals"
          value={leaking}
          goodWhen="down"
          accent={leaking > 0 ? 'critical' : 'default'}
          hint="Retaining under 70% of their referrals."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Capacity utilisation"
            description="Booked against contracted slots. The lowest lines are the ones with room to absorb demand."
          />
          <HorizontalBars
            data={lines.slice(0, 12).map((l) => ({
              label: l.specialty,
              value: Math.round(l.utilisation * 100),
            }))}
            height={Math.max(200, Math.min(12, lines.length) * 32)}
            tone={1}
          />
        </Card>

        <Card>
          <SectionHeader
            title="Referral retention"
            description="Referrals retained in-group against those fulfilled outside."
          />
          <GroupedBars
            data={lines
              .slice()
              .sort((a, b) => b.referralsOut - a.referralsOut)
              .slice(0, 10)
              .map((l) => ({
                label: l.specialty,
                retained: l.referralsRetained,
                leaked: l.referralsOut,
              }))}
            series={[
              { key: 'retained', name: 'Retained' },
              { key: 'leaked', name: 'Left the group' },
            ]}
            height={300}
          />
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Service lines"
          description="Every specialty in scope. Sorted by utilisation, lowest first — that is where capacity is going to waste."
        />
        <TableShell
          head={
            <>
              <th className="th">Specialty</th>
              <th className="th">Service line</th>
              <th className="th text-right">Encounters</th>
              <th className="th text-right">Revenue</th>
              <th className="th text-right">Utilisation</th>
              <th className="th">Capacity</th>
              <th className="th text-right">Idle value</th>
              <th className="th text-right">Retention</th>
              <th className="th text-right">Cancellations</th>
            </>
          }
        >
          {lines.map((l) => (
            <tr key={l.specialtyId} className="row-link">
              <td className="td font-medium text-ink-900 dark:text-ink-100">{l.specialty}</td>
              <td className="td text-xs text-ink-500">{l.line}</td>
              <td className="td tabular text-right">{count(l.encounters)}</td>
              <td className="td tabular text-right">{moneyCompact(l.revenue)}</td>
              <td className="td tabular text-right">
                <span
                  className={clsx(
                    'font-medium',
                    l.utilisation < 0.62
                      ? 'text-warn-700 dark:text-warn-500'
                      : 'text-ink-700 dark:text-ink-200'
                  )}
                >
                  {percent(l.utilisation, 0)}
                </span>
              </td>
              <td className="td">
                <MiniBar
                  value={l.booked}
                  max={Math.max(1, l.capacity)}
                  tone={l.utilisation < 0.62 ? 'warn' : 'brand'}
                />
              </td>
              <td className="td tabular text-right">{l.idleValue > 0 ? moneyCompact(l.idleValue) : '—'}</td>
              <td className="td tabular text-right">
                <span
                  className={clsx(
                    l.retention < 0.7 ? 'font-medium text-danger-600 dark:text-danger-500' : ''
                  )}
                >
                  {percent(l.retention, 0)}
                </span>
              </td>
              <td className="td tabular text-right">
                <span
                  className={clsx(
                    l.cancellationRate > 0.18 ? 'font-medium text-warn-700 dark:text-warn-500' : ''
                  )}
                >
                  {percent(l.cancellationRate, 0)}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader title="Service line rollup" description="Specialties grouped into their service line." />
        <TableShell
          head={
            <>
              <th className="th">Service line</th>
              <th className="th text-right">Encounters</th>
              <th className="th text-right">Revenue</th>
              <th className="th text-right">Idle capacity value</th>
              <th className="th text-right">Leakage value</th>
            </>
          }
        >
          {[...byLine.entries()]
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .map(([line, g]) => (
              <tr key={line}>
                <td className="td font-medium text-ink-900 dark:text-ink-100">{line}</td>
                <td className="td tabular text-right">{count(g.encounters)}</td>
                <td className="td tabular text-right">{money(g.revenue)}</td>
                <td className="td tabular text-right">{moneyCompact(g.idleValue)}</td>
                <td className="td tabular text-right text-warn-700 dark:text-warn-500">
                  {moneyCompact(g.leakedValue)}
                </td>
              </tr>
            ))}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader
          title="Detected service-line opportunities"
          description="Aggregate findings raised by the detection engine, with the reasoning behind each."
        />
        {opportunities.length === 0 ? (
          <EmptyState
            title="No service-line opportunities detected"
            description="Every line is inside its capacity, retention and cancellation thresholds — or detection has not yet run."
          />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {opportunities.map((o) => (
              <li key={o.id} className="py-3">
                <Link href={`/opportunities/${o.id}`} className="group block">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <PriorityBadge priority={o.priority} />
                      <span className="truncate font-medium text-ink-900 group-hover:text-brand-700 dark:text-ink-100">
                        {o.title}
                      </span>
                    </div>
                    <span className="tabular shrink-0 text-sm font-medium text-ink-900 dark:text-ink-100">
                      {money(o.potentialValue)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-600 dark:text-ink-300">
                    {o.detectionReason.split('\n')[0]}
                  </p>
                  <p className="mt-1 text-xs text-ink-400">
                    {o.hospital.name}
                    {o.specialty && ` · ${o.specialty.name}`} · {o.recommendedAction}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
