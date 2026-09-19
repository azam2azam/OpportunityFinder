import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { scopeWhere } from '@/lib/queries'
import { parseFilters, type SearchParams } from '@/lib/params'
import { money, moneyCompact, count, percent } from '@/lib/format'
import { isTerminal } from '@/lib/enums'
import { PageHeader, Card, SectionHeader, TableShell, MiniBar, KpiCard, EmptyState } from '@/components/ui'
import { HorizontalBars } from '@/components/client/Charts'

export const dynamic = 'force-dynamic'

/**
 * Departments.
 *
 * Accountability view: every opportunity has an owning department, and this is
 * where a director sees which ones are accumulating unworked findings. The
 * responsible-department attribution on insurance rejections is shown alongside
 * clinical ownership, because a coding defect belongs to Health Information
 * Management even though the claim came from a clinic.
 */
export default async function Departments({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('analytics.view')
  const params = await searchParams
  const filters = parseFilters(params, { lifecycle: 'all' })

  const [departments, opportunities, rejectionOpps] = await Promise.all([
    prisma.department.findMany({
      where: principal.scopeLevel === 'GROUP' ? {} : { hospitalId: { in: principal.hospitalIds } },
      select: {
        id: true, name: true, code: true, costCentre: true,
        hospital: { select: { id: true, name: true, code: true } },
        _count: { select: { physicians: true } },
      },
      orderBy: [{ hospital: { name: 'asc' } }, { name: 'asc' }],
    }),
    prisma.opportunity.findMany({
      where: scopeWhere(principal, filters),
      select: {
        departmentId: true, status: true, priority: true, potentialValue: true,
        realisedValue: true, slaDueAt: true, detectedAt: true,
      },
    }),
    prisma.opportunity.findMany({
      where: scopeWhere(principal, { category: 'INSURANCE', lifecycle: 'open' }),
      select: { evidence: true, potentialValue: true },
    }),
  ])

  const now = Date.now()
  const rows = departments
    .map((d) => {
      const mine = opportunities.filter((o) => o.departmentId === d.id)
      const open = mine.filter((o) => !isTerminal(o.status))
      const converted = mine.filter((o) => o.status === 'CONVERTED')
      return {
        ...d,
        total: mine.length,
        open: open.length,
        critical: open.filter((o) => o.priority === 'CRITICAL' || o.priority === 'HIGH').length,
        potentialValue: open.reduce((s, o) => s + o.potentialValue, 0),
        realisedValue: converted.reduce((s, o) => s + o.realisedValue, 0),
        converted: converted.length,
        conversionRate: mine.length > 0 ? converted.length / mine.length : 0,
        breached: open.filter((o) => o.slaDueAt && o.slaDueAt.getTime() < now).length,
        avgAge:
          open.length > 0
            ? Math.round(
                open.reduce((s, o) => s + (now - o.detectedAt.getTime()) / 86_400_000, 0) / open.length
              )
            : 0,
      }
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => b.potentialValue - a.potentialValue)

  // Rejections attributed to the department that generated the defect.
  const byResponsible = new Map<string, { count: number; value: number }>()
  for (const o of rejectionOpps) {
    let dept: string | null = null
    try {
      const e = JSON.parse(o.evidence) as Record<string, unknown>
      if (typeof e.responsibleDepartment === 'string') dept = e.responsibleDepartment
    } catch {
      // A malformed evidence blob is a data problem, not a reason to fail the
      // page — the row simply goes unattributed.
    }
    if (!dept) continue
    const g = byResponsible.get(dept) ?? { count: 0, value: 0 }
    g.count++
    g.value += o.potentialValue
    byResponsible.set(dept, g)
  }

  const maxValue = Math.max(1, ...rows.map((r) => r.potentialValue))
  const totalOpen = rows.reduce((s, r) => s + r.open, 0)
  const totalValue = rows.reduce((s, r) => s + r.potentialValue, 0)
  const worst = [...rows].sort((a, b) => b.breached - a.breached)[0]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departments"
        question="Which departments are accumulating unworked opportunities?"
        description="Departmental accountability across the pipeline — open volume, value, conversion and service-level performance."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Departments with open work" value={rows.length} />
        <KpiCard label="Open opportunities" value={totalOpen} />
        <KpiCard label="Potential value" value={totalValue} format="moneyCompact" />
        <KpiCard
          label="Most SLA breaches"
          value={worst?.breached ?? 0}
          goodWhen="down"
          accent={(worst?.breached ?? 0) > 0 ? 'critical' : 'default'}
          hint={worst ? `${worst.name}, ${worst.hospital.name}` : undefined}
        />
      </div>

      <Card>
        <SectionHeader
          title="Departmental pipeline"
          description="Every department carrying opportunities, ranked by open value."
        />
        {rows.length === 0 ? (
          <EmptyState title="No departmental opportunities" description="Run detection to populate the pipeline." />
        ) : (
          <TableShell
            head={
              <>
                <th className="th">Department</th>
                <th className="th">Hospital</th>
                <th className="th">Cost centre</th>
                <th className="th text-right">Physicians</th>
                <th className="th text-right">Open</th>
                <th className="th text-right">High priority</th>
                <th className="th">Value</th>
                <th className="th text-right">Potential</th>
                <th className="th text-right">Realised</th>
                <th className="th text-right">Conversion</th>
                <th className="th text-right">Past SLA</th>
                <th className="th text-right">Avg age</th>
              </>
            }
          >
            {rows.map((d) => (
              <tr key={d.id} className="row-link">
                <td className="td">
                  <Link
                    href={`/opportunities?department=${d.id}&lifecycle=open`}
                    className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                  >
                    {d.name}
                  </Link>
                </td>
                <td className="td text-xs">
                  <Link href={`/hospitals/${d.hospital.id}`} className="hover:text-brand-700">
                    {d.hospital.name}
                  </Link>
                </td>
                <td className="td font-mono text-2xs text-ink-400">{d.costCentre}</td>
                <td className="td tabular text-right">{count(d._count.physicians)}</td>
                <td className="td tabular text-right font-medium">{count(d.open)}</td>
                <td className="td tabular text-right">
                  {d.critical > 0 ? (
                    <span className="font-medium text-critical-text dark:text-red-300">{count(d.critical)}</span>
                  ) : (
                    <span className="text-ink-400">0</span>
                  )}
                </td>
                <td className="td">
                  <MiniBar value={d.potentialValue} max={maxValue} />
                </td>
                <td className="td tabular text-right">{moneyCompact(d.potentialValue)}</td>
                <td className="td tabular text-right text-positive-600 dark:text-positive-500">
                  {d.realisedValue > 0 ? moneyCompact(d.realisedValue) : '—'}
                </td>
                <td className="td tabular text-right">{percent(d.conversionRate, 0)}</td>
                <td className="td tabular text-right">
                  {d.breached > 0 ? (
                    <span className="font-medium text-danger-600 dark:text-danger-500">{count(d.breached)}</span>
                  ) : (
                    <span className="text-ink-400">0</span>
                  )}
                </td>
                <td className="td tabular text-right">{d.avgAge}d</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>

      {byResponsible.size > 0 && (
        <Card>
          <SectionHeader
            title="Rejections by responsible department"
            description="Where claim rejections originate, rather than where the service was delivered. This is the attribution that identifies the process to fix."
          />
          <HorizontalBars
            data={[...byResponsible.entries()]
              .map(([label, g]) => ({ label, value: Math.round(g.value) }))
              .sort((a, b) => b.value - a.value)}
            money
            tone={4}
            height={Math.max(180, byResponsible.size * 34)}
          />
          <TableShell
            head={
              <>
                <th className="th">Responsible department</th>
                <th className="th text-right">Open rejections</th>
                <th className="th text-right">Recoverable value</th>
              </>
            }
          >
            {[...byResponsible.entries()]
              .sort((a, b) => b[1].value - a[1].value)
              .map(([dept, g]) => (
                <tr key={dept}>
                  <td className="td font-medium text-ink-900 dark:text-ink-100">{dept}</td>
                  <td className="td tabular text-right">{count(g.count)}</td>
                  <td className="td tabular text-right font-medium">{money(g.value)}</td>
                </tr>
              ))}
          </TableShell>
        </Card>
      )}
    </div>
  )
}
