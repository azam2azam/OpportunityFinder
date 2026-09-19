import { getPrincipal } from '@/lib/auth'
import { can, projectPatient } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { listOpportunities } from '@/lib/queries'
import { parseFilters, parseSort } from '@/lib/params'
import type { SearchParams } from '@/lib/params'

/**
 * CSV export of the current opportunity view.
 *
 * Exports leave the platform's access controls behind the moment the file is
 * saved, so two things happen here that do not happen on screen: the export is
 * audited with its row count and filters, and patient identifiers are masked
 * for anyone without PHI rights exactly as they are in the UI. The export is
 * capped — an export of everything is a data extract, not a report.
 */
const MAX_EXPORT_ROWS = 5000

export async function GET(request: Request) {
  const principal = await getPrincipal()
  if (!principal) return new Response('Not authenticated.', { status: 401 })
  if (!can(principal, 'export.data')) {
    await audit(principal, {
      category: 'SECURITY',
      action: 'EXPORT_DENIED',
      detail: { reason: 'missing export.data' },
      outcome: 'DENIED',
    })
    return new Response('Your role cannot export data.', { status: 403 })
  }

  const url = new URL(request.url)
  const params: SearchParams = Object.fromEntries(url.searchParams.entries())
  const filters = parseFilters(params)
  const sort = parseSort(params)

  const { items, total } = await listOpportunities(principal, filters, {
    take: MAX_EXPORT_ROWS,
    sort,
  })

  const header = [
    'reference', 'title', 'category', 'priority', 'status', 'score',
    'potential_value', 'realised_value', 'patient_mrn', 'patient_name',
    'hospital', 'specialty', 'physician', 'owner', 'detected_at',
    'sla_due_at', 'recommended_action',
  ]

  const rows = items.map((o) => {
    const patient = o.patient ? projectPatient(principal, o.patient) : null
    return [
      o.reference, o.title, o.category, o.priority, o.status, o.score.toFixed(1),
      Math.round(o.potentialValue), Math.round(o.realisedValue),
      patient?.mrn ?? '', patient?.displayName ?? '',
      o.hospital.name, o.specialty?.name ?? '', o.physician?.name ?? '',
      o.owner?.name ?? '', o.detectedAt.toISOString(),
      o.slaDueAt?.toISOString() ?? '', o.recommendedAction,
    ]
  })

  await audit(principal, {
    category: 'EXPORT',
    action: 'OPPORTUNITY_CSV_EXPORT',
    detail: {
      filters: Object.fromEntries(url.searchParams.entries()),
      rowsExported: rows.length,
      rowsMatching: total,
      truncated: total > MAX_EXPORT_ROWS,
      phiIncluded: can(principal, 'patient.view.phi'),
    },
  })

  const csv = [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="opportuna-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

function escapeCsv(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
