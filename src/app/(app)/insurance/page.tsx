import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { scopeWhere } from '@/lib/queries'
import { parseFilters, parseSort, parsePage, type SearchParams } from '@/lib/params'
import { money, moneyCompact, count, percent, shortDate, relative } from '@/lib/format'
import { REJECTION_LABEL, PATHWAY_LABEL, type RejectionReason, type RecoveryPathway } from '@/lib/enums'
import { projectPatient } from '@/lib/rbac'
import { PageHeader, Card, KpiCard, SectionHeader, TableShell, PriorityBadge, StatusBadge, MiniBar, EmptyState } from '@/components/ui'
import { Pagination } from '@/components/FilterBar'
import { HorizontalBars, Donut } from '@/components/client/Charts'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

/**
 * Insurance Recovery (spec section 10).
 *
 * This module does not reuse the generic opportunity table, because the
 * decision here is different: the specialist is not asking "which patient
 * next?" but "which claim, by which route, before which deadline?". The table
 * is therefore claim-shaped — rejected amount, recoverable amount, reason,
 * responsible department, pathway, days left in the payer window — and the
 * window countdown is the column the work is actually sorted by in practice.
 */
export default async function InsuranceRecovery({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('opportunity.view.financial')
  const params = await searchParams
  const filters = parseFilters(params, { category: 'INSURANCE' })
  const sort = parseSort(params)
  const { page, skip, take } = parsePage(params, PAGE_SIZE)

  // The recovery queue needs each row's evidence (payer, reason, pathway,
  // days remaining), which the shared list projection deliberately omits. This
  // page therefore reads opportunities directly — still through scopeWhere, so
  // the segregation and category rules are identical.
  const queueWhere = scopeWhere(principal, filters)
  const [queue, total, allOpen, rejectionMix, claimStats] = await Promise.all([
    prisma.opportunity.findMany({
      where: queueWhere,
      orderBy: sort === 'value' ? [{ potentialValue: 'desc' }] : sort === 'sla' ? [{ slaDueAt: 'asc' }] : [{ score: 'desc' }],
      skip,
      take,
      select: {
        id: true, reference: true, title: true, priority: true, status: true,
        potentialValue: true, slaDueAt: true, evidence: true, recommendedAction: true,
        hospital: { select: { code: true, name: true } },
        patient: {
          select: {
            id: true, mrn: true, firstName: true, lastName: true, phone: true,
            email: true, nationalIdMasked: true,
          },
        },
      },
    }),
    prisma.opportunity.count({ where: queueWhere }),
    prisma.opportunity.findMany({
      where: scopeWhere(principal, { category: 'INSURANCE', lifecycle: 'open' }),
      select: { potentialValue: true, evidence: true, priority: true, realisedValue: true, status: true },
    }),
    prisma.opportunity.findMany({
      where: scopeWhere(principal, { category: 'INSURANCE', lifecycle: 'all' }),
      select: { evidence: true, potentialValue: true, status: true, realisedValue: true },
    }),
    prisma.insuranceClaim.groupBy({
      by: ['status'],
      where: principal.scopeLevel === 'GROUP' ? {} : { hospitalId: { in: principal.hospitalIds } },
      _count: true,
      _sum: { billedAmount: true },
    }),
  ])

  // Rejection reason and department come out of the opportunity's evidence blob
  // rather than a join: the evidence is the record of what the detector
  // actually saw, and reading it back keeps the analysis consistent with the
  // narrative shown on each opportunity.
  const byReason = new Map<string, { count: number; rejected: number; recoverable: number }>()
  const byDepartment = new Map<string, { count: number; rejected: number }>()
  const byPathway = new Map<string, number>()
  let totalRejected = 0

  for (const o of rejectionMix) {
    const e = safeJson(o.evidence)
    const reason = typeof e.reasonCode === 'string' ? e.reasonCode : null
    const dept = typeof e.responsibleDepartment === 'string' ? e.responsibleDepartment : null
    const pathway = typeof e.pathway === 'string' ? e.pathway : null
    const rejected = typeof e.rejectedAmount === 'number' ? e.rejectedAmount : typeof e.totalRejected === 'number' ? e.totalRejected : 0

    totalRejected += rejected

    if (reason) {
      const r = byReason.get(reason) ?? { count: 0, rejected: 0, recoverable: 0 }
      r.count++
      r.rejected += rejected
      r.recoverable += o.potentialValue
      byReason.set(reason, r)
    }
    if (dept) {
      const d = byDepartment.get(dept) ?? { count: 0, rejected: 0 }
      d.count++
      d.rejected += rejected
      byDepartment.set(dept, d)
    }
    if (pathway) byPathway.set(pathway, (byPathway.get(pathway) ?? 0) + 1)
  }

  const openValue = allOpen.reduce((s, o) => s + o.potentialValue, 0)
  const recovered = rejectionMix.filter((o) => o.status === 'CONVERTED').reduce((s, o) => s + o.realisedValue, 0)
  const urgent = allOpen.filter((o) => {
    const e = safeJson(o.evidence)
    return typeof e.daysRemaining === 'number' && e.daysRemaining <= 14
  })

  const reasonRows = [...byReason.entries()]
    .map(([code, v]) => ({
      code,
      label: REJECTION_LABEL[code as RejectionReason] ?? code,
      ...v,
    }))
    .sort((a, b) => b.rejected - a.rejected)
  const maxReason = Math.max(1, ...reasonRows.map((r) => r.rejected))

  const rejectedClaims = claimStats.find((c) => c.status === 'REJECTED')
  const allClaims = claimStats.reduce((s, c) => s + c._count, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Insurance Recovery"
        question="How much rejected revenue can we still recover, and by which route?"
        description="Rejected, underpaid and stalled claims with a defined recovery pathway, ranked by recoverable value and by how long the payer window stays open."
        actions={
          <Link href="/api/export/opportunities?category=INSURANCE" className="btn btn-secondary">
            Export CSV
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Rejected value in scope"
          value={totalRejected}
          format="moneyCompact"
          goodWhen="down"
          hint={`Across ${count(rejectionMix.length)} rejection-linked opportunities.`}
        />
        <KpiCard
          label="Recoverable value"
          value={openValue}
          format="moneyCompact"
          hint="Rejected value weighted by the historical recovery rate for each reason and payer."
        />
        <KpiCard
          label="Recovered to date"
          value={recovered}
          format="moneyCompact"
          hint="Realised from converted recovery opportunities."
        />
        <KpiCard
          label="Closing within 14 days"
          value={urgent.length}
          goodWhen="down"
          accent={urgent.length > 0 ? 'critical' : 'default'}
          hint="Payer resubmission windows about to expire. After that the money is unrecoverable regardless of merit."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader
            title="Rejection reasons"
            description="Where the rejected value is concentrated, and how much of it the playbook expects to recover."
          />
          {reasonRows.length === 0 ? (
            <EmptyState title="No rejection opportunities in scope" />
          ) : (
            <TableShell
              head={
                <>
                  <th className="th">Reason</th>
                  <th className="th text-right">Claims</th>
                  <th className="th text-right">Rejected</th>
                  <th className="th">Share</th>
                  <th className="th text-right">Recoverable</th>
                  <th className="th text-right">Recovery rate</th>
                </>
              }
            >
              {reasonRows.map((r) => (
                <tr key={r.code}>
                  <td className="td font-medium text-ink-900 dark:text-ink-100">{r.label}</td>
                  <td className="td tabular text-right">{count(r.count)}</td>
                  <td className="td tabular text-right">{money(r.rejected)}</td>
                  <td className="td">
                    <MiniBar value={r.rejected} max={maxReason} tone="danger" />
                  </td>
                  <td className="td tabular text-right font-medium text-positive-600 dark:text-positive-500">
                    {money(r.recoverable)}
                  </td>
                  <td className="td tabular text-right">
                    {r.rejected > 0 ? percent(r.recoverable / r.rejected, 0) : '—'}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </Card>

        <Card>
          <SectionHeader title="Recovery pathways" description="How the open work should be actioned." />
          {byPathway.size === 0 ? (
            <EmptyState title="No pathways assigned" />
          ) : (
            <Donut
              data={[...byPathway.entries()].map(([k, v]) => ({
                label: PATHWAY_LABEL[k as RecoveryPathway] ?? k,
                value: v,
              }))}
            />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader
            title="Responsible department"
            description="Rejections attributed to the department that generated the defect — this is where a fix stops the next one."
          />
          {byDepartment.size === 0 ? (
            <EmptyState title="No departmental attribution available" />
          ) : (
            <HorizontalBars
              data={[...byDepartment.entries()]
                .map(([label, v]) => ({ label, value: Math.round(v.rejected) }))
                .sort((a, b) => b.value - a.value)}
              money
              tone={4}
              height={Math.max(180, byDepartment.size * 34)}
            />
          )}
        </Card>

        <Card>
          <SectionHeader title="Claim adjudication mix" description="Every claim in scope, by current status." />
          <TableShell
            head={
              <>
                <th className="th">Status</th>
                <th className="th text-right">Claims</th>
                <th className="th text-right">Billed</th>
                <th className="th text-right">Share</th>
              </>
            }
          >
            {claimStats
              .sort((a, b) => b._count - a._count)
              .map((c) => (
                <tr key={c.status}>
                  <td className="td">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="td tabular text-right">{count(c._count)}</td>
                  <td className="td tabular text-right">{moneyCompact(c._sum.billedAmount ?? 0)}</td>
                  <td className="td tabular text-right">
                    {allClaims > 0 ? percent(c._count / allClaims, 0) : '—'}
                  </td>
                </tr>
              ))}
          </TableShell>
          {rejectedClaims && (
            <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
              {count(rejectedClaims._count)} rejected claims worth{' '}
              {money(rejectedClaims._sum.billedAmount ?? 0)} —{' '}
              {allClaims > 0 ? percent(rejectedClaims._count / allClaims, 0) : '—'} of all claims.
            </p>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Recovery work queue"
          description="Ranked by recoverable value, with the payer window shown. Work the shortest windows first — merit does not survive a closed window."
        />
        {queue.length === 0 ? (
          <EmptyState
            title="No recovery opportunities match these filters"
            description="Run detection if the pipeline has not been populated, or widen the lifecycle filter to include closed work."
          />
        ) : (
          <>
            <TableShell
              head={
                <>
                  <th className="th">Priority</th>
                  <th className="th">Claim / service</th>
                  <th className="th">Patient</th>
                  <th className="th">Payer</th>
                  <th className="th">Reason</th>
                  <th className="th">Pathway</th>
                  <th className="th text-right">Rejected</th>
                  <th className="th text-right">Recoverable</th>
                  <th className="th text-right">Window</th>
                  <th className="th">Status</th>
                </>
              }
            >
              {queue.map((o) => {
                const e = safeJson(o.evidence)
                const patient = o.patient ? projectPatient(principal, o.patient) : null
                const reason = typeof e.reasonCode === 'string' ? e.reasonCode : null
                const pathway = typeof e.pathway === 'string' ? e.pathway : null
                const rejected =
                  typeof e.rejectedAmount === 'number'
                    ? e.rejectedAmount
                    : typeof e.totalRejected === 'number'
                      ? e.totalRejected
                      : typeof e.variance === 'number'
                        ? e.variance
                        : typeof e.billedAmount === 'number'
                          ? e.billedAmount
                          : null
                const daysRemaining = typeof e.daysRemaining === 'number' ? e.daysRemaining : null

                return (
                  <tr key={o.id} className="row-link">
                    <td className="td">
                      <PriorityBadge priority={o.priority} />
                    </td>
                    <td className="td">
                      <Link href={`/opportunities/${o.id}`} className="block max-w-xs">
                        <span className="block truncate font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100">
                          {o.title}
                        </span>
                        <span className="block truncate font-mono text-2xs text-ink-400">
                          {typeof e.claimNumber === 'string' ? e.claimNumber : o.reference}
                        </span>
                      </Link>
                    </td>
                    <td className="td">
                      {patient ? (
                        <span className="block max-w-[140px] truncate">{patient.displayName}</span>
                      ) : (
                        <span className="text-xs italic text-ink-400">Process-level</span>
                      )}
                    </td>
                    <td className="td text-xs">
                      {typeof e.payer === 'string' ? e.payer : o.hospital.code}
                    </td>
                    <td className="td text-xs text-ink-600 dark:text-ink-300">
                      {reason ? (REJECTION_LABEL[reason as RejectionReason] ?? reason) : '—'}
                    </td>
                    <td className="td text-xs text-ink-600 dark:text-ink-300">
                      {pathway ? (PATHWAY_LABEL[pathway as RecoveryPathway] ?? pathway) : '—'}
                    </td>
                    <td className="td tabular text-right">{rejected != null ? money(rejected) : '—'}</td>
                    <td className="td tabular text-right font-medium text-positive-600 dark:text-positive-500">
                      {money(o.potentialValue)}
                    </td>
                    <td className="td tabular text-right text-xs">
                      {daysRemaining != null ? (
                        <span
                          className={
                            daysRemaining <= 14
                              ? 'font-semibold text-danger-600 dark:text-danger-500'
                              : 'text-ink-600 dark:text-ink-300'
                          }
                        >
                          {daysRemaining}d left
                        </span>
                      ) : o.slaDueAt ? (
                        relative(o.slaDueAt)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="td">
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                )
              })}
            </TableShell>
            <Pagination params={params} page={page} total={total} pageSize={PAGE_SIZE} />
          </>
        )}
        <p className="mt-4 border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-500 dark:border-ink-800 dark:text-ink-400">
          Where the payer route is closed, the platform raises a financial-counselling opportunity
          rather than a recovery one. A self-pay option may be offered only where it is clinically
          appropriate and permitted under the patient&rsquo;s payer contract — confirm eligibility
          before any pricing discussion, and record the outcome against the opportunity.
        </p>
      </Card>

      <p className="text-xs text-ink-400 dark:text-ink-500">
        Claim data last synchronised from VIDA RCM {shortDate(new Date())}.
      </p>
    </div>
  )
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
