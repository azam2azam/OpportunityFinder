import Link from 'next/link'
import clsx from 'clsx'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { DOMAIN_BY_KEY } from '@/lib/ingestion/domains'
import { count, percent, relative, humanise } from '@/lib/format'
import {
  PageHeader, Card, SectionHeader, KpiCard, TableShell, MiniBar, EmptyState,
} from '@/components/ui'
import { RunQuality } from '@/components/client/RunQuality'
import { can } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

/**
 * Data Quality.
 *
 * Ingestion answers "did the rows load". This answers "can the platform
 * actually use them", which is a different and more important question — a feed
 * can load ten thousand rows cleanly and still leave every rule finding nothing
 * because the one field they depend on is empty.
 *
 * Each failing check carries its remediation, because the useful output is not
 * a red badge but a sentence telling the integrator what to change.
 */
export default async function DataQuality() {
  const principal = await guard('integration.view')

  const [rules, results, history] = await Promise.all([
    prisma.dataQualityRule.findMany({
      include: { pipeline: { select: { id: true, domain: true, name: true } } },
      orderBy: [{ severity: 'asc' }, { name: 'asc' }],
    }),
    prisma.dataQualityResult.findMany({
      orderBy: { evaluatedAt: 'desc' },
      take: 200,
      include: { rule: { select: { id: true, key: true } } },
    }),
    prisma.dataQualityResult.findMany({
      orderBy: { evaluatedAt: 'desc' },
      take: 400,
      select: { ruleId: true, passed: true, evaluatedAt: true, measuredValue: true },
    }),
  ])

  // Latest result per rule. Earlier evaluations are history, not extra failures.
  const latest = new Map<string, (typeof results)[number]>()
  for (const r of results) {
    if (!latest.has(r.ruleId)) latest.set(r.ruleId, r)
  }

  const rows = rules.map((rule) => {
    const result = latest.get(rule.id)
    const runs = history.filter((h) => h.ruleId === rule.id)
    return {
      ...rule,
      result,
      // Pass rate over recent evaluations: a check that flickers is a different
      // problem from one that has simply always failed.
      recentPassRate: runs.length > 0 ? runs.filter((r) => r.passed).length / runs.length : null,
      evaluations: runs.length,
    }
  })

  const evaluated = rows.filter((r) => r.result)
  const failing = evaluated.filter((r) => r.result && !r.result.passed)
  const criticalFailing = failing.filter((r) => r.severity === 'CRITICAL')
  const neverEvaluated = rows.filter((r) => !r.result)

  const byDimension = new Map<string, { total: number; passing: number }>()
  for (const r of evaluated) {
    const d = byDimension.get(r.dimension) ?? { total: 0, passing: 0 }
    d.total++
    if (r.result?.passed) d.passing++
    byDimension.set(r.dimension, d)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Quality"
        question="Can the platform actually use what landed?"
        description="A clean load is not the same as usable data. These checks test the fields the detection rules depend on, and each failure says what to fix."
        actions={can(principal, 'integration.manage') ? <RunQuality /> : null}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Checks configured" value={rules.length} hint={`${evaluated.length} have been evaluated.`} />
        <KpiCard
          label="Passing"
          value={evaluated.length - failing.length}
          hint={evaluated.length > 0 ? `${percent((evaluated.length - failing.length) / evaluated.length, 0)} of evaluated checks.` : undefined}
        />
        <KpiCard
          label="Failing"
          value={failing.length}
          goodWhen="down"
          accent={failing.length > 0 ? 'critical' : 'default'}
        />
        <KpiCard
          label="Critical failures"
          value={criticalFailing.length}
          goodWhen="down"
          accent={criticalFailing.length > 0 ? 'critical' : 'default'}
          hint="These stop a rule family from producing anything."
        />
      </div>

      {criticalFailing.length > 0 && (
        <section aria-label="Critical quality failures" className="space-y-2">
          {criticalFailing.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-critical-border bg-critical-bg px-4 py-3 dark:border-red-900 dark:bg-critical-dark"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="chip border-critical-border bg-white text-critical-text">Critical</span>
                <span className="font-medium text-ink-900 dark:text-ink-100">{r.name}</span>
                <span className="tabular text-sm text-ink-600 dark:text-ink-300">
                  {percent(r.result?.measuredValue ?? 0, 1)} measured against a {percent(r.threshold, 0)} threshold
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-700 dark:text-ink-200">{r.description}</p>
              {r.result && r.result.recordsFailed > 0 && (
                <p className="mt-1 text-xs text-ink-600 dark:text-ink-300">
                  {count(r.result.recordsFailed)} of {count(r.result.recordsTested)} records affected.
                  {parseSamples(r.result.sampleKeys).length > 0 && (
                    <span className="ml-1 font-mono">
                      Examples: {parseSamples(r.result.sampleKeys).slice(0, 5).join(', ')}
                    </span>
                  )}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      <Card>
        <SectionHeader
          title="Quality by dimension"
          description="Completeness is whether the field arrived; validity whether it is well-formed; consistency whether fields agree; timeliness whether the feed is current."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {['COMPLETENESS', 'VALIDITY', 'CONSISTENCY', 'TIMELINESS', 'UNIQUENESS'].map((dim) => {
            const d = byDimension.get(dim)
            const rate = d && d.total > 0 ? d.passing / d.total : null
            return (
              <div key={dim} className="rounded-md border border-ink-200 p-3 dark:border-ink-700">
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  {humanise(dim)}
                </p>
                <p
                  className={clsx(
                    'tabular mt-1 text-2xl font-semibold',
                    rate == null
                      ? 'text-ink-300 dark:text-ink-600'
                      : rate === 1
                        ? 'text-positive-600 dark:text-positive-500'
                        : 'text-warn-700 dark:text-warn-500'
                  )}
                >
                  {rate == null ? '—' : percent(rate, 0)}
                </p>
                <p className="mt-0.5 text-2xs text-ink-400">
                  {d ? `${d.passing} of ${d.total} passing` : 'not evaluated'}
                </p>
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="All checks"
          description="Failing checks first. The remediation column is what to act on."
        />
        {rules.length === 0 ? (
          <EmptyState title="No quality rules configured" />
        ) : (
          <TableShell
            head={
              <>
                <th className="th">Check</th>
                <th className="th">Feed</th>
                <th className="th">Dimension</th>
                <th className="th text-right">Measured</th>
                <th className="th text-right">Threshold</th>
                <th className="th">Level</th>
                <th className="th text-right">Affected</th>
                <th className="th">Last evaluated</th>
                <th className="th">Result</th>
              </>
            }
          >
            {[...rows]
              .sort((a, b) => {
                const aFail = a.result && !a.result.passed ? 0 : 1
                const bFail = b.result && !b.result.passed ? 0 : 1
                if (aFail !== bFail) return aFail - bFail
                const sev = { CRITICAL: 0, WARNING: 1, INFO: 2 } as Record<string, number>
                return (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3)
              })
              .map((r) => (
                <tr key={r.id}>
                  <td className="td">
                    <span className="block font-medium text-ink-900 dark:text-ink-100">{r.name}</span>
                    <span className="block max-w-lg text-2xs leading-relaxed text-ink-500 dark:text-ink-400">
                      {r.description}
                    </span>
                    <span className="mt-0.5 block font-mono text-2xs text-ink-400">{r.expression}</span>
                  </td>
                  <td className="td whitespace-nowrap text-xs">
                    <Link
                      href={`/integration/pipelines/${r.pipeline.id}`}
                      className="hover:text-brand-700 dark:hover:text-brand-300"
                    >
                      {DOMAIN_BY_KEY[r.pipeline.domain]?.label ?? r.pipeline.domain}
                    </Link>
                  </td>
                  <td className="td text-xs">{humanise(r.dimension)}</td>
                  <td className="td tabular text-right font-medium">
                    {r.result ? percent(r.result.measuredValue, 1) : '—'}
                  </td>
                  <td className="td tabular text-right text-ink-500">{percent(r.threshold, 0)}</td>
                  <td className="td">
                    {r.result ? (
                      <MiniBar value={r.result.measuredValue} max={1} tone={r.result.passed ? 'positive' : 'warn'} />
                    ) : (
                      <span className="text-2xs text-ink-400">—</span>
                    )}
                  </td>
                  <td className="td tabular text-right">
                    {r.result ? count(r.result.recordsFailed) : '—'}
                  </td>
                  <td className="td whitespace-nowrap text-2xs text-ink-500">
                    {r.result ? relative(r.result.evaluatedAt) : 'Never'}
                  </td>
                  <td className="td">
                    {!r.result ? (
                      <span className="chip border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800">
                        Not run
                      </span>
                    ) : r.result.passed ? (
                      <span className="chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100">
                        Pass
                      </span>
                    ) : (
                      <span
                        className={
                          r.severity === 'CRITICAL'
                            ? 'chip border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
                            : 'chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                        }
                      >
                        Fail
                      </span>
                    )}
                  </td>
                </tr>
              ))}
          </TableShell>
        )}
        {neverEvaluated.length > 0 && (
          <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
            {count(neverEvaluated.length)} checks have never been evaluated. Quality runs after a
            real load, so a feed that has only ever been dry-run has no results yet.
          </p>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Why quality is measured separately from ingestion"
          description="The two failure modes look nothing alike from the operator's side."
        />
        <div className="space-y-3 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
          <p>
            An ingestion failure is loud. Rows are rejected, the run is marked partial, and the
            rejected-row list names the field and the value. Somebody notices within a cycle.
          </p>
          <p>
            A quality failure is silent. Every row loads, the run is green, and the platform simply
            stops finding anything — because the one column that a rule family depends on arrived
            empty on all of them. Nobody notices for weeks, and when they do, the conclusion drawn
            is usually that the detection rules do not work.
          </p>
          <p>
            That is what these checks exist to prevent. Each one tests a field that something
            downstream genuinely depends on, and names the consequence rather than reporting an
            abstract percentage. A consent column that is not mapped does not read as{' '}
            <span className="font-mono text-xs">0.00% completeness</span>; it reads as{' '}
            <em>every patient is excluded from outreach and this is probably a mapping error, not a
            population that unanimously refused</em>.
          </p>
        </div>
      </Card>
    </div>
  )
}

function parseSamples(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
