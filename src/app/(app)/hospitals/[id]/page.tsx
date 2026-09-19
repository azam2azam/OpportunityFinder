import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import {
  getKpis, getFunnel, getCategorySummary, getWorkQueue, listOpportunities, scopeWhere,
} from '@/lib/queries'
import { canAccessHospital } from '@/lib/rbac'
import { money, moneyCompact, count, percent } from '@/lib/format'
import { CATEGORY_LABEL } from '@/lib/enums'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell, MiniBar } from '@/components/ui'
import { Funnel } from '@/components/Funnel'
import { OpportunityMiniList } from '@/components/OpportunityTable'
import { HorizontalBars } from '@/components/client/Charts'

export const dynamic = 'force-dynamic'

/**
 * Hospital command centre — the General Director's view of one hospital
 * (spec section 2).
 */
export default async function HospitalDetail({ params }: { params: Promise<{ id: string }> }) {
  const principal = await guard('opportunity.view')
  const { id } = await params

  // Scope is checked before the read, not after: a hospital outside scope must
  // behave as if it does not exist.
  if (!canAccessHospital(principal, id)) notFound()

  const hospital = await prisma.hospital.findUnique({
    where: { id },
    include: { _count: { select: { patients: true, physicians: true, departments: true } } },
  })
  if (!hospital) notFound()

  const filters = { hospitalId: id }

  const [kpis, funnel, categories, workQueue, top, departments, specialtyRows] = await Promise.all([
    getKpis(principal, filters),
    getFunnel(principal, { ...filters, lifecycle: 'all' }),
    getCategorySummary(principal, { ...filters, lifecycle: 'all' }),
    getWorkQueue(principal, { ...filters, lifecycle: 'open' }),
    listOpportunities(principal, { ...filters, lifecycle: 'open' }, { take: 10, sort: 'score' }),
    prisma.department.findMany({
      where: { hospitalId: id },
      select: { id: true, name: true, code: true, costCentre: true },
      orderBy: { name: 'asc' },
    }),
    prisma.opportunity.groupBy({
      by: ['specialtyId'],
      where: scopeWhere(principal, { ...filters, lifecycle: 'open' }),
      _count: true,
      _sum: { potentialValue: true },
    }),
  ])

  const [deptRows, specialties] = await Promise.all([
    prisma.opportunity.groupBy({
      by: ['departmentId'],
      where: scopeWhere(principal, { ...filters, lifecycle: 'open' }),
      _count: true,
      _sum: { potentialValue: true },
    }),
    prisma.specialty.findMany({ select: { id: true, name: true, line: true } }),
  ])

  const specialtyById = new Map(specialties.map((s) => [s.id, s]))
  const deptById = new Map(departments.map((d) => [d.id, d]))

  const specialtyBreakdown = specialtyRows
    .filter((r) => r.specialtyId)
    .map((r) => ({
      name: specialtyById.get(r.specialtyId as string)?.name ?? 'Unattributed',
      line: specialtyById.get(r.specialtyId as string)?.line ?? '',
      open: r._count,
      value: r._sum.potentialValue ?? 0,
    }))
    .sort((a, b) => b.value - a.value)

  const departmentBreakdown = deptRows
    .filter((r) => r.departmentId)
    .map((r) => ({
      id: r.departmentId as string,
      name: deptById.get(r.departmentId as string)?.name ?? 'Unattributed',
      costCentre: deptById.get(r.departmentId as string)?.costCentre ?? '',
      open: r._count,
      value: r._sum.potentialValue ?? 0,
    }))
    .sort((a, b) => b.value - a.value)

  const maxDeptValue = Math.max(1, ...departmentBreakdown.map((d) => d.value))

  return (
    <div className="space-y-5">
      <PageHeader
        title={hospital.name}
        question="What is happening at this hospital today?"
        description={`${hospital.city}, ${hospital.region} · ${count(hospital.beds)} beds · ${count(hospital._count.patients)} patients · ${count(hospital._count.physicians)} physicians · ${count(hospital._count.departments)} departments`}
        actions={
          <>
            <Link href="/hospitals" className="btn btn-secondary">
              All hospitals
            </Link>
            <Link href={`/opportunities?hospital=${id}&lifecycle=open`} className="btn btn-primary">
              Open opportunities
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Today's opportunity count" value={kpis.activeOpportunities} goodWhen="down" />
        <KpiCard
          label="High priority"
          value={kpis.highPriority}
          goodWhen="down"
          accent={kpis.highPriority > 0 ? 'critical' : 'default'}
        />
        <KpiCard label="Potential revenue" value={kpis.potentialValue} format="moneyCompact" />
        <KpiCard label="Patients requiring follow-up" value={kpis.followUpOpportunities} />
        <KpiCard label="Insurance recovery" value={kpis.insuranceRecoveryPotential} format="moneyCompact" />
        <KpiCard label="Reactivation opportunities" value={kpis.reactivationOpportunities} />
        <KpiCard
          label="Conversion rate"
          value={kpis.conversionRate}
          previous={kpis.previous.conversionRate}
          format="percent"
          target={0.35}
        />
        <KpiCard
          label="Past SLA"
          value={kpis.slaBreached}
          goodWhen="down"
          accent={kpis.slaBreached > 0 ? 'critical' : 'default'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <SectionHeader title="Today's priority work" description="What this hospital's team should do next." />
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {workQueue.map((g) => (
              <li key={g.category}>
                <Link
                  href={`/opportunities?hospital=${id}&category=${g.category}&lifecycle=open`}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:bg-brand-50/60 dark:hover:bg-ink-800/60"
                >
                  <span className="tabular w-10 shrink-0 text-right text-lg font-semibold text-ink-900 dark:text-ink-50">
                    {count(g.count)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                      {g.label}
                    </span>
                    <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                      {g.critical} high priority · oldest {g.oldestDays}d
                      {g.breached > 0 && (
                        <span className="ml-1 font-medium text-danger-600 dark:text-danger-500">
                          · {g.breached} past SLA
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-ink-500">{moneyCompact(g.potentialValue)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="xl:col-span-2">
          <SectionHeader title="Opportunity conversion funnel" description="This hospital's pipeline, end to end." />
          <Funnel stages={funnel} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader title="Department opportunities" description="Open value by department." />
          <TableShell
            head={
              <>
                <th className="th">Department</th>
                <th className="th">Cost centre</th>
                <th className="th text-right">Open</th>
                <th className="th">Share</th>
                <th className="th text-right">Value</th>
              </>
            }
          >
            {departmentBreakdown.map((d) => (
              <tr key={d.id} className="row-link">
                <td className="td">
                  <Link
                    href={`/opportunities?hospital=${id}&department=${d.id}&lifecycle=open`}
                    className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                  >
                    {d.name}
                  </Link>
                </td>
                <td className="td font-mono text-2xs text-ink-400">{d.costCentre}</td>
                <td className="td tabular text-right">{count(d.open)}</td>
                <td className="td">
                  <MiniBar value={d.value} max={maxDeptValue} />
                </td>
                <td className="td tabular text-right font-medium">{moneyCompact(d.value)}</td>
              </tr>
            ))}
          </TableShell>
        </Card>

        <Card>
          <SectionHeader title="Specialty opportunities" description="Open value by specialty." />
          <HorizontalBars
            data={specialtyBreakdown.slice(0, 12).map((s) => ({
              label: s.name,
              value: Math.round(s.value),
            }))}
            money
            height={Math.max(200, Math.min(12, specialtyBreakdown.length) * 32)}
            tone={2}
          />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader title="Opportunity categories" description="Volume and conversion by type." />
          <TableShell
            head={
              <>
                <th className="th">Category</th>
                <th className="th text-right">Open</th>
                <th className="th text-right">Potential</th>
                <th className="th text-right">Converted</th>
                <th className="th text-right">Rate</th>
              </>
            }
          >
            {categories.map((c) => (
              <tr key={c.category}>
                <td className="td">
                  <Link
                    href={`/opportunities?hospital=${id}&category=${c.category}&lifecycle=open`}
                    className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                  >
                    {CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.label}
                  </Link>
                </td>
                <td className="td tabular text-right">{count(c.open)}</td>
                <td className="td tabular text-right">{money(c.potentialValue)}</td>
                <td className="td tabular text-right">{count(c.converted)}</td>
                <td className="td tabular text-right">{percent(c.conversionRate, 0)}</td>
              </tr>
            ))}
          </TableShell>
        </Card>

        <Card>
          <SectionHeader title="Highest value open opportunities" description="Largest single items awaiting action here." />
          <OpportunityMiniList principal={principal} items={top.items} />
        </Card>
      </div>
    </div>
  )
}
