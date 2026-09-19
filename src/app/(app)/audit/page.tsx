import Link from 'next/link'
import clsx from 'clsx'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { parsePage, one, withParam, type SearchParams } from '@/lib/params'
import { count, dateTime, humanise, relative } from '@/lib/format'
import { AUDIT_CATEGORIES } from '@/lib/enums'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell, EmptyState } from '@/components/ui'
import { Pagination } from '@/components/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

/**
 * Audit & Governance (spec section 25).
 *
 * Read-only by construction. The audit trail records authentication, patient
 * record access, opportunity actions, rule and scoring changes, exports, every
 * natural-language query, and every denied attempt. Denials are shown as
 * prominently as successes — a permission boundary nobody ever tests is not
 * evidence of a secure system, and a boundary being tested repeatedly is
 * exactly what a compliance officer needs to see.
 */
export default async function AuditTrail({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // The guard is the point of the call; the principal itself is not needed —
  // the audit trail is identical for every role that can reach it.
  await guard('audit.view')
  const params = await searchParams
  const { page, skip, take } = parsePage(params, PAGE_SIZE)
  const category = one(params, 'category')
  const outcome = one(params, 'outcome')
  const search = one(params, 'q')

  const where = {
    ...(category ? { category } : {}),
    ...(outcome ? { outcome } : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: search } },
            { userEmail: { contains: search } },
            { entityId: { contains: search } },
            { patientId: { contains: search } },
          ],
        }
      : {}),
  }

  const dayAgo = new Date(Date.now() - 86_400_000)

  const [events, total, byCategory, denials, phiAccess, nlQueries, recentDenials] =
    await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { at: 'desc' },
        skip,
        take,
        include: { user: { select: { name: true, role: { select: { name: true } } } } },
      }),
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.groupBy({ by: ['category'], _count: true }),
      prisma.auditEvent.count({ where: { outcome: 'DENIED' } }),
      prisma.auditEvent.count({ where: { category: 'PHI_ACCESS' } }),
      prisma.nlQuery.count(),
      prisma.auditEvent.findMany({
        where: { outcome: 'DENIED', at: { gte: dayAgo } },
        orderBy: { at: 'desc' },
        take: 8,
        include: { user: { select: { name: true } } },
      }),
    ])

  const categoryCounts = new Map(byCategory.map((c) => [c.category, c._count]))
  const totalEvents = byCategory.reduce((s, c) => s + c._count, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit & Governance"
        question="Who did what, to whose data, and when?"
        description="The immutable record of authentication, patient data access, opportunity actions, configuration changes, exports and AI interactions."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Audit events" value={totalEvents} />
        <KpiCard
          label="Patient record accesses"
          value={phiAccess}
          hint="Every time an identifiable patient record was opened."
        />
        <KpiCard
          label="AI interactions logged"
          value={nlQueries}
          hint="Every Ask Data question, including blocked ones."
        />
        <KpiCard
          label="Denied attempts"
          value={denials}
          goodWhen="down"
          accent={denials > 0 ? 'critical' : 'default'}
          hint="Access refused by a permission boundary."
        />
      </div>

      {recentDenials.length > 0 && (
        <Card className="border-warn-100 dark:border-warn-700">
          <SectionHeader
            title="Denied attempts in the last 24 hours"
            description="Permission boundaries that were tested and held."
          />
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {recentDenials.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-sm text-ink-800 dark:text-ink-200">
                  <span className="font-medium">{d.user?.name ?? d.userEmail ?? 'Unauthenticated'}</span>
                  {' — '}
                  <span className="font-mono text-xs">{d.action}</span>
                </span>
                <span className="text-xs text-ink-400">{relative(d.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SectionHeader title="Event categories" description="Coverage across the governance surface." />
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {AUDIT_CATEGORIES.map((c) => (
            <Link
              key={c}
              href={withParam(params, { category: category === c ? undefined : c })}
              className={clsx(
                'rounded-md border p-2.5 transition-colors',
                category === c
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-950'
                  : 'border-ink-200 hover:border-brand-300 dark:border-ink-700'
              )}
            >
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
                {humanise(c)}
              </p>
              <p className="tabular mt-0.5 text-lg font-semibold text-ink-900 dark:text-ink-50">
                {count(categoryCounts.get(c) ?? 0)}
              </p>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <form className="flex flex-1 flex-wrap gap-2">
            {category && <input type="hidden" name="category" value={category} />}
            <input
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder="Search by action, user, entity or patient id…"
              className="input max-w-sm"
              aria-label="Search audit events"
            />
            <button type="submit" className="btn btn-primary">
              Search
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={withParam(params, { outcome: undefined })}
              className={clsx(
                'chip',
                !outcome
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink-200 bg-white text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
              )}
            >
              All outcomes
            </Link>
            {['SUCCESS', 'DENIED', 'ERROR'].map((o) => (
              <Link
                key={o}
                href={withParam(params, { outcome: outcome === o ? undefined : o })}
                className={clsx(
                  'chip',
                  outcome === o
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-ink-200 bg-white text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
                )}
              >
                {humanise(o)}
              </Link>
            ))}
          </div>
        </div>

        {events.length === 0 ? (
          <EmptyState
            title="No audit events match these filters"
            description="Clear the filters to see the full trail."
          />
        ) : (
          <>
            <TableShell
              head={
                <>
                  <th className="th">When</th>
                  <th className="th">User</th>
                  <th className="th">Category</th>
                  <th className="th">Action</th>
                  <th className="th">Entity</th>
                  <th className="th">Patient</th>
                  <th className="th">Outcome</th>
                  <th className="th">Source</th>
                </>
              }
            >
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="td whitespace-nowrap text-xs">{dateTime(e.at)}</td>
                  <td className="td">
                    <span className="block text-sm text-ink-900 dark:text-ink-100">
                      {e.user?.name ?? e.userEmail ?? 'Unauthenticated'}
                    </span>
                    {e.user?.role && (
                      <span className="block text-2xs text-ink-400">{e.user.role.name}</span>
                    )}
                  </td>
                  <td className="td text-xs">{humanise(e.category)}</td>
                  <td className="td font-mono text-2xs text-ink-700 dark:text-ink-300">{e.action}</td>
                  <td className="td font-mono text-2xs text-ink-400">
                    {e.entityType ? `${e.entityType}${e.entityId ? `:${e.entityId.slice(0, 8)}` : ''}` : '—'}
                  </td>
                  <td className="td font-mono text-2xs text-ink-400">
                    {/* The patient id is shown, never the name — the audit trail
                        must not become a second route to reading PHI. */}
                    {e.patientId ? `${e.patientId.slice(0, 10)}…` : '—'}
                  </td>
                  <td className="td">
                    <span
                      className={clsx(
                        'chip',
                        e.outcome === 'SUCCESS'
                          ? 'border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
                          : e.outcome === 'DENIED'
                            ? 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                            : 'border-danger-100 bg-danger-50 text-danger-700 dark:border-danger-700 dark:bg-danger-700/20'
                      )}
                    >
                      {humanise(e.outcome)}
                    </span>
                  </td>
                  <td className="td font-mono text-2xs text-ink-400">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </TableShell>
            <Pagination params={params} page={page} total={total} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>

      <Card>
        <SectionHeader title="Governance controls in force" />
        <ul className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
          {[
            ['Role-based access control', 'Every module is gated by an explicit permission; denied attempts are logged.'],
            ['Hospital data segregation', 'Scoped queries filter by hospital at the data layer, so a scope error returns nothing rather than another hospital’s patients.'],
            ['Minimum necessary access', 'Roles see only the opportunity categories their work requires.'],
            ['Data masking', 'Patient identifiers are masked for roles without explicit PHI rights, in the interface and in exports alike.'],
            ['Patient access logging', 'Opening a patient profile is recorded as an event in its own right, before the page renders.'],
            ['AI interaction auditing', 'Every Ask Data question is logged with its interpretation, validation outcome and row count — blocked questions included.'],
            ['SQL guardrails', 'Generated queries are validated as read-only, single-statement and restricted to the semantic model before execution.'],
            ['Configuration change history', 'Rule and scoring changes record the full before-and-after, so a historical score can be explained against the configuration of the day.'],
            ['Export auditing', 'CSV exports record the filters, row count and whether unmasked identifiers were included.'],
            ['Session management', 'Sessions are server-side, expire after twelve hours, and are destroyed on sign-out.'],
          ].map(([title, detail]) => (
            <li key={title} className="flex gap-2.5">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-positive-500" />
              <span>
                <strong className="font-medium text-ink-900 dark:text-ink-100">{title}.</strong> {detail}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-500 dark:border-ink-800 dark:text-ink-400">
          The platform produces decision support, never autonomous clinical decisions. Every
          opportunity carries the observation that produced it and the weighted factors behind its
          score, so any recommendation shown to a clinician can be examined and overruled. Clinical
          judgement stays with the treating clinician.
        </p>
      </Card>
    </div>
  )
}
