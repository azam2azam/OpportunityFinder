import { redirect } from 'next/navigation'
import { getPrincipal } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { visibleNavigation } from '@/lib/navigation'
import { initials } from '@/lib/format'
import { can } from '@/lib/rbac'
import { getFeedStatus } from '@/lib/ingestion/status'
import { Shell } from '@/components/client/Shell'
import { DataProvenance, type FeedStatusView } from '@/components/client/DataProvenance'

export const dynamic = 'force-dynamic'

/**
 * The authenticated shell.
 *
 * Every page under (app) is gated here rather than page by page: a new page
 * added to this segment is protected by existing, which is the right default
 * for a platform holding patient data.
 *
 * Feed status is fetched once here and handed to the provenance bar, which
 * renders above every page. Doing it in the layout rather than per page means
 * one query set per request regardless of which screen is open, and means a new
 * page inherits its data lineage without its author having to remember.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal()
  if (!principal) redirect('/login')

  const [hospitals, feedStatus] = await Promise.all([
    prisma.hospital.findMany({
      where: principal.scopeLevel === 'GROUP' ? { isActive: true } : { id: { in: principal.hospitalIds } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    // Tolerated failure: the provenance bar is context, not content. If the
    // ingestion tables are unavailable the pages themselves must still render.
    getFeedStatus().catch(() => ({})),
  ])

  const scopeLabel =
    principal.scopeLevel === 'GROUP'
      ? `Group-wide · ${hospitals.length} hospitals`
      : hospitals.length > 1
        ? `${hospitals.length} hospitals`
        : (hospitals[0]?.name ?? 'No hospital assigned')

  // Dates are serialised for the client boundary; the bar formats them itself.
  const feedStatusView: Record<string, FeedStatusView> = Object.fromEntries(
    Object.entries(feedStatus).map(([domain, s]) => [
      domain,
      {
        domain: s.domain,
        sourceName: s.sourceName,
        sourceCode: s.sourceCode,
        connectionMode: s.connectionMode,
        lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
        lastRecords: s.lastRecords,
        state: s.state,
        rejectRate: s.rejectRate,
        qualityFailures: s.qualityFailures,
        criticalQualityFailures: s.criticalQualityFailures,
      },
    ])
  )

  return (
    <Shell
      navigation={visibleNavigation(principal)}
      user={{
        name: principal.name,
        title: principal.title,
        roleName: principal.roleName,
        roleKey: principal.roleKey,
        scopeLabel,
        initials: initials(principal.name),
      }}
      hospitals={hospitals}
      activeHospitalId={null}
    >
      <DataProvenance
        feedStatus={feedStatusView}
        canViewIntegration={can(principal, 'integration.view')}
      />
      {children}
    </Shell>
  )
}
