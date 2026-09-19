import Link from 'next/link'
import clsx from 'clsx'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { getPipelineHealth } from '@/lib/ingestion/run'
import { DOMAIN_BY_KEY } from '@/lib/ingestion/domains'
import { count, percent, relative, humanise } from '@/lib/format'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell, MiniBar, EmptyState } from '@/components/ui'
import { RunStatusChip } from '../page'

export const dynamic = 'force-dynamic'

/**
 * Ingestion Pipelines.
 *
 * The monitoring screen. Sorted so problems surface first — stale, then
 * failing, then everything healthy — because a list sorted alphabetically makes
 * the operator do the triage the page should have done for them.
 */
export default async function Pipelines() {
  await guard('integration.view')

  const [health, recentRuns, issueCounts] = await Promise.all([
    getPipelineHealth(),
    prisma.ingestionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 40,
      include: { pipeline: { select: { id: true, name: true, domain: true } } },
    }),
    prisma.ingestionIssue.groupBy({ by: ['code'], _count: true, orderBy: { _count: { code: 'desc' } } }),
  ])

  const problems = health.filter((h) => h.isStale || h.failuresLast30 > 0)
  const automated = health.filter((h) => h.schedule)
  const manual = health.filter((h) => !h.schedule)

  const ranked = [...automated].sort((a, b) => {
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1
    return b.failuresLast30 - a.failuresLast30 || b.rejectRate - a.rejectRate
  })

  const totalRuns = health.reduce((s, h) => s + h.runsLast30, 0)
  const totalFailures = health.reduce((s, h) => s + h.failuresLast30, 0)
  const maxRuns = Math.max(1, ...health.map((h) => h.runsLast30))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ingestion Pipelines"
        question="Is every feed running, and is what it loads usable?"
        description="Scheduled feeds first, problems at the top. Manual upload pipelines are listed separately — they run only when an operator triggers them."
        actions={
          <Link href="/integration/upload" className="btn btn-primary">
            Upload data
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Scheduled pipelines" value={automated.length} hint={`${manual.length} manual upload feeds.`} />
        <KpiCard label="Runs (30 days)" value={totalRuns} />
        <KpiCard
          label="Runs with rejections"
          value={totalFailures}
          goodWhen="down"
          accent={totalFailures > 0 ? 'critical' : 'default'}
          hint={totalRuns > 0 ? `${percent(totalFailures / totalRuns, 0)} of all runs.` : undefined}
        />
        <KpiCard
          label="Pipelines needing attention"
          value={problems.length}
          goodWhen="down"
          accent={problems.length > 0 ? 'critical' : 'default'}
        />
      </div>

      <Card>
        <SectionHeader
          title="Scheduled feeds"
          description="Ordered by severity: stale first, then those rejecting the most."
        />
        <TableShell
          head={
            <>
              <th className="th">Pipeline</th>
              <th className="th">Source</th>
              <th className="th">Mode</th>
              <th className="th">Schedule</th>
              <th className="th">Last run</th>
              <th className="th text-right">Loaded</th>
              <th className="th text-right">Reject rate</th>
              <th className="th text-right">Runs (30d)</th>
              <th className="th">Activity</th>
              <th className="th">State</th>
            </>
          }
        >
          {ranked.map((h) => (
            <tr key={h.pipelineId} className="row-link">
              <td className="td">
                <Link
                  href={`/integration/pipelines/${h.pipelineId}`}
                  className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                >
                  {DOMAIN_BY_KEY[h.domain]?.label ?? h.domain}
                </Link>
                <span className="block font-mono text-2xs text-ink-400">{h.key}</span>
              </td>
              <td className="td text-xs">{h.sourceName}</td>
              <td className="td text-xs">{humanise(h.mode)}</td>
              <td className="td font-mono text-2xs text-ink-500">{h.schedule}</td>
              <td className="td whitespace-nowrap text-xs">
                <span className={clsx(h.isStale && 'font-semibold text-warn-700 dark:text-warn-500')}>
                  {relative(h.lastRunAt)}
                </span>
              </td>
              <td className="td tabular text-right">{count(h.lastRecords)}</td>
              <td className="td tabular text-right">
                <span
                  className={clsx(
                    h.rejectRate > 0.05 ? 'font-medium text-warn-700 dark:text-warn-500' : 'text-ink-600 dark:text-ink-300'
                  )}
                >
                  {percent(h.rejectRate, 1)}
                </span>
              </td>
              <td className="td tabular text-right">{count(h.runsLast30)}</td>
              <td className="td">
                <MiniBar value={h.runsLast30} max={maxRuns} tone={h.failuresLast30 > 0 ? 'warn' : 'brand'} />
              </td>
              <td className="td">
                {h.isStale ? (
                  <span className="chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20">
                    Stale
                  </span>
                ) : h.enabled ? (
                  <span className="chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100">
                    Healthy
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
        <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
          A feed is stale once it has missed three scheduled cycles. One missed cycle is noise;
          three is a fault. The window is derived from each pipeline&rsquo;s own SLA, so a nightly
          claims feed and a fifteen-minute encounter feed are judged on their own terms.
        </p>
      </Card>

      <Card>
        <SectionHeader
          title="Manual upload feeds"
          description="Available for every domain. They run only when an operator uploads a file, so they are never stale."
        />
        <TableShell
          head={
            <>
              <th className="th">Domain</th>
              <th className="th">Target entity</th>
              <th className="th">Natural key</th>
              <th className="th text-right">Runs (30d)</th>
              <th className="th">Last run</th>
              <th className="th" />
            </>
          }
        >
          {manual.map((h) => {
            const domain = DOMAIN_BY_KEY[h.domain]
            return (
              <tr key={h.pipelineId} className="row-link">
                <td className="td font-medium text-ink-900 dark:text-ink-100">{domain?.label ?? h.domain}</td>
                <td className="td font-mono text-2xs text-ink-500">{domain?.targetEntity}</td>
                <td className="td font-mono text-2xs text-ink-500">{domain?.naturalKey.join(' + ')}</td>
                <td className="td tabular text-right">{count(h.runsLast30)}</td>
                <td className="td whitespace-nowrap text-xs text-ink-500">{relative(h.lastRunAt)}</td>
                <td className="td">
                  <Link
                    href={`/integration/upload?domain=${h.domain}`}
                    className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                  >
                    Upload →
                  </Link>
                </td>
              </tr>
            )
          })}
        </TableShell>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Recent runs"
            description="The last 40 loads across every pipeline."
          />
          <TableShell
            head={
              <>
                <th className="th">Pipeline</th>
                <th className="th">Started</th>
                <th className="th">Trigger</th>
                <th className="th text-right">Read</th>
                <th className="th text-right">Loaded</th>
                <th className="th text-right">Rejected</th>
                <th className="th">Status</th>
              </>
            }
          >
            {recentRuns.map((r) => (
              <tr key={r.id} className="row-link">
                <td className="td">
                  <Link
                    href={`/integration/pipelines/${r.pipeline.id}`}
                    className="block max-w-[180px] truncate text-sm hover:text-brand-700"
                  >
                    {DOMAIN_BY_KEY[r.pipeline.domain]?.label ?? r.pipeline.domain}
                  </Link>
                </td>
                <td className="td whitespace-nowrap text-xs text-ink-500">{relative(r.startedAt)}</td>
                <td className="td text-2xs">{humanise(r.trigger)}</td>
                <td className="td tabular text-right">{count(r.recordsRead)}</td>
                <td className="td tabular text-right">{count(r.recordsInserted + r.recordsUpdated)}</td>
                <td className="td tabular text-right">
                  {r.recordsRejected > 0 ? (
                    <span className="font-medium text-warn-700 dark:text-warn-500">{count(r.recordsRejected)}</span>
                  ) : (
                    <span className="text-ink-400">0</span>
                  )}
                </td>
                <td className="td">
                  <RunStatusChip status={r.status} />
                </td>
              </tr>
            ))}
          </TableShell>
        </Card>

        <Card>
          <SectionHeader
            title="Rejection reasons"
            description="Across all recorded runs. The top code is usually one upstream fix away from disappearing entirely."
          />
          {issueCounts.length === 0 ? (
            <EmptyState title="No rejections recorded" description="Every row loaded on every run." />
          ) : (
            <TableShell
              head={
                <>
                  <th className="th">Code</th>
                  <th className="th text-right">Occurrences</th>
                  <th className="th">What it means</th>
                </>
              }
            >
              {issueCounts.map((i) => (
                <tr key={i.code}>
                  <td className="td font-mono text-2xs text-ink-700 dark:text-ink-300">{i.code}</td>
                  <td className="td tabular text-right">{count(i._count)}</td>
                  <td className="td max-w-sm text-xs text-ink-600 dark:text-ink-300">
                    {ISSUE_EXPLANATION[i.code] ?? 'See the run detail for the affected rows.'}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </Card>
      </div>
    </div>
  )
}

const ISSUE_EXPLANATION: Record<string, string> = {
  UNRESOLVED_REFERENCE:
    'A business code — hospital, specialty, physician, payer or MRN — had no match. Load the reference data first; the platform never creates placeholder records.',
  INVALID_DATE:
    'A date was not ISO 8601. Ambiguous formats are rejected rather than guessed, because getting one wrong shifts a clinical follow-up window by a month.',
  REQUIRED_FIELD_EMPTY: 'A field the feed requires was blank.',
  INVALID_ENUM: 'A coded value was outside the set this feed accepts.',
  INVALID_NUMBER: 'A numeric field could not be parsed.',
  INVALID_BOOLEAN: 'A true/false field held something else. The loader accepts true/false, 1/0 and yes/no.',
  MISSING_REQUIRED_COLUMN: 'The file had no column for a required field — a structural problem, not a row problem.',
  UNKNOWN_COLUMN: 'A column not in this feed was ignored. Harmless, but worth checking the mapping is what you intended.',
  MISSING_NATURAL_KEY: 'The row had no complete natural key, so it could be neither matched nor inserted.',
  WRITE_FAILED: 'The row validated but the database rejected it — usually a constraint the mapping does not know about.',
  FOLLOW_UP_WITHOUT_INTERVAL:
    'An encounter flagged for follow-up with no interval. It loaded, but the follow-up-overdue rule will ignore it.',
  REJECTED_WITHOUT_REASON:
    'A rejected claim with no reason code. It loaded, but no recovery pathway can be assigned to it.',
  PENDING_WITH_VALUE: 'A laboratory row marked pending that also carried a result value.',
}
