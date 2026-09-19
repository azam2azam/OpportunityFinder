import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { can } from '@/lib/rbac'
import { scopeWhere } from '@/lib/queries'
import { RULE_BY_KEY } from '@/lib/detection/rules'
import { count, percent, money, dateTime, humanise } from '@/lib/format'
import { CATEGORY_LABEL } from '@/lib/enums'
import {
  PageHeader, Card, SectionHeader, KpiCard, CategoryBadge, TableShell, EmptyState,
} from '@/components/ui'
import { OpportunityMiniList } from '@/components/OpportunityTable'
import { RuleEditor } from '@/components/client/RuleEditor'
import { listOpportunities } from '@/lib/queries'

export const dynamic = 'force-dynamic'

/**
 * A single rule: what it looks for, how it is configured, and what it has
 * actually produced.
 *
 * The parameter editor sits next to the yield deliberately. Tuning a threshold
 * without seeing its effect is guesswork, and the pairing is what turns the
 * configurable scoring model from a claim in a spec into something an
 * administrator can actually operate.
 */
export default async function RuleDetail({ params }: { params: Promise<{ id: string }> }) {
  const principal = await guard('rules.view')
  const { id } = await params

  const rule = await prisma.opportunityRule.findUnique({ where: { id } })
  if (!rule) notFound()

  const definition = RULE_BY_KEY[rule.key]

  const [stats, samples, recentDismissed] = await Promise.all([
    prisma.opportunity.groupBy({
      by: ['status'],
      where: { AND: [scopeWhere(principal, {}), { ruleId: rule.id }] },
      _count: true,
      _sum: { potentialValue: true, realisedValue: true },
    }),
    listOpportunities(principal, {}, { take: 8, sort: 'score' }).then(async () => {
      const rows = await prisma.opportunity.findMany({
        where: { AND: [scopeWhere(principal, {}), { ruleId: rule.id }] },
        orderBy: { score: 'desc' },
        take: 8,
        select: {
          id: true, reference: true, title: true, category: true, priority: true,
          status: true, score: true, potentialValue: true, realisedValue: true,
          detectedAt: true, slaDueAt: true, lastActionAt: true, nextActionAt: true,
          ownerTeam: true, recommendedAction: true, confidence: true,
          hospital: { select: { id: true, name: true, code: true } },
          specialty: { select: { id: true, name: true, line: true } },
          department: { select: { id: true, name: true } },
          physician: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          patient: {
            select: {
              id: true, mrn: true, firstName: true, lastName: true, phone: true,
              email: true, nationalIdMasked: true, dateOfBirth: true, gender: true,
              preferredChannel: true, contactable: true,
            },
          },
        },
      })
      return rows
    }),
    prisma.opportunityAction.findMany({
      where: {
        type: 'CLOSE',
        opportunity: { AND: [scopeWhere(principal, {}), { ruleId: rule.id }] },
      },
      orderBy: { performedAt: 'desc' },
      take: 6,
      select: { id: true, note: true, performedAt: true, toStatus: true },
    }),
  ])

  const total = stats.reduce((s, x) => s + x._count, 0)
  const converted = stats.filter((s) => s.status === 'CONVERTED').reduce((s, x) => s + x._count, 0)
  const dismissed = stats
    .filter((s) => s.status === 'REJECTED' || s.status === 'NOT_APPLICABLE')
    .reduce((s, x) => s + x._count, 0)
  const open = total - converted - dismissed
  const realised = stats.reduce((s, x) => s + (x._sum.realisedValue ?? 0), 0)

  const storedParams = safeParams(rule.params)
  const paramRows = Object.entries({ ...(definition?.defaultParams ?? {}), ...storedParams }).map(
    ([key, value]) => ({
      key,
      value,
      doc: definition?.paramDocs[key] ?? 'No documentation recorded for this parameter.',
      isDefault: JSON.stringify(definition?.defaultParams[key]) === JSON.stringify(value),
    })
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title={rule.name}
        description={rule.description}
        actions={
          <Link href="/rules" className="btn btn-secondary">
            All rules
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <CategoryBadge
          category={rule.category}
          label={CATEGORY_LABEL[rule.category as keyof typeof CATEGORY_LABEL]}
        />
        <span className="chip border-ink-200 bg-white font-mono text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
          {rule.key}
        </span>
        <span className="chip border-ink-200 bg-white text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
          v{rule.version}
        </span>
        {rule.enabled ? (
          <span className="chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100">
            Enabled
          </span>
        ) : (
          <span className="chip border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800">
            Disabled
          </span>
        )}
        <span className="ml-auto text-xs text-ink-400">
          Last changed {dateTime(rule.updatedAt)}
          {rule.updatedBy ? ` by ${rule.updatedBy}` : ''}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Detected all time" value={total} />
        <KpiCard label="Currently open" value={open} />
        <KpiCard
          label="Conversion rate"
          value={total > 0 ? converted / total : 0}
          format="percent"
          hint={`${count(converted)} converted, ${money(realised)} realised.`}
        />
        <KpiCard
          label="Dismissal rate"
          value={total > 0 ? dismissed / total : 0}
          format="percent"
          goodWhen="down"
          accent={total >= 20 && dismissed / total > 0.3 ? 'critical' : 'default'}
          hint="Findings closed as rejected or not applicable. A high rate means the thresholds are too loose."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Configuration"
            description={
              can(principal, 'rules.edit')
                ? 'Edit thresholds here. Changes take effect on the next detection run and are recorded in the audit trail.'
                : 'Thresholds as currently configured. Editing requires the rules.edit permission.'
            }
          />
          <RuleEditor
            ruleId={rule.id}
            ruleKey={rule.key}
            enabled={rule.enabled}
            slaDays={rule.slaDays}
            clinicalUrgency={rule.clinicalUrgency}
            defaultOwnerRole={rule.defaultOwnerRole}
            params={paramRows}
            canEdit={can(principal, 'rules.edit')}
          />
        </Card>

        <div className="space-y-4">
          <Card>
            <SectionHeader title="Behaviour" />
            <dl className="space-y-3">
              <div>
                <dt className="label">Baseline clinical urgency</dt>
                <dd className="mt-0.5 text-sm text-ink-800 dark:text-ink-200">
                  {rule.clinicalUrgency} / 100 — the starting urgency before the detector adjusts it
                  for the specific evidence.
                </dd>
              </div>
              <div>
                <dt className="label">Service-level target</dt>
                <dd className="mt-0.5 text-sm text-ink-800 dark:text-ink-200">
                  {rule.slaDays} days from detection to first action.
                </dd>
              </div>
              <div>
                <dt className="label">Default owning team</dt>
                <dd className="mt-0.5 text-sm text-ink-800 dark:text-ink-200">
                  {humanise(rule.defaultOwnerRole)}
                </dd>
              </div>
              <div>
                <dt className="label">Recommended action</dt>
                <dd className="mt-0.5 text-sm text-ink-800 dark:text-ink-200">{rule.recommendedAction}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <SectionHeader
              title="Recent dismissals"
              description="Why people closed findings from this rule without acting. The fastest route to a better threshold."
            />
            {recentDismissed.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-400">
                No findings from this rule have been dismissed.
              </p>
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {recentDismissed.map((d) => (
                  <li key={d.id} className="py-2">
                    <p className="text-sm text-ink-700 dark:text-ink-200">{d.note ?? 'No reason recorded.'}</p>
                    <p className="mt-0.5 text-2xs text-ink-400">
                      {humanise(d.toStatus)} · {dateTime(d.performedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <SectionHeader
          title="Highest-scoring findings"
          description="What this rule is currently surfacing, so a threshold change can be judged against real output."
        />
        {samples.length === 0 ? (
          <EmptyState
            title="This rule has produced no findings"
            description="Either the pattern is genuinely absent from the data, or the thresholds above are unreachable. Loosen one and re-run detection to check."
          />
        ) : (
          <OpportunityMiniList principal={principal} items={samples} />
        )}
      </Card>

      <Card>
        <SectionHeader title="Status distribution" />
        <TableShell
          head={
            <>
              <th className="th">Status</th>
              <th className="th text-right">Count</th>
              <th className="th text-right">Share</th>
              <th className="th text-right">Potential value</th>
            </>
          }
        >
          {stats
            .sort((a, b) => b._count - a._count)
            .map((s) => (
              <tr key={s.status}>
                <td className="td">{humanise(s.status)}</td>
                <td className="td tabular text-right">{count(s._count)}</td>
                <td className="td tabular text-right">{percent(total > 0 ? s._count / total : 0, 0)}</td>
                <td className="td tabular text-right">{money(s._sum.potentialValue ?? 0)}</td>
              </tr>
            ))}
        </TableShell>
      </Card>
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
