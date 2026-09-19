import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { getHospitalComparison } from '@/lib/queries'
import { parseFilters, type SearchParams } from '@/lib/params'
import { money, moneyCompact, count, percent } from '@/lib/format'
import { PageHeader, Card, SectionHeader, TableShell, MiniBar, KpiCard } from '@/components/ui'
import { GroupedBars, HorizontalBars } from '@/components/client/Charts'

export const dynamic = 'force-dynamic'

/**
 * Hospitals — group-level comparison (spec section 24).
 *
 * The comparison is deliberately normalised as well as absolute: a 420-bed
 * hospital will always top a raw opportunity count, which says nothing about
 * whether it is performing. Opportunities per thousand patients and conversion
 * rate are the columns that actually separate a hospital that is improving from
 * one that is merely large.
 */
export default async function Hospitals({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('opportunity.view')
  const params = await searchParams
  const filters = parseFilters(params, { lifecycle: 'all' })

  const [comparison, hospitals] = await Promise.all([
    getHospitalComparison(principal, filters),
    prisma.hospital.findMany({
      where: principal.scopeLevel === 'GROUP' ? {} : { id: { in: principal.hospitalIds } },
      select: {
        id: true, name: true, code: true, city: true, region: true, beds: true,
        _count: { select: { physicians: true, departments: true, patients: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ])

  const byId = new Map(hospitals.map((h) => [h.id, h]))
  const rows = comparison.map((c) => {
    const h = byId.get(c.hospitalId)
    const beds = h?.beds ?? 0
    return {
      ...c,
      beds,
      physicians: h?._count.physicians ?? 0,
      departments: h?._count.departments ?? 0,
      region: h?.region ?? '',
      // Normalising by patient population is what makes the comparison fair.
      openPerThousand: c.patients > 0 ? (c.open / c.patients) * 1000 : 0,
      valuePerPatient: c.patients > 0 ? c.potentialValue / c.patients : 0,
    }
  })

  const totals = rows.reduce(
    (acc, r) => ({
      patients: acc.patients + r.patients,
      open: acc.open + r.open,
      potential: acc.potential + r.potentialValue,
      realised: acc.realised + r.realisedValue,
      breached: acc.breached + r.slaBreached,
    }),
    { patients: 0, open: 0, potential: 0, realised: 0, breached: 0 }
  )

  const bestConverter = [...rows].sort((a, b) => b.conversionRate - a.conversionRate)[0]
  const maxOpen = Math.max(1, ...rows.map((r) => r.open))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hospitals"
        question="Which hospital is improving, and which needs support?"
        description="Group-level comparison across volume, opportunity pipeline, conversion and service-level performance. Drill into any hospital for its departments, specialties and physicians."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Hospitals in scope" value={rows.length} />
        <KpiCard label="Patients" value={totals.patients} />
        <KpiCard label="Open pipeline" value={totals.potential} format="moneyCompact" />
        <KpiCard
          label="Best conversion"
          value={bestConverter?.conversionRate ?? 0}
          format="percent"
          hint={bestConverter ? bestConverter.name : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Open opportunities by hospital"
            description="Absolute volume — larger hospitals naturally carry more."
          />
          <HorizontalBars
            data={rows.map((r) => ({ label: r.name, value: r.open }))}
            height={Math.max(180, rows.length * 38)}
          />
        </Card>

        <Card>
          <SectionHeader
            title="Normalised by population"
            description="Open opportunities per thousand patients. This is the fair comparison — a high figure means loops are being left open, not that the hospital is busy."
          />
          <HorizontalBars
            data={rows.map((r) => ({ label: r.name, value: Math.round(r.openPerThousand) }))}
            height={Math.max(180, rows.length * 38)}
            tone={3}
          />
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Conversion and recovery"
          description="Converted opportunities against realised value, by hospital."
        />
        <GroupedBars
          data={rows.map((r) => ({
            label: r.code,
            converted: r.converted,
            open: r.open,
          }))}
          series={[
            { key: 'open', name: 'Open' },
            { key: 'converted', name: 'Converted' },
          ]}
          height={280}
        />
      </Card>

      <Card>
        <SectionHeader title="Hospital comparison" description="Drill down: hospital → department → specialty → physician → opportunity → patient." />
        <TableShell
          head={
            <>
              <th className="th">Hospital</th>
              <th className="th">Region</th>
              <th className="th text-right">Beds</th>
              <th className="th text-right">Patients</th>
              <th className="th text-right">Open</th>
              <th className="th">Volume</th>
              <th className="th text-right">Per 1k patients</th>
              <th className="th text-right">Potential</th>
              <th className="th text-right">Realised</th>
              <th className="th text-right">Conversion</th>
              <th className="th text-right">Past SLA</th>
              <th className="th text-right">Avg age</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.hospitalId} className="row-link">
              <td className="td">
                <Link
                  href={`/hospitals/${r.hospitalId}`}
                  className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                >
                  {r.name}
                </Link>
                <span className="block text-xs text-ink-500">{r.city}</span>
              </td>
              <td className="td text-xs">{r.region}</td>
              <td className="td tabular text-right">{count(r.beds)}</td>
              <td className="td tabular text-right">{count(r.patients)}</td>
              <td className="td tabular text-right font-medium">{count(r.open)}</td>
              <td className="td">
                <MiniBar value={r.open} max={maxOpen} />
              </td>
              <td className="td tabular text-right">{r.openPerThousand.toFixed(0)}</td>
              <td className="td tabular text-right">{moneyCompact(r.potentialValue)}</td>
              <td className="td tabular text-right text-positive-600 dark:text-positive-500">
                {r.realisedValue > 0 ? moneyCompact(r.realisedValue) : '—'}
              </td>
              <td className="td tabular text-right">{percent(r.conversionRate, 0)}</td>
              <td className="td tabular text-right">
                {r.slaBreached > 0 ? (
                  <span className="font-medium text-danger-600 dark:text-danger-500">
                    {count(r.slaBreached)}
                  </span>
                ) : (
                  <span className="text-ink-400">0</span>
                )}
              </td>
              <td className="td tabular text-right">{r.avgAgeDays}d</td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink-200 font-medium dark:border-ink-700">
            <td className="td">Group total</td>
            <td className="td" />
            <td className="td" />
            <td className="td tabular text-right">{count(totals.patients)}</td>
            <td className="td tabular text-right">{count(totals.open)}</td>
            <td className="td" />
            <td className="td" />
            <td className="td tabular text-right">{money(totals.potential)}</td>
            <td className="td tabular text-right text-positive-600 dark:text-positive-500">
              {money(totals.realised)}
            </td>
            <td className="td" />
            <td className="td tabular text-right">{count(totals.breached)}</td>
            <td className="td" />
          </tr>
        </TableShell>
      </Card>
    </div>
  )
}
