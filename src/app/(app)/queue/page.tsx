import Link from 'next/link'
import { guard } from '@/lib/guard'
import { listOpportunities, getWorkQueue } from '@/lib/queries'
import { parseFilters, type SearchParams } from '@/lib/params'
import { count, moneyCompact, relative } from '@/lib/format'
import { PageHeader, Card, SectionHeader, KpiCard, EmptyState } from '@/components/ui'
import { OpportunityTable } from '@/components/OpportunityTable'

export const dynamic = 'force-dynamic'

/**
 * My Work Queue (spec section 21).
 *
 * The operator's home screen, and the only page in the product organised around
 * a person rather than the pipeline. Three bands, in priority order: work
 * already assigned to you and overdue, work assigned to you, and unclaimed work
 * you could pick up. That ordering is the answer to "what should I do next" —
 * finishing something you already own beats starting something new.
 */
export default async function WorkQueue({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('opportunity.act')
  const params = await searchParams
  const filters = parseFilters(params, { lifecycle: 'open' })

  const [overdue, mine, unclaimed, groups] = await Promise.all([
    listOpportunities(
      principal,
      { ...filters, owner: 'me', slaBreached: true },
      { take: 25, sort: 'sla' }
    ),
    listOpportunities(principal, { ...filters, owner: 'me' }, { take: 40, sort: 'score' }),
    listOpportunities(principal, { ...filters, owner: 'unassigned' }, { take: 25, sort: 'score' }),
    getWorkQueue(principal, filters),
  ])

  const totalWork = groups.reduce((s, g) => s + g.count, 0)
  const totalCritical = groups.reduce((s, g) => s + g.critical, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Work Queue"
        question="What should I do next?"
        description={`${principal.name} · ${principal.roleName}. Work you own comes first; unclaimed work is below.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Assigned to you"
          value={mine.total}
          hint="Open opportunities you own."
        />
        <KpiCard
          label="Overdue"
          value={overdue.total}
          goodWhen="down"
          accent={overdue.total > 0 ? 'critical' : 'default'}
          hint="Yours, past the service-level target."
        />
        <KpiCard
          label="Unclaimed in your scope"
          value={unclaimed.total}
          hint="Open opportunities with no owner."
        />
        <KpiCard
          label="High priority in scope"
          value={totalCritical}
          hint={`Across ${count(totalWork)} open opportunities.`}
        />
      </div>

      {/* Today's priority work, as the spec words it. */}
      <Card>
        <SectionHeader
          title="Today’s priority work"
          description="Open work in your scope, grouped by what kind of problem it is."
        />
        {groups.length === 0 ? (
          <EmptyState title="Nothing outstanding in your scope" />
        ) : (
          <ol className="divide-y divide-ink-100 dark:divide-ink-800">
            {groups.map((g, i) => (
              <li key={g.category}>
                <Link
                  href={`/opportunities?category=${g.category}&lifecycle=open&sort=score`}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:bg-brand-50/60 dark:hover:bg-ink-800/60"
                >
                  <span className="w-4 shrink-0 text-right text-xs text-ink-400">{i + 1}</span>
                  <span className="tabular w-12 shrink-0 text-right text-lg font-semibold text-ink-900 dark:text-ink-50">
                    {count(g.count)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                      {g.label}
                    </span>
                    <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                      {g.critical} high priority · oldest {g.oldestDays} days
                      {g.breached > 0 && (
                        <span className="ml-1 font-medium text-danger-600 dark:text-danger-500">
                          · {g.breached} past SLA
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-ink-500 dark:text-ink-400">
                    {moneyCompact(g.potentialValue)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {overdue.items.length > 0 && (
        <Card>
          <SectionHeader
            title="Overdue — yours"
            description="Past the service-level target and still open. Clear these first."
          />
          <OpportunityTable
            principal={principal}
            items={overdue.items}
            columns={['priority', 'title', 'patient', 'category', 'value', 'sla', 'action']}
          />
        </Card>
      )}

      <Card>
        <SectionHeader
          title="Assigned to you"
          description="Everything you own, ranked by score."
        />
        <OpportunityTable
          principal={principal}
          items={mine.items}
          columns={['priority', 'title', 'patient', 'category', 'value', 'score', 'status', 'sla']}
          emptyTitle="Nothing assigned to you"
          emptyDescription="Claim an opportunity from the unclaimed list below to start working it."
        />
      </Card>

      <Card>
        <SectionHeader
          title="Unclaimed"
          description="Open work in your scope with no owner. Opening one and logging an action claims it."
          action={
            <Link href="/opportunities?owner=unassigned&lifecycle=open&sort=score" className="btn btn-ghost text-xs">
              See all unclaimed
            </Link>
          }
        />
        <OpportunityTable
          principal={principal}
          items={unclaimed.items}
          columns={['priority', 'title', 'patient', 'category', 'hospital', 'value', 'score', 'sla']}
          emptyTitle="No unclaimed work"
          emptyDescription="Everything open in your scope already has an owner."
        />
      </Card>

      <p className="text-xs text-ink-400 dark:text-ink-500">
        Queue reflects the pipeline as of {relative(new Date())}. Detection runs refresh scores and
        priorities without disturbing assignment or action history.
      </p>
    </div>
  )
}
