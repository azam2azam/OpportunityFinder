import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { count, relative, humanise, dateTime } from '@/lib/format'
import { DOMAIN_BY_KEY } from '@/lib/ingestion/domains'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell, Stat } from '@/components/ui'
import { StatusChip } from '../page'

export const dynamic = 'force-dynamic'

/**
 * Source Systems.
 *
 * One card per system, carrying the things an integrator actually needs at
 * three in the morning: how it connects, who owns it, what it feeds, and the
 * operator notes describing its quirks. The notes field is the most valuable
 * part — it is where the knowledge that usually lives in one person's head gets
 * written down.
 */
export default async function SourceSystems() {
  await guard('integration.view')

  const [sources, runStats] = await Promise.all([
    prisma.sourceSystem.findMany({
      include: {
        pipelines: {
          select: {
            id: true, key: true, name: true, domain: true, mode: true,
            schedule: true, enabled: true, slaMinutes: true, expectedRecordsPerRun: true,
            lastWatermark: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    }),
    prisma.ingestionRun.groupBy({
      by: ['pipelineId'],
      where: { startedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      _count: true,
      _sum: { recordsInserted: true, recordsUpdated: true, recordsRejected: true },
      _max: { startedAt: true },
    }),
  ])

  const statsBy = new Map(runStats.map((r) => [r.pipelineId, r]))
  const connected = sources.filter((s) => s.status === 'CONNECTED').length
  const automated = sources.filter((s) => s.connectionMode !== 'MANUAL_UPLOAD').length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Source Systems"
        question="Where does the platform get its data, and who owns each connection?"
        description="Connection detail for every system feeding the platform, including the operational notes that make each one work."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Systems configured" value={sources.length} />
        <KpiCard label="Connected" value={connected} hint={`${sources.length - connected} degraded or not configured.`} />
        <KpiCard label="Automated connectors" value={automated} hint="The rest are operator-driven upload." />
        <KpiCard label="Pipelines" value={sources.reduce((s, x) => s + x.pipelines.length, 0)} />
      </div>

      {sources.map((source) => (
        <Card key={source.id}>
          <SectionHeader
            title={source.name}
            description={source.description}
            action={<StatusChip status={source.status} />}
          />

          <dl className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Code" value={<span className="font-mono text-xs">{source.code}</span>} />
            <Stat label="Vendor" value={source.vendor} />
            <Stat label="Type" value={humanise(source.type)} />
            <Stat label="Owning team" value={source.ownerTeam} />
            <Stat label="Connection mode" value={humanise(source.connectionMode)} />
            <Stat label="Authentication" value={humanise(source.authMode)} />
            <Stat label="Environment" value={humanise(source.environment)} />
            <Stat
              label="Last contact"
              value={source.lastContactAt ? relative(source.lastContactAt) : 'Never'}
            />
          </dl>

          {source.endpoint && (
            <div className="mb-4">
              <p className="label mb-1">Endpoint</p>
              <p className="overflow-x-auto rounded-md bg-ink-900 px-3 py-2 font-mono text-xs text-ink-100 dark:bg-ink-950">
                {source.endpoint}
              </p>
            </div>
          )}

          {source.operatorNotes && (
            <div className="mb-4 rounded-md border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/40">
              <p className="text-2xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">
                Operator notes
              </p>
              <p className="mt-1 text-sm leading-relaxed text-brand-900/90 dark:text-brand-100/90">
                {source.operatorNotes}
              </p>
            </div>
          )}

          {source.pipelines.length > 0 && (
            <TableShell
              head={
                <>
                  <th className="th">Pipeline</th>
                  <th className="th">Domain</th>
                  <th className="th">Mode</th>
                  <th className="th">Schedule</th>
                  <th className="th text-right">Runs (7d)</th>
                  <th className="th text-right">Loaded (7d)</th>
                  <th className="th text-right">Rejected</th>
                  <th className="th">Last run</th>
                  <th className="th">State</th>
                </>
              }
            >
              {source.pipelines.map((p) => {
                const stats = statsBy.get(p.id)
                const domain = DOMAIN_BY_KEY[p.domain]
                return (
                  <tr key={p.id} className="row-link">
                    <td className="td">
                      <Link
                        href={`/integration/pipelines/${p.id}`}
                        className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                      >
                        {domain?.label ?? p.domain}
                      </Link>
                      <span className="block font-mono text-2xs text-ink-400">{p.key}</span>
                    </td>
                    <td className="td font-mono text-2xs text-ink-500">{p.domain}</td>
                    <td className="td text-xs">{humanise(p.mode)}</td>
                    <td className="td font-mono text-2xs text-ink-500">{p.schedule ?? 'on demand'}</td>
                    <td className="td tabular text-right">{count(stats?._count ?? 0)}</td>
                    <td className="td tabular text-right">
                      {count((stats?._sum.recordsInserted ?? 0) + (stats?._sum.recordsUpdated ?? 0))}
                    </td>
                    <td className="td tabular text-right">
                      {(stats?._sum.recordsRejected ?? 0) > 0 ? (
                        <span className="font-medium text-warn-700 dark:text-warn-500">
                          {count(stats?._sum.recordsRejected ?? 0)}
                        </span>
                      ) : (
                        <span className="text-ink-400">0</span>
                      )}
                    </td>
                    <td className="td whitespace-nowrap text-xs text-ink-500">
                      {stats?._max.startedAt ? relative(stats._max.startedAt) : 'Never'}
                    </td>
                    <td className="td text-xs">
                      {p.enabled ? (
                        <span className="text-positive-600 dark:text-positive-500">Enabled</span>
                      ) : (
                        <span className="text-ink-400">Disabled</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </TableShell>
          )}

          {source.connectionMode !== 'MANUAL_UPLOAD' && (
            <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
              Watermarks:{' '}
              {source.pipelines
                .filter((p) => p.lastWatermark)
                .map((p) => `${p.domain} at ${dateTime(new Date(p.lastWatermark as string))}`)
                .join(' · ') || 'none — this source loads in full each run.'}
            </p>
          )}
        </Card>
      ))}

      <Card>
        <SectionHeader
          title="Connection modes"
          description="What each mode means for latency, load and failure behaviour."
        />
        <TableShell
          head={
            <>
              <th className="th">Mode</th>
              <th className="th">Latency</th>
              <th className="th">Use when</th>
              <th className="th">Fails by</th>
            </>
          }
        >
          {[
            ['CDC stream', 'Seconds to minutes', 'The source has a replica you may read and change volume is high. Lowest latency and lowest load on the source.', 'Going silent. A stopped consumer looks identical to a quiet period, which is why staleness is measured against the schedule.'],
            ['API pull', 'Minutes to hours', 'The source exposes a paginated, filterable API and you can watermark on an updated timestamp.', 'Partial pages, or a watermark that advances past rows that had not yet committed at the source.'],
            ['SFTP file drop', 'Hours', 'The source is a batch system that produces an extract on a schedule.', 'A missing file, or one that is re-dropped under the same name with different content.'],
            ['Manual upload', 'On demand', 'Backfills, corrections, and sources with no connector yet.', 'Human error — which is why every upload validates as a dry run first.'],
            ['Database link', 'Minutes', 'Last resort, when no API or extract exists and the DBA team permits a read-only connection.', 'Schema changes at the source, silently, with no announcement.'],
          ].map(([mode, latency, when, fails]) => (
            <tr key={mode}>
              <td className="td font-medium text-ink-900 dark:text-ink-100">{mode}</td>
              <td className="td whitespace-nowrap text-xs">{latency}</td>
              <td className="td max-w-sm text-xs text-ink-600 dark:text-ink-300">{when}</td>
              <td className="td max-w-sm text-xs text-ink-600 dark:text-ink-300">{fails}</td>
            </tr>
          ))}
        </TableShell>
      </Card>
    </div>
  )
}
