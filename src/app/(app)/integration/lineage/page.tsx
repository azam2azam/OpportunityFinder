import Link from 'next/link'
import clsx from 'clsx'
import { guard } from '@/lib/guard'
import { getFeedStatus } from '@/lib/ingestion/status'
import { DOMAINS } from '@/lib/ingestion/domains'
import { LINEAGE, isPlatformOnly, feedLabel, pagesForFeed, PLATFORM_ONLY } from '@/lib/lineage'
import { count, relative, humanise } from '@/lib/format'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * The lineage map: which source application feeds which page, both directions.
 *
 * Two questions, and they are asked by different people at different moments.
 * An integrator about to take a connector down asks *what will this break*.
 * A director looking at a figure that seems wrong asks *where did this come
 * from*. The matrix answers both without either of them having to ask a person.
 */
export default async function LineageMap() {
  await guard('integration.view')

  const feedStatus = await getFeedStatus()

  const dataPages = LINEAGE.filter((l) => !isPlatformOnly(l))
  const platformPages = LINEAGE.filter(isPlatformOnly)

  const feeds = DOMAINS.map((d) => {
    const status = feedStatus[d.key]
    const pages = pagesForFeed(d.key)
    return { domain: d, status, pages }
  }).sort((a, b) => b.pages.length - a.pages.length)

  // Source applications, since several feeds usually come from one system and
  // that is the unit people actually think and plan in.
  const bySource = new Map<string, { name: string; mode: string; feeds: string[]; pages: Set<string>; worst: string }>()
  for (const { domain, status, pages } of feeds) {
    if (!status) continue
    const entry = bySource.get(status.sourceCode) ?? {
      name: status.sourceName,
      mode: status.connectionMode,
      feeds: [],
      pages: new Set<string>(),
      worst: 'OK',
    }
    entry.feeds.push(domain.key)
    for (const p of pages) entry.pages.add(p.route)
    const rank = { OK: 0, DEGRADED: 1, STALE: 2, NEVER: 3 } as Record<string, number>
    if ((rank[status.state] ?? 0) > (rank[entry.worst] ?? 0)) entry.worst = status.state
    bySource.set(status.sourceCode, entry)
  }

  const impaired = [...bySource.values()].filter((s) => s.worst !== 'OK')
  const affectedPages = new Set(impaired.flatMap((s) => [...s.pages]))
  const maxReach = Math.max(1, ...feeds.map((f) => f.pages.length))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lineage Map"
        question="Which source application feeds which page — and what breaks if one stops?"
        description="The connection between the external systems and every screen in this platform, in both directions."
        actions={
          <Link href="/integration" className="btn btn-secondary">
            Integration overview
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Source applications" value={bySource.size} />
        <KpiCard label="Feeds" value={DOMAINS.length} />
        <KpiCard
          label="Pages reading fed data"
          value={dataPages.length}
          hint={`${platformPages.length} more read platform configuration only.`}
        />
        <KpiCard
          label="Pages currently affected"
          value={affectedPages.size}
          goodWhen="down"
          accent={affectedPages.size > 0 ? 'critical' : 'default'}
          hint="Reading from a feed that is stale, degraded or failing quality."
        />
      </div>

      {impaired.length > 0 && (
        <section aria-label="Impaired sources" className="space-y-2">
          {impaired.map((s) => (
            <div
              key={s.name}
              className="rounded-lg border border-warn-100 bg-warn-50 px-4 py-3 dark:border-warn-700 dark:bg-warn-700/15"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="chip border-warn-100 bg-white text-warn-700">{humanise(s.worst)}</span>
                <span className="font-medium text-ink-900 dark:text-ink-100">{s.name}</span>
                <span className="text-sm text-ink-600 dark:text-ink-300">
                  affects {s.pages.size} page{s.pages.size === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {[...s.pages].map((route) => {
                  const page = LINEAGE.find((l) => l.route === route)
                  return (
                    <Link
                      key={route}
                      href={route}
                      className="chip border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
                    >
                      {page?.label ?? route}
                    </Link>
                  )
                })}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* Application → pages. The integrator's direction. */}
      <Card>
        <SectionHeader
          title="Source application → pages"
          description="What each external system reaches. Read this before taking a connector down for maintenance."
        />
        <TableShell
          head={
            <>
              <th className="th">Source application</th>
              <th className="th">Transport</th>
              <th className="th">Feeds</th>
              <th className="th text-right">Pages reached</th>
              <th className="th">Which pages</th>
              <th className="th">State</th>
            </>
          }
        >
          {[...bySource.entries()].map(([code, s]) => (
            <tr key={code}>
              <td className="td">
                <Link href="/integration/sources" className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100">
                  {s.name}
                </Link>
                <span className="block font-mono text-2xs text-ink-400">{code}</span>
              </td>
              <td className="td text-xs">{humanise(s.mode)}</td>
              <td className="td">
                <span className="flex max-w-[220px] flex-wrap gap-1">
                  {s.feeds.map((f) => (
                    <span
                      key={f}
                      className="chip border-ink-200 bg-ink-50 text-2xs text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300"
                    >
                      {feedLabel(f)}
                    </span>
                  ))}
                </span>
              </td>
              <td className="td tabular text-right font-medium">{count(s.pages.size)}</td>
              <td className="td">
                <span className="flex max-w-md flex-wrap gap-1">
                  {[...s.pages].map((route) => {
                    const page = LINEAGE.find((l) => l.route === route)
                    return (
                      <Link
                        key={route}
                        href={route}
                        className="chip border-ink-200 bg-white text-2xs text-ink-600 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
                      >
                        {page?.label ?? route}
                      </Link>
                    )
                  })}
                </span>
              </td>
              <td className="td">
                <span
                  className={clsx(
                    'chip',
                    s.worst === 'OK'
                      ? 'border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
                      : s.worst === 'DEGRADED'
                        ? 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                        : 'border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
                  )}
                >
                  {s.worst === 'OK' ? 'Current' : humanise(s.worst)}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </Card>

      {/* Feed → pages, with reach. */}
      <Card>
        <SectionHeader
          title="Feed reach"
          description="How far each feed travels. The ones at the top are where a source-side change costs the most."
        />
        <TableShell
          head={
            <>
              <th className="th">Feed</th>
              <th className="th">Source</th>
              <th className="th text-right">Pages</th>
              <th className="th">Reach</th>
              <th className="th">Last load</th>
              <th className="th">State</th>
            </>
          }
        >
          {feeds.map(({ domain, status, pages }) => (
            <tr key={domain.key}>
              <td className="td">
                <Link
                  href={`/integration/mapping?domain=${domain.key}`}
                  className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                >
                  {domain.label}
                </Link>
                <span className="block font-mono text-2xs text-ink-400">{domain.targetEntity}</span>
              </td>
              <td className="td text-xs">{status?.sourceName ?? 'Manual upload only'}</td>
              <td className="td tabular text-right font-medium">{count(pages.length)}</td>
              <td className="td">
                <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-ink-200 align-middle dark:bg-ink-700">
                  <span
                    className="block h-full rounded-full bg-brand-500"
                    style={{ width: `${(pages.length / maxReach) * 100}%` }}
                  />
                </span>
              </td>
              <td className="td whitespace-nowrap text-xs text-ink-500">
                {status?.lastRunAt ? relative(status.lastRunAt) : '—'}
              </td>
              <td className="td">
                {status ? (
                  <span
                    className={clsx(
                      'chip',
                      status.state === 'OK'
                        ? 'border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
                        : status.state === 'DEGRADED'
                          ? 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                          : 'border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
                    )}
                  >
                    {status.state === 'OK' ? 'Current' : humanise(status.state)}
                  </span>
                ) : (
                  <span className="chip border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800">
                    No connector
                  </span>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      </Card>

      {/* Page → feeds. The director's direction. */}
      <Card>
        <SectionHeader
          title="Page → source"
          description="Where each screen gets its numbers, and what it would get wrong without them. This is the same information the provenance bar shows at the top of every page."
        />
        <TableShell
          head={
            <>
              <th className="th">Page</th>
              <th className="th">Reads from</th>
              <th className="th">Derived by</th>
              <th className="th">If a feed stalls</th>
            </>
          }
        >
          {LINEAGE.map((entry) => (
            <tr key={entry.route}>
              <td className="td">
                <Link href={entry.route} className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100">
                  {entry.label}
                </Link>
                <span className="block font-mono text-2xs text-ink-400">{entry.route}</span>
              </td>
              <td className="td">
                <span className="flex max-w-xs flex-wrap gap-1">
                  {entry.feeds.map((f) => {
                    const status = f === PLATFORM_ONLY ? null : feedStatus[f]
                    return (
                      <span
                        key={f}
                        className={clsx(
                          'chip text-2xs',
                          f === PLATFORM_ONLY
                            ? 'border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800'
                            : !status || status.state === 'OK'
                              ? 'border-ink-200 bg-ink-50 text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300'
                              : 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                        )}
                      >
                        {feedLabel(f)}
                      </span>
                    )
                  })}
                </span>
              </td>
              <td className="td max-w-[200px] text-2xs text-ink-500">
                {entry.derivedBy?.join(' → ') ?? '—'}
              </td>
              <td className="td max-w-lg text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                {entry.impact}
              </td>
            </tr>
          ))}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader
          title="Why this exists"
          description="The failure this map is here to prevent."
        />
        <div className="space-y-3 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
          <p>
            A chart renders identically whether the feed behind it is current or three days stale.
            That is the most dangerous property a platform like this has: the reader cannot tell,
            and nothing on the page suggests there is anything to check.
          </p>
          <p>
            So every page carries a provenance bar naming the source applications behind it, and it
            asserts itself when one of those feeds is in trouble. A director reading a conversion
            figure sees that it depends on a pharmacy feed that stopped, without having to know that
            a pharmacy feed exists.
          </p>
          <p>
            The same map read the other way is what an integrator needs before taking a connector
            down: not &ldquo;which tables does this write&rdquo; but{' '}
            <em>which screens will show the wrong number tomorrow morning</em>.
          </p>
        </div>
      </Card>
    </div>
  )
}
