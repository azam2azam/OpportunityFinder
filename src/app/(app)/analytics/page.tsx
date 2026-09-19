import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import {
  getFunnel, getCategorySummary, getHospitalComparison, getTrend, getAging, getKpis, scopeWhere,
} from '@/lib/queries'
import { parseFilters, type SearchParams } from '@/lib/params'
import { money, moneyCompact, count, percent } from '@/lib/format'
import { CATEGORY_LABEL } from '@/lib/enums'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell, MiniBar } from '@/components/ui'
import { Funnel } from '@/components/Funnel'
import { TrendLines, GroupedBars, Heatmap, ValueScatter, AreaTrend, Donut } from '@/components/client/Charts'

export const dynamic = 'force-dynamic'

/**
 * Analytics (spec section 19).
 *
 * Deliberately restrained. The spec's design philosophy warns against
 * decorative dashboards and data overload, so every chart here exists to
 * support a specific decision: where conversion is lost, where work is aging,
 * which hospital-and-type combinations are hot, and which opportunity types are
 * worth resourcing given both their value and their odds.
 */
export default async function Analytics({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('analytics.view')
  const params = await searchParams
  const filters = parseFilters(params, { lifecycle: 'all' })

  const [funnel, categories, hospitals, trend, aging, kpis, conversionSpeed, rulePerformance] =
    await Promise.all([
      getFunnel(principal, filters),
      getCategorySummary(principal, filters),
      getHospitalComparison(principal, filters),
      getTrend(principal, filters, 16),
      getAging(principal, filters),
      getKpis(principal, filters),
      prisma.conversion.findMany({
        where: { opportunity: scopeWhere(principal, {}) },
        select: { conversionType: true, daysToConvert: true, revenue: true },
      }),
      prisma.opportunity.groupBy({
        by: ['ruleId', 'status'],
        where: scopeWhere(principal, {}),
        _count: true,
        _sum: { potentialValue: true, realisedValue: true },
      }),
    ])

  // Heatmap: hospital × opportunity type, on open value.
  const openByCell = await prisma.opportunity.groupBy({
    by: ['hospitalId', 'category'],
    where: scopeWhere(principal, { lifecycle: 'open' }),
    _count: true,
    _sum: { potentialValue: true },
  })
  const heatRows = hospitals.map((h) => h.name)
  const heatCols = [...new Set(categories.map((c) => c.category))]
  const heatValues = hospitals.map((h) =>
    heatCols.map((c) => {
      const cell = openByCell.find((x) => x.hospitalId === h.hospitalId && x.category === c)
      return Math.round(cell?._sum.potentialValue ?? 0)
    })
  )

  // Rule-level performance, rolled up from the grouped counts.
  const ruleIds = [...new Set(rulePerformance.map((r) => r.ruleId))]
  const rules = await prisma.opportunityRule.findMany({
    where: { id: { in: ruleIds } },
    select: { id: true, key: true, name: true, category: true },
  })
  const ruleRows = rules
    .map((rule) => {
      const mine = rulePerformance.filter((r) => r.ruleId === rule.id)
      const total = mine.reduce((s, r) => s + r._count, 0)
      const converted = mine.filter((r) => r.status === 'CONVERTED').reduce((s, r) => s + r._count, 0)
      const rejected = mine
        .filter((r) => r.status === 'REJECTED' || r.status === 'NOT_APPLICABLE')
        .reduce((s, r) => s + r._count, 0)
      const realised = mine.reduce((s, r) => s + (r._sum.realisedValue ?? 0), 0)
      const potential = mine.reduce((s, r) => s + (r._sum.potentialValue ?? 0), 0)
      return {
        ...rule,
        total,
        converted,
        rejected,
        realised,
        potential,
        conversionRate: total > 0 ? converted / total : 0,
        // A rule whose findings are routinely dismissed is generating noise;
        // this is the number that tells an administrator to retune it.
        falsePositiveRate: total > 0 ? rejected / total : 0,
      }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)

  // Value against conversion probability, bubble-sized by volume.
  const scatter = categories.map((c) => ({
    x: c.conversionRate,
    y: c.potentialValue / Math.max(1, c.open),
    z: c.open,
    label: c.label,
  }))

  const speedByType = new Map<string, { total: number; days: number; revenue: number }>()
  for (const c of conversionSpeed) {
    const s = speedByType.get(c.conversionType) ?? { total: 0, days: 0, revenue: 0 }
    s.total++
    s.days += c.daysToConvert
    s.revenue += c.revenue
    speedByType.set(c.conversionType, s)
  }

  const maxRuleTotal = Math.max(1, ...ruleRows.map((r) => r.total))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        question="Where are opportunities being lost, and what should we resource?"
        description="Conversion performance, aging, rule quality and the value-versus-probability picture across the pipeline."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Conversion rate"
          value={kpis.conversionRate}
          previous={kpis.previous.conversionRate}
          format="percent"
          target={0.35}
        />
        <KpiCard label="Realised (30 days)" value={kpis.realisedValue} format="moneyCompact" previous={kpis.previous.realisedValue} />
        <KpiCard label="Open pipeline value" value={kpis.potentialValue} format="moneyCompact" />
        <KpiCard
          label="Past SLA"
          value={kpis.slaBreached}
          goodWhen="down"
          accent={kpis.slaBreached > 0 ? 'critical' : 'default'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Conversion funnel"
            description="Where the pipeline loses the most — the largest step drop is flagged."
          />
          <Funnel stages={funnel} />
        </Card>

        <Card>
          <SectionHeader
            title="Detection and conversion trend"
            description="Sixteen weeks. Detection outpacing conversion means the backlog is growing."
          />
          <TrendLines
            data={trend.map((t) => ({ period: t.period, detected: t.detected, converted: t.converted }))}
            series={[
              { key: 'detected', name: 'Detected' },
              { key: 'converted', name: 'Converted' },
            ]}
            height={300}
          />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Revenue recovery trend"
            description="Realised value per week from converted opportunities."
          />
          <AreaTrend
            data={trend.map((t) => ({ period: t.period, realised: Math.round(t.realisedValue) }))}
            dataKey="realised"
            name="Realised value"
            money
            tone={2}
            height={240}
          />
        </Card>

        <Card>
          <SectionHeader
            title="Opportunity aging"
            description="How long open work has been sitting. Anything past 30 days is unlikely to convert at the original rate."
          />
          <GroupedBars
            data={aging.map((a) => ({ label: a.label, open: a.count, breached: a.breached }))}
            series={[
              { key: 'open', name: 'Open' },
              { key: 'breached', name: 'Past SLA' },
            ]}
            height={240}
          />
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Hospital × opportunity type"
          description="Open value by hospital and type. Intensity is relative to the largest cell, so smaller hospitals stay legible."
        />
        <Heatmap
          rows={heatRows}
          columns={heatCols.map((c) => CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c)}
          values={heatValues}
          money
        />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Value against conversion probability"
            description="Average value per opportunity plotted against how often that type converts. Bubble size is open volume — the top-right quadrant is where resource pays back fastest."
          />
          <ValueScatter data={scatter} />
        </Card>

        <Card>
          <SectionHeader title="Opportunity composition" description="Open value by category." />
          <Donut
            data={categories.filter((c) => c.potentialValue > 0).map((c) => ({ label: c.label, value: c.potentialValue }))}
            money
            height={300}
          />
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Rule performance"
          description="How each detection rule is doing. A high dismissal rate means the rule is generating noise and its parameters need review."
        />
        <TableShell
          head={
            <>
              <th className="th">Rule</th>
              <th className="th">Category</th>
              <th className="th text-right">Detected</th>
              <th className="th">Volume</th>
              <th className="th text-right">Converted</th>
              <th className="th text-right">Conversion</th>
              <th className="th text-right">Dismissed</th>
              <th className="th text-right">Realised</th>
            </>
          }
        >
          {ruleRows.map((r) => (
            <tr key={r.id}>
              <td className="td">
                <span className="block max-w-xs truncate font-medium text-ink-900 dark:text-ink-100">
                  {r.name}
                </span>
                <span className="block font-mono text-2xs text-ink-400">{r.key}</span>
              </td>
              <td className="td text-xs">
                {CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category}
              </td>
              <td className="td tabular text-right">{count(r.total)}</td>
              <td className="td">
                <MiniBar value={r.total} max={maxRuleTotal} />
              </td>
              <td className="td tabular text-right">{count(r.converted)}</td>
              <td className="td tabular text-right">{percent(r.conversionRate, 0)}</td>
              <td className="td tabular text-right">
                <span
                  className={
                    r.falsePositiveRate > 0.3
                      ? 'font-medium text-warn-700 dark:text-warn-500'
                      : 'text-ink-600 dark:text-ink-300'
                  }
                >
                  {percent(r.falsePositiveRate, 0)}
                </span>
              </td>
              <td className="td tabular text-right text-positive-600 dark:text-positive-500">
                {r.realised > 0 ? money(r.realised) : '—'}
              </td>
            </tr>
          ))}
        </TableShell>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Time to conversion"
            description="How long converted opportunities took, by outcome type."
          />
          <TableShell
            head={
              <>
                <th className="th">Conversion type</th>
                <th className="th text-right">Conversions</th>
                <th className="th text-right">Avg days</th>
                <th className="th text-right">Revenue</th>
              </>
            }
          >
            {[...speedByType.entries()]
              .sort((a, b) => b[1].revenue - a[1].revenue)
              .map(([type, s]) => (
                <tr key={type}>
                  <td className="td capitalize">{type.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="td tabular text-right">{count(s.total)}</td>
                  <td className="td tabular text-right">{Math.round(s.days / s.total)}</td>
                  <td className="td tabular text-right font-medium">{money(s.revenue)}</td>
                </tr>
              ))}
          </TableShell>
        </Card>

        <Card>
          <SectionHeader
            title="Category performance"
            description="Volume, value and conversion by opportunity type."
          />
          <TableShell
            head={
              <>
                <th className="th">Category</th>
                <th className="th text-right">Open</th>
                <th className="th text-right">Potential</th>
                <th className="th text-right">Converted</th>
                <th className="th text-right">Realised</th>
                <th className="th text-right">Rate</th>
              </>
            }
          >
            {categories.map((c) => (
              <tr key={c.category}>
                <td className="td font-medium text-ink-900 dark:text-ink-100">{c.label}</td>
                <td className="td tabular text-right">{count(c.open)}</td>
                <td className="td tabular text-right">{moneyCompact(c.potentialValue)}</td>
                <td className="td tabular text-right">{count(c.converted)}</td>
                <td className="td tabular text-right text-positive-600 dark:text-positive-500">
                  {c.realisedValue > 0 ? moneyCompact(c.realisedValue) : '—'}
                </td>
                <td className="td tabular text-right">{percent(c.conversionRate, 0)}</td>
              </tr>
            ))}
          </TableShell>
        </Card>
      </div>
    </div>
  )
}
