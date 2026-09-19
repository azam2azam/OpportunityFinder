import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { can } from '@/lib/rbac'
import { money, count, percent, shortDate, humanise } from '@/lib/format'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell, MiniBar, EmptyState } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * Campaigns (spec section 22).
 *
 * A campaign is a cohort plus a message plus an approval. The approval matters:
 * a platform that can message thousands of patients about their health without
 * a named human signing off is a liability, so an unapproved campaign cannot
 * launch and the approver is recorded on the record.
 */
export default async function Campaigns() {
  const principal = await guard('campaign.view')

  const campaigns = await prisma.campaign.findMany({
    where: principal.scopeLevel === 'GROUP' ? {} : { hospitalId: { in: principal.hospitalIds } },
    include: {
      hospital: { select: { id: true, name: true } },
      createdBy: { select: { name: true, title: true } },
      members: { select: { status: true, revenue: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const rows = campaigns.map((c) => {
    const members = c.members
    const stage = (s: string) => members.filter((m) => m.status === s).length
    // Funnel stages are cumulative: someone who converted was also contacted.
    // Counting only the current status would show a funnel that widens.
    const eligible = members.length
    const converted = stage('CONVERTED')
    const visited = converted + stage('VISITED')
    const booked = visited + stage('BOOKED')
    const responded = booked + stage('RESPONDED')
    const contacted = responded + stage('CONTACTED')
    return {
      ...c,
      eligible,
      contacted,
      responded,
      booked,
      visited,
      converted,
      optedOut: stage('OPTED_OUT'),
      revenue: members.reduce((s, m) => s + m.revenue, 0),
      conversionRate: eligible > 0 ? converted / eligible : 0,
      responseRate: contacted > 0 ? responded / contacted : 0,
      channels: safeChannels(c.channels),
      criteria: safeCriteria(c.criteria),
    }
  })

  const totals = rows.reduce(
    (acc, r) => ({
      eligible: acc.eligible + r.eligible,
      converted: acc.converted + r.converted,
      revenue: acc.revenue + r.revenue,
    }),
    { eligible: 0, converted: 0, revenue: 0 }
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns & Actions"
        question="Which outreach is working, and what did it return?"
        description="Targeted cohorts built from the opportunity pipeline, with their funnel from eligible through to converted revenue."
        actions={
          can(principal, 'campaign.create') ? (
            <button className="btn btn-primary" disabled title="Campaign creation is available to authorised users from the Administration module.">
              New campaign
            </button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Campaigns" value={rows.length} />
        <KpiCard label="Patients in cohorts" value={totals.eligible} />
        <KpiCard label="Converted" value={totals.converted} />
        <KpiCard label="Attributed revenue" value={totals.revenue} format="moneyCompact" />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No campaigns yet"
            description="Campaigns are built from an opportunity cohort — filter the Opportunity Center to the group you want to reach, then create a campaign from it."
          />
        </Card>
      ) : (
        rows.map((c) => (
          <Card key={c.id}>
            <SectionHeader
              title={c.name}
              description={c.description}
              action={
                <span
                  className={
                    c.status === 'RUNNING'
                      ? 'chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
                      : c.status === 'COMPLETED'
                        ? 'chip border-ink-200 bg-ink-100 text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300'
                        : 'chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                  }
                >
                  {humanise(c.status)}
                </span>
              }
            />

            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
              <span>{c.hospital?.name ?? 'Group-wide'}</span>
              <span>
                {c.startsAt ? shortDate(c.startsAt) : 'Not started'}
                {c.endsAt ? ` – ${shortDate(c.endsAt)}` : ''}
              </span>
              <span>Channels: {c.channels.join(', ') || '—'}</span>
              <span>Created by {c.createdBy.name}</span>
              {c.approvedAt ? (
                <span className="font-medium text-positive-600 dark:text-positive-500">
                  Approved {shortDate(c.approvedAt)}
                </span>
              ) : (
                <span className="font-medium text-warn-700 dark:text-warn-500">
                  Awaiting approval — cannot launch
                </span>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="label mb-2">Campaign funnel</p>
                <ol className="space-y-1.5">
                  {[
                    { label: 'Eligible', value: c.eligible },
                    { label: 'Contacted', value: c.contacted },
                    { label: 'Responded', value: c.responded },
                    { label: 'Appointment booked', value: c.booked },
                    { label: 'Visited', value: c.visited },
                    { label: 'Converted', value: c.converted },
                  ].map((s, i, arr) => {
                    const prev = i === 0 ? s.value : arr[i - 1].value
                    return (
                      <li key={s.label}>
                        <div className="mb-0.5 flex items-baseline justify-between text-xs">
                          <span className="text-ink-600 dark:text-ink-300">{s.label}</span>
                          <span className="flex items-baseline gap-2">
                            {i > 0 && (
                              <span className="tabular text-ink-400">
                                {prev > 0 ? percent(s.value / prev, 0) : '—'} of previous
                              </span>
                            )}
                            <span className="tabular font-medium text-ink-900 dark:text-ink-100">
                              {count(s.value)}
                            </span>
                          </span>
                        </div>
                        <div className="h-4 overflow-hidden rounded bg-ink-100 dark:bg-ink-800">
                          <div
                            className={i === arr.length - 1 ? 'h-full bg-positive-500' : 'h-full bg-brand-500'}
                            style={{
                              width: `${c.eligible > 0 ? Math.max(1.5, (s.value / c.eligible) * 100) : 0}%`,
                            }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="label mb-1.5">Cohort criteria</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md bg-ink-50 p-3 text-sm dark:bg-ink-800/60">
                    {Object.entries(c.criteria).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-xs text-ink-500 dark:text-ink-400">
                          {humanise(k.replace(/([A-Z])/g, ' $1'))}
                        </dt>
                        <dd className="text-xs font-medium text-ink-900 dark:text-ink-100">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div>
                  <p className="label mb-1.5">Message template</p>
                  <p className="rounded-md border border-ink-200 bg-white p-3 text-sm italic leading-relaxed text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
                    {c.messageTemplate || 'No template set.'}
                  </p>
                  <p className="mt-1.5 text-2xs text-ink-400">
                    Copy is reviewed before launch. The platform never generates clinical advice to a
                    patient — outreach invites contact, it does not deliver findings.
                  </p>
                </div>

                <dl className="grid grid-cols-3 gap-3">
                  <div>
                    <dt className="label">Response rate</dt>
                    <dd className="tabular mt-0.5 text-lg font-semibold text-ink-900 dark:text-ink-50">
                      {percent(c.responseRate, 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Conversion</dt>
                    <dd className="tabular mt-0.5 text-lg font-semibold text-ink-900 dark:text-ink-50">
                      {percent(c.conversionRate, 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Revenue</dt>
                    <dd className="tabular mt-0.5 text-lg font-semibold text-positive-600 dark:text-positive-500">
                      {money(c.revenue)}
                    </dd>
                  </div>
                </dl>

                {c.optedOut > 0 && (
                  <p className="text-xs text-warn-700 dark:text-warn-500">
                    {count(c.optedOut)} patients opted out during this campaign and have been excluded
                    from future outreach.
                  </p>
                )}
              </div>
            </div>
          </Card>
        ))
      )}

      {rows.length > 0 && (
        <Card>
          <SectionHeader title="Campaign comparison" description="Side by side, by return." />
          <TableShell
            head={
              <>
                <th className="th">Campaign</th>
                <th className="th">Status</th>
                <th className="th text-right">Eligible</th>
                <th className="th text-right">Contacted</th>
                <th className="th text-right">Converted</th>
                <th className="th">Conversion</th>
                <th className="th text-right">Revenue</th>
              </>
            }
          >
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="td font-medium text-ink-900 dark:text-ink-100">{c.name}</td>
                <td className="td text-xs">{humanise(c.status)}</td>
                <td className="td tabular text-right">{count(c.eligible)}</td>
                <td className="td tabular text-right">{count(c.contacted)}</td>
                <td className="td tabular text-right">{count(c.converted)}</td>
                <td className="td">
                  <MiniBar value={c.converted} max={Math.max(1, c.eligible)} tone="positive" />
                </td>
                <td className="td tabular text-right font-medium">{money(c.revenue)}</td>
              </tr>
            ))}
          </TableShell>
        </Card>
      )}
    </div>
  )
}

function safeChannels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function safeCriteria(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
