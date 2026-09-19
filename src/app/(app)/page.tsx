import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPrincipal } from '@/lib/auth'
import { can } from '@/lib/rbac'
import {
  getKpis, getFunnel, getCategorySummary, getHospitalComparison,
  getTrend, getWorkQueue, listOpportunities,
} from '@/lib/queries'
import { parseFilters, type SearchParams } from '@/lib/params'
import { money, moneyCompact, count, percent, relative } from '@/lib/format'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell, MiniBar } from '@/components/ui'
import { Funnel } from '@/components/Funnel'
import { OpportunityMiniList } from '@/components/OpportunityTable'
import { TrendLines, Donut, HorizontalBars } from '@/components/client/Charts'
import { evaluateAlerts } from '@/lib/alerts'

export const dynamic = 'force-dynamic'

/**
 * Executive Dashboard — the landing page.
 *
 * Ordered to answer the spec's questions in the order an executive asks them:
 * where are the biggest opportunities, what needs doing today, is the pipeline
 * converting, and which hospital is improving. Alerts sit at the top because
 * they are the only element that can demand attention before the reader has
 * decided what to look at.
 */
export default async function ExecutiveDashboard({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await getPrincipal()
  if (!principal) redirect('/login')

  const params = await searchParams
  const filters = parseFilters(params)
  const groupView = can(principal, 'dashboard.group')

  const [kpis, funnel, categories, hospitals, trend, workQueue, topOpportunities, criticalWork, alerts] =
    await Promise.all([
      getKpis(principal, filters),
      getFunnel(principal, { ...filters, lifecycle: 'all' }),
      getCategorySummary(principal, { ...filters, lifecycle: 'all' }),
      getHospitalComparison(principal, { ...filters, lifecycle: 'all' }),
      getTrend(principal, { ...filters, lifecycle: 'all' }, 12),
      getWorkQueue(principal, filters),
      listOpportunities(principal, { ...filters, lifecycle: 'open' }, { take: 8, sort: 'value' }),
      listOpportunities(
        principal,
        { ...filters, lifecycle: 'open', priority: 'CRITICAL' },
        { take: 6, sort: 'sla' }
      ),
      evaluateAlerts(principal, filters.hospitalId),
    ])

  const totalOpen = kpis.activeOpportunities
  const maxCategoryValue = Math.max(1, ...categories.map((c) => c.potentialValue))

  return (
    <div className="space-y-6">
      <PageHeader
        title={groupView ? 'Group Executive Dashboard' : 'Hospital Command Centre'}
        question="Where are our biggest opportunities today?"
        description={
          groupView
            ? 'Live opportunity pipeline across every hospital in the group, with conversion and recovery performance.'
            : 'Today’s opportunity pipeline for your hospital, with the work your team should pick up first.'
        }
        actions={
          <>
            <Link href="/opportunities?lifecycle=open&sort=score" className="btn btn-secondary">
              Open Opportunity Center
            </Link>
            {can(principal, 'opportunity.act') && (
              <Link href="/queue" className="btn btn-primary">
                My work queue
              </Link>
            )}
          </>
        }
      />

      {alerts.length > 0 && (
        <section aria-label="Executive alerts" className="space-y-2">
          {alerts.slice(0, 4).map((a) => (
            <div
              key={a.id}
              className={
                a.severity === 'CRITICAL'
                  ? 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm dark:border-red-900 dark:bg-critical-dark'
                  : 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn-100 bg-warn-50 px-3 py-2 text-sm dark:border-warn-700 dark:bg-warn-700/15'
              }
            >
              <span
                className={
                  a.severity === 'CRITICAL'
                    ? 'chip border-critical-border bg-white text-critical-text'
                    : 'chip border-warn-100 bg-white text-warn-700'
                }
              >
                {a.severity === 'CRITICAL' ? 'Critical' : 'Watch'}
              </span>
              <span className="font-medium text-ink-900 dark:text-ink-100">{a.message}</span>
              {a.href && (
                <Link href={a.href} className="text-xs font-medium text-brand-700 underline dark:text-brand-300">
                  Investigate
                </Link>
              )}
            </div>
          ))}
        </section>
      )}

      {/* KPI row — section 5. */}
      <section aria-label="Key performance indicators" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total active opportunities"
          value={kpis.activeOpportunities}
          previous={kpis.previous.activeOpportunities}
          goodWhen="down"
          hint="Open, unconverted work across every category in scope."
          href="/opportunities?lifecycle=open"
        />
        <KpiCard
          label="High priority opportunities"
          value={kpis.highPriority}
          previous={kpis.previous.highPriority}
          goodWhen="down"
          accent={kpis.highPriority > 0 ? 'critical' : 'default'}
          hint="Critical and high priority, still open."
          href="/opportunities?lifecycle=open&priority=CRITICAL"
        />
        <KpiCard
          label="Potential revenue"
          value={kpis.potentialValue}
          format="moneyCompact"
          hint="Estimated value of open opportunities if converted."
          href="/revenue"
        />
        <KpiCard
          label="Patients requiring action"
          value={kpis.patientsRequiringAction}
          hint="Distinct patients with at least one open opportunity."
          href="/patients"
        />
        <KpiCard
          label="Insurance recovery potential"
          value={kpis.insuranceRecoveryPotential}
          previous={kpis.previous.insuranceRecoveryPotential}
          format="moneyCompact"
          goodWhen="down"
          hint="Recoverable value on rejected, underpaid and stalled claims."
          href="/insurance"
        />
        <KpiCard
          label="Treatment follow-up opportunities"
          value={kpis.followUpOpportunities}
          hint="Laboratory, appointment and medication gaps awaiting action."
          href="/follow-up"
        />
        <KpiCard
          label="Patient reactivation opportunities"
          value={kpis.reactivationOpportunities}
          hint="Previously active patients who have lapsed."
          href="/reactivation"
        />
        <KpiCard
          label="Conversion rate"
          value={kpis.conversionRate}
          previous={kpis.previous.conversionRate}
          format="percent"
          target={0.35}
          hint="Share of opportunities detected in the last 30 days that converted."
          href="/analytics"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Work queue — section 21. */}
        <Card className="xl:col-span-1">
          <SectionHeader
            title="Today’s priority work"
            description="What should my team do next?"
          />
          {workQueue.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">No open work in scope.</p>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {workQueue.map((g) => (
                <li key={g.category}>
                  <Link
                    href={`/opportunities?category=${g.category}&lifecycle=open&sort=score`}
                    className="flex items-center gap-3 py-2.5 transition-colors hover:bg-brand-50/60 dark:hover:bg-ink-800/60"
                  >
                    <span className="tabular w-10 shrink-0 text-right text-lg font-semibold text-ink-900 dark:text-ink-50">
                      {count(g.count)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                        {g.label}
                      </span>
                      <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                        {g.critical} high priority · oldest {g.oldestDays}d
                        {g.breached > 0 && (
                          <span className="ml-1 font-medium text-danger-600 dark:text-danger-500">
                            · {g.breached} past SLA
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-right text-xs text-ink-500 dark:text-ink-400">
                      {moneyCompact(g.potentialValue)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {kpis.slaBreached > 0 && (
            <Link
              href="/opportunities?sla=breached&lifecycle=open&sort=sla"
              className="mt-3 flex items-center justify-between rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700 transition-colors hover:bg-danger-100 dark:bg-danger-700/15 dark:text-danger-500"
            >
              <span className="font-medium">{count(kpis.slaBreached)} opportunities past SLA</span>
              <span aria-hidden>→</span>
            </Link>
          )}
        </Card>

        {/* Funnel — section 6. */}
        <Card className="xl:col-span-2">
          <SectionHeader
            title="Opportunity conversion funnel"
            description="Eligible patients through to revenue generated. Why are opportunities not converting?"
            action={
              <Link href="/analytics" className="btn btn-ghost text-xs">
                Full analytics
              </Link>
            }
          />
          <Funnel stages={funnel} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionHeader
            title="Opportunity trend"
            description="Detection against conversion over the last 12 weeks."
          />
          <TrendLines
            data={trend.map((t) => ({ period: t.period, detected: t.detected, converted: t.converted }))}
            series={[
              { key: 'detected', name: 'Detected' },
              { key: 'converted', name: 'Converted' },
            ]}
          />
        </Card>

        <Card>
          <SectionHeader title="Opportunity composition" description="Open value by category." />
          <Donut
            data={categories.filter((c) => c.potentialValue > 0).map((c) => ({ label: c.label, value: c.potentialValue }))}
            money
          />
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Opportunity categories"
          description="Open volume, value and conversion performance by type."
        />
        <TableShell
          head={
            <>
              <th className="th">Category</th>
              <th className="th text-right">Open</th>
              <th className="th text-right">High priority</th>
              <th className="th text-right">Potential value</th>
              <th className="th">Share of value</th>
              <th className="th text-right">Converted</th>
              <th className="th text-right">Realised</th>
              <th className="th text-right">Conversion</th>
            </>
          }
        >
          {categories.map((c) => (
            <tr key={c.category} className="row-link">
              <td className="td">
                <Link
                  href={`/opportunities?category=${c.category}&lifecycle=open`}
                  className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                >
                  {c.label}
                </Link>
              </td>
              <td className="td tabular text-right">{count(c.open)}</td>
              <td className="td tabular text-right">
                {c.critical > 0 ? (
                  <span className="font-medium text-critical-text dark:text-red-300">{count(c.critical)}</span>
                ) : (
                  <span className="text-ink-400">0</span>
                )}
              </td>
              <td className="td tabular text-right font-medium">{money(c.potentialValue)}</td>
              <td className="td">
                <MiniBar value={c.potentialValue} max={maxCategoryValue} />
              </td>
              <td className="td tabular text-right">{count(c.converted)}</td>
              <td className="td tabular text-right text-positive-600 dark:text-positive-500">
                {c.realisedValue > 0 ? money(c.realisedValue) : '—'}
              </td>
              <td className="td tabular text-right">{percent(c.conversionRate, 0)}</td>
            </tr>
          ))}
        </TableShell>
      </Card>

      {groupView && hospitals.length > 1 && (
        <Card>
          <SectionHeader
            title="Hospital comparison"
            description="Which hospital is improving, and where is work not being converted?"
            action={
              <Link href="/hospitals" className="btn btn-ghost text-xs">
                Hospital detail
              </Link>
            }
          />
          <TableShell
            head={
              <>
                <th className="th">Hospital</th>
                <th className="th text-right">Patients</th>
                <th className="th text-right">Open</th>
                <th className="th text-right">High priority</th>
                <th className="th text-right">Potential</th>
                <th className="th text-right">Realised</th>
                <th className="th text-right">Conversion</th>
                <th className="th text-right">Past SLA</th>
                <th className="th text-right">Avg age</th>
              </>
            }
          >
            {hospitals.map((h) => (
              <tr key={h.hospitalId} className="row-link">
                <td className="td">
                  <Link
                    href={`/hospitals/${h.hospitalId}`}
                    className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                  >
                    {h.name}
                  </Link>
                  <span className="block text-xs text-ink-500 dark:text-ink-400">{h.city}</span>
                </td>
                <td className="td tabular text-right">{count(h.patients)}</td>
                <td className="td tabular text-right">{count(h.open)}</td>
                <td className="td tabular text-right">{count(h.critical)}</td>
                <td className="td tabular text-right font-medium">{moneyCompact(h.potentialValue)}</td>
                <td className="td tabular text-right text-positive-600 dark:text-positive-500">
                  {h.realisedValue > 0 ? moneyCompact(h.realisedValue) : '—'}
                </td>
                <td className="td tabular text-right">{percent(h.conversionRate, 0)}</td>
                <td className="td tabular text-right">
                  {h.slaBreached > 0 ? (
                    <span className="font-medium text-danger-600 dark:text-danger-500">{count(h.slaBreached)}</span>
                  ) : (
                    <span className="text-ink-400">0</span>
                  )}
                </td>
                <td className="td tabular text-right">{h.avgAgeDays}d</td>
              </tr>
            ))}
          </TableShell>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader
            title="Highest value open opportunities"
            description="Largest single opportunities awaiting action."
          />
          <OpportunityMiniList principal={principal} items={topOpportunities.items} />
        </Card>

        <Card>
          <SectionHeader
            title="Critical priority, nearest SLA"
            description="Clinically urgent work where the response window is closing."
          />
          <OpportunityMiniList
            principal={principal}
            items={criticalWork.items}
            emptyLabel="No critical opportunities outstanding."
          />
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Where the open value sits"
          description={`${count(totalOpen)} open opportunities, ${money(kpis.potentialValue)} of estimated value.`}
        />
        <HorizontalBars
          data={categories.map((c) => ({ label: c.label, value: Math.round(c.potentialValue) }))}
          money
          height={Math.max(180, categories.length * 34)}
        />
        <p className="mt-3 text-xs text-ink-400 dark:text-ink-500">
          Realised in the last 30 days: {money(kpis.realisedValue)} · Pipeline last refreshed{' '}
          {relative(new Date())}.
        </p>
      </Card>
    </div>
  )
}
