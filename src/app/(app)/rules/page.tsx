import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { can } from '@/lib/rbac'
import { scopeWhere } from '@/lib/queries'
import { count, percent, money, dateTime, humanise } from '@/lib/format'
import { CATEGORY_LABEL } from '@/lib/enums'
import { PageHeader, Card, SectionHeader, TableShell, KpiCard, MiniBar, CategoryBadge } from '@/components/ui'
import { RunDetection } from '@/components/client/RunDetection'

export const dynamic = 'force-dynamic'

/**
 * Opportunity Rules.
 *
 * The rule catalogue with its live yield. Showing detection volume and
 * dismissal rate next to each rule is what makes the thresholds tunable in
 * practice rather than in principle: an administrator can see that a rule is
 * producing a thousand findings a week and being dismissed half the time, and
 * go and change the number that caused it.
 */
export default async function Rules() {
  const principal = await guard('rules.view')

  const [rules, counts, lastRun, activeModel] = await Promise.all([
    prisma.opportunityRule.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
    prisma.opportunity.groupBy({
      by: ['ruleId', 'status'],
      where: scopeWhere(principal, {}),
      _count: true,
      _sum: { potentialValue: true, realisedValue: true },
    }),
    prisma.detectionRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.scoringModel.findFirst({ where: { isActive: true }, include: { weights: true } }),
  ])

  const rows = rules.map((rule) => {
    const mine = counts.filter((c) => c.ruleId === rule.id)
    const total = mine.reduce((s, c) => s + c._count, 0)
    const open = mine
      .filter((c) => !['CONVERTED', 'CLOSED', 'REJECTED', 'NOT_APPLICABLE'].includes(c.status))
      .reduce((s, c) => s + c._count, 0)
    const converted = mine.filter((c) => c.status === 'CONVERTED').reduce((s, c) => s + c._count, 0)
    const dismissed = mine
      .filter((c) => c.status === 'REJECTED' || c.status === 'NOT_APPLICABLE')
      .reduce((s, c) => s + c._count, 0)
    return {
      ...rule,
      total,
      open,
      converted,
      dismissed,
      realised: mine.reduce((s, c) => s + (c._sum.realisedValue ?? 0), 0),
      potential: mine.reduce((s, c) => s + (c._sum.potentialValue ?? 0), 0),
      conversionRate: total > 0 ? converted / total : 0,
      dismissalRate: total > 0 ? dismissed / total : 0,
      paramCount: Object.keys(safeParams(rule.params)).length,
    }
  })

  const maxTotal = Math.max(1, ...rows.map((r) => r.total))
  const byCategory = new Map<string, typeof rows>()
  for (const r of rows) {
    const arr = byCategory.get(r.category) ?? []
    arr.push(r)
    byCategory.set(r.category, arr)
  }

  const enabled = rows.filter((r) => r.enabled).length
  const noisy = rows.filter((r) => r.dismissalRate > 0.3 && r.total >= 20).length
  const silent = rows.filter((r) => r.enabled && r.total === 0).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Opportunity Rules"
        question="What is the platform looking for, and is each rule earning its place?"
        description="Every detection rule with its parameters, live yield and quality. Thresholds are configuration, not code — changing one takes effect on the next detection run."
        actions={can(principal, 'detection.run') ? <RunDetection /> : null}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Rules enabled" value={enabled} hint={`${rows.length} in the catalogue.`} />
        <KpiCard
          label="Noisy rules"
          value={noisy}
          goodWhen="down"
          accent={noisy > 0 ? 'critical' : 'default'}
          hint="Over 30% of findings dismissed at meaningful volume — the thresholds need review."
        />
        <KpiCard
          label="Silent rules"
          value={silent}
          goodWhen="down"
          hint="Enabled but producing nothing. Either the pattern is genuinely absent or the thresholds are unreachable."
        />
        <KpiCard
          label="Realised from all rules"
          value={rows.reduce((s, r) => s + r.realised, 0)}
          format="moneyCompact"
        />
      </div>

      {lastRun && (
        <Card>
          <SectionHeader title="Last detection run" />
          <dl className="grid gap-4 sm:grid-cols-4">
            <div>
              <dt className="label">Started</dt>
              <dd className="mt-0.5 text-sm text-ink-900 dark:text-ink-100">{dateTime(lastRun.startedAt)}</dd>
            </div>
            <div>
              <dt className="label">Status</dt>
              <dd className="mt-0.5 text-sm text-ink-900 dark:text-ink-100">{humanise(lastRun.status)}</dd>
            </div>
            <div>
              <dt className="label">Triggered by</dt>
              <dd className="mt-0.5 text-sm text-ink-900 dark:text-ink-100">{lastRun.triggeredBy}</dd>
            </div>
            <div>
              <dt className="label">Duration</dt>
              <dd className="mt-0.5 text-sm text-ink-900 dark:text-ink-100">
                {lastRun.finishedAt
                  ? `${((lastRun.finishedAt.getTime() - lastRun.startedAt.getTime()) / 1000).toFixed(1)}s`
                  : 'Running'}
              </dd>
            </div>
          </dl>
          {lastRun.error && (
            <p className="mt-3 rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/15 dark:text-danger-500">
              {lastRun.error}
            </p>
          )}
        </Card>
      )}

      {activeModel && (
        <Card>
          <SectionHeader
            title="Active scoring model"
            description={`${activeModel.name} — the weights every opportunity is scored against.`}
            action={
              can(principal, 'scoring.edit') ? (
                <Link href="/admin" className="btn btn-secondary text-xs">
                  Edit weights
                </Link>
              ) : null
            }
          />
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {activeModel.weights
              .slice()
              .sort((a, b) => b.weight - a.weight)
              .map((w) => (
                <div key={w.id} className="rounded-md bg-ink-50 p-2.5 dark:bg-ink-800/60">
                  <p className="text-2xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
                    {humanise(w.factor.replace(/([A-Z])/g, ' $1'))}
                  </p>
                  <p className="tabular mt-0.5 text-lg font-semibold text-ink-900 dark:text-ink-50">
                    {w.weight}
                  </p>
                </div>
              ))}
          </div>
          {activeModel.notes && (
            <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">{activeModel.notes}</p>
          )}
        </Card>
      )}

      {[...byCategory.entries()].map(([category, catRules]) => (
        <Card key={category}>
          <SectionHeader
            title={CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL] ?? category}
            description={`${catRules.length} rules · ${count(catRules.reduce((s, r) => s + r.open, 0))} open findings`}
            action={<CategoryBadge category={category} />}
          />
          <TableShell
            head={
              <>
                <th className="th">Rule</th>
                <th className="th text-right">Params</th>
                <th className="th text-right">SLA</th>
                <th className="th text-right">Detected</th>
                <th className="th">Volume</th>
                <th className="th text-right">Open</th>
                <th className="th text-right">Converted</th>
                <th className="th text-right">Dismissed</th>
                <th className="th text-right">Realised</th>
                <th className="th">State</th>
              </>
            }
          >
            {catRules.map((r) => (
              <tr key={r.id} className="row-link">
                <td className="td">
                  <Link
                    href={`/rules/${r.id}`}
                    className="block max-w-sm font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                  >
                    {r.name}
                  </Link>
                  <span className="block font-mono text-2xs text-ink-400">{r.key}</span>
                </td>
                <td className="td tabular text-right">{r.paramCount}</td>
                <td className="td tabular text-right">{r.slaDays}d</td>
                <td className="td tabular text-right">{count(r.total)}</td>
                <td className="td">
                  <MiniBar value={r.total} max={maxTotal} />
                </td>
                <td className="td tabular text-right font-medium">{count(r.open)}</td>
                <td className="td tabular text-right">{percent(r.conversionRate, 0)}</td>
                <td className="td tabular text-right">
                  <span
                    className={
                      r.dismissalRate > 0.3 && r.total >= 20
                        ? 'font-medium text-warn-700 dark:text-warn-500'
                        : 'text-ink-600 dark:text-ink-300'
                    }
                  >
                    {percent(r.dismissalRate, 0)}
                  </span>
                </td>
                <td className="td tabular text-right text-positive-600 dark:text-positive-500">
                  {r.realised > 0 ? money(r.realised) : '—'}
                </td>
                <td className="td">
                  {r.enabled ? (
                    <span className="chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100">
                      Enabled
                    </span>
                  ) : (
                    <span className="chip border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800">
                      Disabled
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
        </Card>
      ))}
    </div>
  )
}

function safeParams(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
