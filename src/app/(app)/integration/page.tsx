import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { getPipelineHealth } from '@/lib/ingestion/run'
import { DOMAINS } from '@/lib/ingestion/domains'
import { can } from '@/lib/rbac'
import { count, percent, relative, humanise } from '@/lib/format'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell } from '@/components/ui'
import { IntegrationDiagram } from '@/components/IntegrationDiagram'

export const dynamic = 'force-dynamic'

/**
 * Integration Overview.
 *
 * The page an integrator opens first and a director opens when a number looks
 * wrong. It answers three questions in order: how does data reach the platform,
 * is it arriving right now, and what breaks downstream when it does not.
 *
 * The last of those is the one usually missing from integration tooling. A
 * stale feed is not a technical curiosity — it is a set of clinical rules that
 * have quietly stopped finding anything, and the dependency table below names
 * which.
 */
export default async function IntegrationOverview() {
  const principal = await guard('integration.view')

  const [health, sources, latestQuality, recentRuns, totals] = await Promise.all([
    getPipelineHealth(),
    prisma.sourceSystem.findMany({ orderBy: { name: 'asc' } }),
    prisma.dataQualityResult.findMany({
      orderBy: { evaluatedAt: 'desc' },
      take: 60,
      include: { rule: { select: { key: true, name: true, severity: true, dimension: true } } },
    }),
    prisma.ingestionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 8,
      include: { pipeline: { select: { name: true, domain: true } } },
    }),
    prisma.ingestionRun.aggregate({
      where: { startedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      _sum: { recordsInserted: true, recordsUpdated: true, recordsRejected: true, recordsRead: true },
      _count: true,
    }),
  ])

  const scheduled = health.filter((h) => h.schedule)
  const stale = scheduled.filter((h) => h.isStale)
  const connected = sources.filter((s) => s.status === 'CONNECTED').length
  const degraded = sources.filter((s) => s.status === 'DEGRADED').length

  const read = totals._sum.recordsRead ?? 0
  const rejected = totals._sum.recordsRejected ?? 0

  // One result per rule — the most recent. Older evaluations of the same rule
  // are history, not additional failures.
  const seenRule = new Set<string>()
  const currentQuality = latestQuality.filter((r) => {
    if (seenRule.has(r.ruleId)) return false
    seenRule.add(r.ruleId)
    return true
  })
  const failingQuality = currentQuality.filter((r) => !r.passed)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integration Overview"
        question="How does data reach the platform, and is it arriving?"
        description="Every source system, the route it takes, and what stops working downstream when it stalls."
        actions={
          <>
            <Link href="/integration/pipelines" className="btn btn-secondary">
              Pipelines
            </Link>
            {can(principal, 'integration.ingest') && (
              <Link href="/integration/upload" className="btn btn-primary">
                Upload data
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Sources connected"
          value={connected}
          hint={`${sources.length} configured${degraded > 0 ? `, ${degraded} degraded` : ''}.`}
          accent={degraded > 0 ? 'critical' : 'default'}
        />
        <KpiCard
          label="Records loaded (7 days)"
          value={(totals._sum.recordsInserted ?? 0) + (totals._sum.recordsUpdated ?? 0)}
          hint={`Across ${count(totals._count)} runs.`}
        />
        <KpiCard
          label="Reject rate (7 days)"
          value={read > 0 ? rejected / read : 0}
          format="percent"
          goodWhen="down"
          accent={read > 0 && rejected / read > 0.05 ? 'critical' : 'default'}
          hint={`${count(rejected)} rows rejected of ${count(read)} read.`}
        />
        <KpiCard
          label="Stale pipelines"
          value={stale.length}
          goodWhen="down"
          accent={stale.length > 0 ? 'critical' : 'default'}
          hint="Scheduled feeds that have missed three or more cycles."
        />
      </div>

      {(stale.length > 0 || failingQuality.length > 0) && (
        <section aria-label="Integration alerts" className="space-y-2">
          {stale.map((h) => (
            <div
              key={h.pipelineId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn-100 bg-warn-50 px-3 py-2 text-sm dark:border-warn-700 dark:bg-warn-700/15"
            >
              <span className="chip border-warn-100 bg-white text-warn-700">Stale</span>
              <span className="font-medium text-ink-900 dark:text-ink-100">
                {h.name} last ran {relative(h.lastRunAt)}
              </span>
              <span className="text-ink-600 dark:text-ink-300">
                Expected every {h.slaMinutes} minutes.
              </span>
              <Link href="/integration/pipelines" className="text-xs font-medium text-brand-700 underline dark:text-brand-300">
                Investigate
              </Link>
            </div>
          ))}
          {failingQuality
            .filter((r) => r.rule.severity === 'CRITICAL')
            .slice(0, 4)
            .map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm dark:border-red-900 dark:bg-critical-dark"
              >
                <span className="chip border-critical-border bg-white text-critical-text">Quality</span>
                <span className="font-medium text-ink-900 dark:text-ink-100">{r.rule.name}</span>
                <span className="tabular text-ink-600 dark:text-ink-300">
                  {percent(r.measuredValue, 0)} against a {percent(r.threshold, 0)} threshold
                </span>
                <Link href="/integration/quality" className="text-xs font-medium text-brand-700 underline dark:text-brand-300">
                  Details
                </Link>
              </div>
            ))}
        </section>
      )}

      <Card>
        <SectionHeader
          title="Architecture"
          description="Source systems through transport and ingestion into the platform, and out to everything that reads it."
        />
        <IntegrationDiagram />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Source systems"
            description="What each system provides and how it delivers."
            action={
              <Link href="/integration/sources" className="btn btn-ghost text-xs">
                Connection detail
              </Link>
            }
          />
          <TableShell
            head={
              <>
                <th className="th">System</th>
                <th className="th">Mode</th>
                <th className="th">Owner</th>
                <th className="th">Last contact</th>
                <th className="th">Status</th>
              </>
            }
          >
            {sources.map((s) => (
              <tr key={s.id} className="row-link">
                <td className="td">
                  <Link href="/integration/sources" className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100">
                    {s.name}
                  </Link>
                  <span className="block font-mono text-2xs text-ink-400">{s.code}</span>
                </td>
                <td className="td text-xs">{humanise(s.connectionMode)}</td>
                <td className="td text-xs">{s.ownerTeam}</td>
                <td className="td whitespace-nowrap text-xs text-ink-500">{relative(s.lastContactAt)}</td>
                <td className="td">
                  <StatusChip status={s.status} />
                </td>
              </tr>
            ))}
          </TableShell>
        </Card>

        <Card>
          <SectionHeader
            title="Recent runs"
            description="The last few loads across every pipeline."
            action={
              <Link href="/integration/pipelines" className="btn btn-ghost text-xs">
                Full history
              </Link>
            }
          />
          <TableShell
            head={
              <>
                <th className="th">Pipeline</th>
                <th className="th">Started</th>
                <th className="th text-right">Loaded</th>
                <th className="th text-right">Rejected</th>
                <th className="th">Status</th>
              </>
            }
          >
            {recentRuns.map((r) => (
              <tr key={r.id}>
                <td className="td">
                  <span className="block max-w-[200px] truncate text-sm">{r.pipeline.name}</span>
                </td>
                <td className="td whitespace-nowrap text-xs text-ink-500">{relative(r.startedAt)}</td>
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
      </div>

      {/*
        The dependency table. This is the part that makes the integration screen
        useful to someone who is not an integrator: it names, per feed, which
        product capability stops working when the feed does.
      */}
      <Card>
        <SectionHeader
          title="What depends on each feed"
          description="When a feed stalls or arrives incomplete, these are the capabilities that stop producing. Read this before deprioritising an integration."
        />
        <TableShell
          head={
            <>
              <th className="th">Feed</th>
              <th className="th">Lands in</th>
              <th className="th">Natural key</th>
              <th className="th">Depends on it</th>
            </>
          }
        >
          {DOMAINS.map((d) => (
            <tr key={d.key}>
              <td className="td">
                <Link
                  href={`/integration/mapping?domain=${d.key}`}
                  className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                >
                  {d.label}
                </Link>
                <span className="block font-mono text-2xs text-ink-400">{d.key}</span>
              </td>
              <td className="td font-mono text-2xs text-ink-500">{d.targetEntity}</td>
              <td className="td font-mono text-2xs text-ink-500">{d.naturalKey.join(' + ')}</td>
              <td className="td">
                <span className="block max-w-xl text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                  {DEPENDENCIES[d.key]}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader
          title="How to connect a new source"
          description="The route from a system nobody has integrated to opportunities in the pipeline."
        />
        <ol className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
          {[
            ['Pick the domain', 'Decide which feed the data belongs to. Field Mapping lists the fields each accepts, which are required, and how references resolve. If none fits, the domain contract needs extending first — that is a code change, not configuration.'],
            ['Get a sample out', 'Export a few hundred rows as CSV with the column names from the mapping screen. Download the template to start from a correct header row.'],
            ['Dry run it', 'Upload with validation only. Nothing is written. You get the exact row, field and value behind every rejection, and a count of what would insert against what would update.'],
            ['Fix and repeat', 'Most first attempts fail on dates and unresolved references. Both are deliberate: ambiguous dates are rejected rather than guessed, and unknown codes are rejected rather than turned into placeholder records.'],
            ['Commit', 'Run it for real. Loads are idempotent on the natural key, so re-sending the same file updates rather than duplicates.'],
            ['Check quality', 'A clean load is not the same as usable data. Data Quality tells you whether the fields the rules actually depend on are populated.'],
            ['Automate', 'Once the shape is proven, hand the mapping to the integration team to build the connector. The contract does not change between a manual upload and an automated feed.'],
          ].map(([title, detail], i) => (
            <li key={title} className="flex gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-2xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
                {i + 1}
              </span>
              <span>
                <strong className="font-medium text-ink-900 dark:text-ink-100">{title}.</strong> {detail}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
          The full written procedure, including file formats, transforms, scheduling and
          troubleshooting, is in <span className="font-mono">docs/INGESTION-MANUAL.md</span>.
        </p>
      </Card>
    </div>
  )
}

/** What breaks when a feed stops. Written for a reader who is not an integrator. */
const DEPENDENCIES: Record<string, string> = {
  PATIENT:
    'Everything. Every clinical feed resolves its patient by MRN, so a stalled patient feed rejects new clinical rows outright. Consent and contactability also gate all outreach.',
  ENCOUNTER:
    'Follow-up interval rule, reactivation across all four rules, chronic-therapy review, lifetime value, and the "no encounter since" test that most clinical rules depend on.',
  LAB_RESULT:
    'All five laboratory rules — abnormal without follow-up, critical unactioned, ordered never resulted, lapsed monitoring, and results never reviewed. Also the monitoring check on high-risk medication.',
  APPOINTMENT:
    'No-show, repeated cancellation and unreconciled booking rules; the cancellation component of service-line analysis; and patient engagement scoring, which uses show rate.',
  CLAIM:
    'The entire Insurance Recovery module: recoverable rejections, repeat rejection patterns, underpayments, stalled claims and financial counselling.',
  PHARMACY:
    'Refill overdue, refill abandonment and incomplete course. Also the evidence that a monitored medication is actually still being taken.',
  SURGERY:
    'All four surgical rules and post-surgical reactivation. Surgical cases carry the largest single financial values in the pipeline.',
  REFERRAL:
    'Referral never booked, expired referral and leakage — plus the leakage component of service-line growth.',
  DIAGNOSIS:
    'The chronic flag, which gates lapsed-chronic reactivation and the clinical-context test on recurring lab monitoring.',
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'CONNECTED'
      ? 'border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
      : status === 'DEGRADED'
        ? 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
        : status === 'DISCONNECTED'
          ? 'border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
          : 'border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800'
  return <span className={`chip ${tone}`}>{humanise(status)}</span>
}

function RunStatusChip({ status }: { status: string }) {
  const tone =
    status === 'SUCCEEDED'
      ? 'border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
      : status === 'PARTIAL'
        ? 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
        : status === 'FAILED'
          ? 'border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
          : 'border-ink-200 bg-white text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
  return <span className={`chip ${tone}`}>{humanise(status)}</span>
}

export { StatusChip, RunStatusChip }
