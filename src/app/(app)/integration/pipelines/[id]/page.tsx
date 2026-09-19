import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { can } from '@/lib/rbac'
import { DOMAIN_BY_KEY } from '@/lib/ingestion/domains'
import { count, percent, relative, humanise, dateTime } from '@/lib/format'
import {
  PageHeader, Card, SectionHeader, KpiCard, TableShell, Stat, EmptyState, MiniBar,
} from '@/components/ui'
import { AreaTrend } from '@/components/client/Charts'
import { RunStatusChip } from '../../page'

export const dynamic = 'force-dynamic'

/**
 * One pipeline: its configuration, its run history, and every row it rejected.
 *
 * The rejected-row list is the point of this page. An integrator fixing a feed
 * needs the row number, the field and the value that failed — anything less and
 * they are guessing at a file with fifty thousand lines in it.
 */
export default async function PipelineDetail({ params }: { params: Promise<{ id: string }> }) {
  const principal = await guard('integration.view')
  const { id } = await params

  const pipeline = await prisma.ingestionPipeline.findUnique({
    where: { id },
    include: {
      sourceSystem: true,
      mappings: { orderBy: { sourceField: 'asc' } },
      qualityRules: true,
    },
  })
  if (!pipeline) notFound()

  const domain = DOMAIN_BY_KEY[pipeline.domain]

  const [runs, issues, latestQuality, aggregate] = await Promise.all([
    prisma.ingestionRun.findMany({
      where: { pipelineId: id },
      orderBy: { startedAt: 'desc' },
      take: 40,
    }),
    prisma.ingestionIssue.findMany({
      where: { run: { pipelineId: id } },
      orderBy: { id: 'desc' },
      take: 60,
      include: { run: { select: { startedAt: true, fileName: true } } },
    }),
    prisma.dataQualityResult.findMany({
      where: { rule: { pipelineId: id } },
      orderBy: { evaluatedAt: 'desc' },
      take: 30,
      include: { rule: true },
    }),
    prisma.ingestionRun.aggregate({
      where: { pipelineId: id, startedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      _count: true,
      _sum: { recordsRead: true, recordsInserted: true, recordsUpdated: true, recordsRejected: true },
      _avg: { durationMs: true },
    }),
  ])

  const read = aggregate._sum.recordsRead ?? 0
  const rejected = aggregate._sum.recordsRejected ?? 0

  // Most recent evaluation per rule; earlier ones are history.
  const seen = new Set<string>()
  const currentQuality = latestQuality.filter((r) => {
    if (seen.has(r.ruleId)) return false
    seen.add(r.ruleId)
    return true
  })

  // Daily volume for the trend — runs are irregular, days are comparable.
  const byDay = new Map<string, number>()
  for (let d = 13; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86_400_000)
    byDay.set(`${day.getMonth() + 1}/${day.getDate()}`, 0)
  }
  for (const run of runs) {
    const key = `${run.startedAt.getMonth() + 1}/${run.startedAt.getDate()}`
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + run.recordsInserted + run.recordsUpdated)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={domain?.label ?? pipeline.domain}
        description={pipeline.description}
        actions={
          <>
            <Link href="/integration/pipelines" className="btn btn-secondary">
              All pipelines
            </Link>
            {can(principal, 'integration.ingest') && (
              <Link href={`/integration/upload?domain=${pipeline.domain}`} className="btn btn-primary">
                Upload to this feed
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="chip border-ink-200 bg-white font-mono text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
          {pipeline.key}
        </span>
        <span className="chip border-ink-200 bg-white text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
          {pipeline.sourceSystem.name}
        </span>
        <span className="chip border-ink-200 bg-white text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
          {humanise(pipeline.mode)}
        </span>
        {pipeline.enabled ? (
          <span className="chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100">
            Enabled
          </span>
        ) : (
          <span className="chip border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800">
            Disabled
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Runs (30 days)" value={aggregate._count} />
        <KpiCard
          label="Records loaded"
          value={(aggregate._sum.recordsInserted ?? 0) + (aggregate._sum.recordsUpdated ?? 0)}
          hint={`${count(aggregate._sum.recordsInserted ?? 0)} inserted, ${count(aggregate._sum.recordsUpdated ?? 0)} updated.`}
        />
        <KpiCard
          label="Reject rate"
          value={read > 0 ? rejected / read : 0}
          format="percent"
          goodWhen="down"
          accent={read > 0 && rejected / read > 0.05 ? 'critical' : 'default'}
        />
        <KpiCard
          label="Average duration"
          value={Math.round((aggregate._avg.durationMs ?? 0) / 100) / 10}
          hint="Seconds per run."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <SectionHeader title="Configuration" />
          <dl className="space-y-3">
            <Stat label="Source system" value={pipeline.sourceSystem.name} />
            <Stat label="Connection mode" value={humanise(pipeline.sourceSystem.connectionMode)} />
            <Stat label="Load mode" value={humanise(pipeline.mode)} />
            <Stat
              label="Schedule"
              value={pipeline.schedule ? <span className="font-mono text-xs">{pipeline.schedule}</span> : 'On demand'}
            />
            <Stat label="SLA" value={`${pipeline.slaMinutes} minutes`} />
            <Stat label="Target entity" value={<span className="font-mono text-xs">{pipeline.targetEntity}</span>} />
            <Stat
              label="Natural key"
              value={<span className="font-mono text-xs">{domain?.naturalKey.join(' + ') ?? '—'}</span>}
            />
            <Stat label="Watermark field" value={pipeline.watermarkField ?? 'Not incremental'} />
            <Stat
              label="Last watermark"
              value={pipeline.lastWatermark ? dateTime(new Date(pipeline.lastWatermark)) : '—'}
            />
            <Stat label="Expected volume" value={`${count(pipeline.expectedRecordsPerRun)} records per run`} />
            <Stat label="Mapped fields" value={count(pipeline.mappings.length)} />
          </dl>
        </Card>

        <Card className="xl:col-span-2">
          <SectionHeader title="Daily volume" description="Records loaded per day over the last fortnight." />
          <AreaTrend
            data={[...byDay.entries()].map(([period, records]) => ({ period, records }))}
            dataKey="records"
            name="Records loaded"
            tone={1}
            height={220}
          />
          {domain && (
            <div className="mt-4 rounded-md border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/40">
              <p className="text-2xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">
                Operator notes for this feed
              </p>
              <ul className="mt-1.5 space-y-1">
                {domain.operatorNotes.map((note, i) => (
                  <li key={i} className="flex gap-2 text-sm text-brand-900/90 dark:text-brand-100/90">
                    <span aria-hidden className="text-brand-400">
                      •
                    </span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeader title="Run history" description="Every recorded load for this pipeline." />
        {runs.length === 0 ? (
          <EmptyState title="No runs recorded" description="This pipeline has not loaded anything yet." />
        ) : (
          <TableShell
            head={
              <>
                <th className="th">Started</th>
                <th className="th">Trigger</th>
                <th className="th">File</th>
                <th className="th text-right">Read</th>
                <th className="th text-right">Inserted</th>
                <th className="th text-right">Updated</th>
                <th className="th text-right">Rejected</th>
                <th className="th text-right">Duration</th>
                <th className="th">Status</th>
                <th className="th">Summary</th>
              </>
            }
          >
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="td whitespace-nowrap text-xs">{dateTime(r.startedAt)}</td>
                <td className="td text-2xs">
                  {humanise(r.trigger)}
                  {r.dryRun && (
                    <span className="ml-1 chip border-ink-200 bg-ink-100 text-2xs text-ink-500 dark:border-ink-700 dark:bg-ink-800">
                      dry run
                    </span>
                  )}
                </td>
                <td className="td max-w-[160px] truncate font-mono text-2xs text-ink-500">
                  {r.fileName ?? '—'}
                </td>
                <td className="td tabular text-right">{count(r.recordsRead)}</td>
                <td className="td tabular text-right">{count(r.recordsInserted)}</td>
                <td className="td tabular text-right">{count(r.recordsUpdated)}</td>
                <td className="td tabular text-right">
                  {r.recordsRejected > 0 ? (
                    <span className="font-medium text-warn-700 dark:text-warn-500">{count(r.recordsRejected)}</span>
                  ) : (
                    <span className="text-ink-400">0</span>
                  )}
                </td>
                <td className="td tabular text-right text-xs">{(r.durationMs / 1000).toFixed(1)}s</td>
                <td className="td">
                  <RunStatusChip status={r.status} />
                </td>
                <td className="td max-w-sm text-2xs text-ink-500">{r.errorSummary ?? '—'}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Rejected rows"
          description="The row, field and value behind each rejection. This is what to hand back to the source team."
        />
        {issues.length === 0 ? (
          <EmptyState title="No rejections" description="Every row this pipeline has read was accepted." />
        ) : (
          <TableShell
            head={
              <>
                <th className="th">Run</th>
                <th className="th text-right">Row</th>
                <th className="th">Severity</th>
                <th className="th">Code</th>
                <th className="th">Field</th>
                <th className="th">Value</th>
                <th className="th">Message</th>
              </>
            }
          >
            {issues.map((i) => (
              <tr key={i.id}>
                <td className="td whitespace-nowrap text-2xs text-ink-500">{relative(i.run.startedAt)}</td>
                <td className="td tabular text-right text-xs">{i.rowNumber}</td>
                <td className="td">
                  <span
                    className={
                      i.severity === 'ERROR'
                        ? 'chip border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
                        : 'chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                    }
                  >
                    {humanise(i.severity)}
                  </span>
                </td>
                <td className="td font-mono text-2xs text-ink-700 dark:text-ink-300">{i.code}</td>
                <td className="td font-mono text-2xs text-ink-500">{i.field ?? '—'}</td>
                <td className="td font-mono text-2xs text-danger-600 dark:text-danger-500">{i.rawValue ?? '—'}</td>
                <td className="td max-w-md text-xs text-ink-600 dark:text-ink-300">{i.message}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>

      {currentQuality.length > 0 && (
        <Card>
          <SectionHeader
            title="Data quality"
            description="Whether what landed can actually drive the rules that depend on it."
            action={
              <Link href="/integration/quality" className="btn btn-ghost text-xs">
                All quality rules
              </Link>
            }
          />
          <TableShell
            head={
              <>
                <th className="th">Check</th>
                <th className="th">Dimension</th>
                <th className="th text-right">Measured</th>
                <th className="th text-right">Threshold</th>
                <th className="th">Level</th>
                <th className="th text-right">Failing rows</th>
                <th className="th">Result</th>
              </>
            }
          >
            {currentQuality.map((r) => (
              <tr key={r.id}>
                <td className="td">
                  <span className="block font-medium text-ink-900 dark:text-ink-100">{r.rule.name}</span>
                  <span className="block max-w-md text-2xs text-ink-500">{r.rule.description}</span>
                </td>
                <td className="td text-xs">{humanise(r.rule.dimension)}</td>
                <td className="td tabular text-right font-medium">{percent(r.measuredValue, 1)}</td>
                <td className="td tabular text-right text-ink-500">{percent(r.threshold, 0)}</td>
                <td className="td">
                  <MiniBar value={r.measuredValue} max={1} tone={r.passed ? 'positive' : 'warn'} />
                </td>
                <td className="td tabular text-right">{count(r.recordsFailed)}</td>
                <td className="td">
                  {r.passed ? (
                    <span className="chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100">
                      Pass
                    </span>
                  ) : (
                    <span className="chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20">
                      Fail
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
        </Card>
      )}
    </div>
  )
}
