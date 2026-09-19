import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { can } from '@/lib/rbac'
import { ROLES } from '@/lib/rbac'
import { count, dateTime, humanise, relative } from '@/lib/format'
import { PageHeader, Card, SectionHeader, KpiCard, TableShell, EmptyState } from '@/components/ui'
import { ScoringEditor } from '@/components/client/ScoringEditor'
import { RunDetection } from '@/components/client/RunDetection'

export const dynamic = 'force-dynamic'

/**
 * Administration.
 *
 * Users and roles, the scoring model, alert rules and detection runs. Kept as
 * one page rather than four because these settings are read together — an
 * administrator investigating "why is everything suddenly critical" needs the
 * scoring weights, the recent runs and the alert thresholds in one view.
 */
export default async function Administration() {
  const principal = await guard('admin.users')

  const [users, models, alertRules, runs, roleCounts] = await Promise.all([
    prisma.user.findMany({
      include: {
        role: true,
        hospitalScopes: { include: { hospital: { select: { name: true, code: true } } } },
      },
      orderBy: [{ role: { scopeLevel: 'asc' } }, { name: 'asc' }],
    }),
    prisma.scoringModel.findMany({ include: { weights: true }, orderBy: { isActive: 'desc' } }),
    prisma.alertRule.findMany({ orderBy: { name: 'asc' } }),
    prisma.detectionRun.findMany({ orderBy: { startedAt: 'desc' }, take: 8 }),
    prisma.user.groupBy({ by: ['roleId'], _count: true }),
  ])

  const activeModel = models.find((m) => m.isActive)
  const roleCountById = new Map(roleCounts.map((r) => [r.roleId, r._count]))
  const activeUsers = users.filter((u) => u.isActive).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Administration"
        question="How is the platform configured, and who can see what?"
        description="Users and their access scope, the scoring model, alert thresholds and detection run history."
        actions={can(principal, 'detection.run') ? <RunDetection /> : null}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active users" value={activeUsers} hint={`${users.length} accounts in total.`} />
        <KpiCard label="Roles defined" value={ROLES.length} />
        <KpiCard label="Alert rules" value={alertRules.filter((a) => a.enabled).length} hint={`${alertRules.length} configured.`} />
        <KpiCard
          label="Detection runs recorded"
          value={runs.length}
          hint={runs[0] ? `Last ${relative(runs[0].startedAt)}.` : undefined}
        />
      </div>

      {activeModel && (
        <Card>
          <SectionHeader
            title="Scoring model"
            description="The weights and priority bands every opportunity is scored against. Changes apply on the next detection run."
          />
          <ScoringEditor
            models={models.map((m) => ({
              id: m.id,
              name: m.name,
              isActive: m.isActive,
              notes: m.notes,
              thresholds: safeThresholds(m.thresholds),
              weights: Object.fromEntries(m.weights.map((w) => [w.factor, w.weight])),
            }))}
            canEdit={can(principal, 'scoring.edit')}
          />
        </Card>
      )}

      <Card>
        <SectionHeader
          title="Users and access scope"
          description="Who holds which role, and which hospitals each can read. Scope is enforced on every query, not in the interface."
        />
        <TableShell
          head={
            <>
              <th className="th">User</th>
              <th className="th">Role</th>
              <th className="th">Scope level</th>
              <th className="th">Hospitals</th>
              <th className="th">PHI access</th>
              <th className="th">Last sign-in</th>
              <th className="th">State</th>
            </>
          }
        >
          {users.map((u) => {
            const definition = ROLES.find((r) => r.key === u.role.key)
            const hasPhi = definition?.permissions.includes('patient.view.phi') ?? false
            return (
              <tr key={u.id}>
                <td className="td">
                  <span className="block font-medium text-ink-900 dark:text-ink-100">{u.name}</span>
                  <span className="block text-xs text-ink-500 dark:text-ink-400">{u.title}</span>
                  <span className="block font-mono text-2xs text-ink-400">{u.email}</span>
                </td>
                <td className="td text-sm">{u.role.name}</td>
                <td className="td text-xs">{humanise(u.role.scopeLevel)}</td>
                <td className="td text-xs">
                  {u.role.scopeLevel === 'GROUP' ? (
                    <span className="text-ink-500">All hospitals</span>
                  ) : u.hospitalScopes.length === 0 ? (
                    <span className="text-warn-700 dark:text-warn-500">No scope assigned</span>
                  ) : (
                    u.hospitalScopes.map((s) => s.hospital.code).join(', ')
                  )}
                </td>
                <td className="td">
                  {hasPhi ? (
                    <span className="chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20">
                      Unmasked
                    </span>
                  ) : (
                    <span className="chip border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800">
                      Masked
                    </span>
                  )}
                </td>
                <td className="td whitespace-nowrap text-xs text-ink-500">
                  {u.lastLoginAt ? relative(u.lastLoginAt) : 'Never'}
                </td>
                <td className="td">
                  {u.isActive ? (
                    <span className="chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100">
                      Active
                    </span>
                  ) : (
                    <span className="chip border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800">
                      Disabled
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader
          title="Roles and permissions"
          description="The permission catalogue. A module is only reachable by a role that holds its permission."
        />
        <TableShell
          head={
            <>
              <th className="th">Role</th>
              <th className="th">Scope</th>
              <th className="th text-right">Users</th>
              <th className="th text-right">Permissions</th>
              <th className="th">Grants</th>
            </>
          }
        >
          {ROLES.map((r) => {
            const dbRole = users.find((u) => u.role.key === r.key)?.roleId
            return (
              <tr key={r.key}>
                <td className="td">
                  <span className="block font-medium text-ink-900 dark:text-ink-100">{r.name}</span>
                  <span className="block max-w-md text-xs text-ink-500 dark:text-ink-400">
                    {r.description}
                  </span>
                </td>
                <td className="td text-xs">{humanise(r.scopeLevel)}</td>
                <td className="td tabular text-right">
                  {count(dbRole ? (roleCountById.get(dbRole) ?? 0) : 0)}
                </td>
                <td className="td tabular text-right">{r.permissions.length}</td>
                <td className="td">
                  <div className="flex max-w-lg flex-wrap gap-1">
                    {r.permissions.slice(0, 6).map((p) => (
                      <span
                        key={p}
                        className="chip border-ink-200 bg-ink-50 font-mono text-2xs text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300"
                      >
                        {p}
                      </span>
                    ))}
                    {r.permissions.length > 6 && (
                      <span className="chip border-transparent text-2xs text-ink-400">
                        +{r.permissions.length - 6} more
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader
          title="Executive alert rules"
          description="Thresholds that raise an alert on the executive dashboard, and who sees each."
        />
        <TableShell
          head={
            <>
              <th className="th">Alert</th>
              <th className="th">Metric</th>
              <th className="th">Condition</th>
              <th className="th">Window</th>
              <th className="th">Severity</th>
              <th className="th">Audience</th>
              <th className="th">State</th>
            </>
          }
        >
          {alertRules.map((a) => (
            <tr key={a.id}>
              <td className="td font-medium text-ink-900 dark:text-ink-100">{a.name}</td>
              <td className="td font-mono text-2xs text-ink-500">{a.metric}</td>
              <td className="td text-xs">
                {a.comparator === 'GT' ? '>' : a.comparator === 'LT' ? '<' : '='} {a.threshold}
              </td>
              <td className="td text-xs">{humanise(a.window)}</td>
              <td className="td">
                <span
                  className={
                    a.severity === 'CRITICAL'
                      ? 'chip border-critical-border bg-critical-bg text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200'
                      : 'chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                  }
                >
                  {humanise(a.severity)}
                </span>
              </td>
              <td className="td max-w-xs text-2xs text-ink-500">
                {a.audience.split(',').map((r) => humanise(r.trim())).join(', ')}
              </td>
              <td className="td text-xs">{a.enabled ? 'Enabled' : 'Disabled'}</td>
            </tr>
          ))}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader
          title="Detection run history"
          description="Every run, what triggered it and what it produced."
          action={
            <Link href="/rules" className="btn btn-ghost text-xs">
              Rule configuration
            </Link>
          }
        />
        {runs.length === 0 ? (
          <EmptyState title="No detection runs recorded" description="Trigger one with the button above." />
        ) : (
          <TableShell
            head={
              <>
                <th className="th">Started</th>
                <th className="th">Triggered by</th>
                <th className="th">Status</th>
                <th className="th text-right">Created</th>
                <th className="th text-right">Updated</th>
                <th className="th text-right">Suppressed</th>
                <th className="th text-right">Duration</th>
              </>
            }
          >
            {runs.map((r) => {
              const stats = safeStats(r.stats)
              return (
                <tr key={r.id}>
                  <td className="td whitespace-nowrap text-xs">{dateTime(r.startedAt)}</td>
                  <td className="td max-w-xs truncate text-xs">{r.triggeredBy}</td>
                  <td className="td text-xs">
                    <span
                      className={
                        r.status === 'COMPLETED'
                          ? 'text-positive-600 dark:text-positive-500'
                          : r.status === 'FAILED'
                            ? 'text-danger-600 dark:text-danger-500'
                            : 'text-ink-500'
                      }
                    >
                      {humanise(r.status)}
                    </span>
                  </td>
                  <td className="td tabular text-right">{count(stats.created)}</td>
                  <td className="td tabular text-right">{count(stats.updated)}</td>
                  <td className="td tabular text-right">{count(stats.suppressed)}</td>
                  <td className="td tabular text-right text-xs">
                    {r.finishedAt
                      ? `${((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1)}s`
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </TableShell>
        )}
      </Card>
    </div>
  )
}

function safeThresholds(raw: string): { CRITICAL: number; HIGH: number; MEDIUM: number } {
  try {
    const parsed = JSON.parse(raw)
    return {
      CRITICAL: Number(parsed.CRITICAL) || 78,
      HIGH: Number(parsed.HIGH) || 62,
      MEDIUM: Number(parsed.MEDIUM) || 42,
    }
  } catch {
    return { CRITICAL: 78, HIGH: 62, MEDIUM: 42 }
  }
}

function safeStats(raw: string): { created: number; updated: number; suppressed: number } {
  try {
    const parsed = JSON.parse(raw)
    const t = parsed?.totals ?? {}
    return {
      created: Number(t.created) || 0,
      updated: Number(t.updated) || 0,
      suppressed: Number(t.suppressed) || 0,
    }
  } catch {
    return { created: 0, updated: 0, suppressed: 0 }
  }
}
