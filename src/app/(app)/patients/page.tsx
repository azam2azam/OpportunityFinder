import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { scopeWhere } from '@/lib/queries'
import { parseFilters, parsePage, one, withParam, type SearchParams } from '@/lib/params'
import { money, relative, humanise } from '@/lib/format'
import { CATEGORY_LABEL } from '@/lib/enums'
import { projectPatient, can } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import {
  PageHeader, Card, KpiCard, TableShell, PriorityBadge,
  CategoryBadge, EmptyState,
} from '@/components/ui'
import { Pagination } from '@/components/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

/**
 * Patient Opportunities.
 *
 * The one module organised by person rather than by finding. A patient with
 * four open opportunities is one phone call, not four — grouping them here is
 * what lets a navigator handle the whole patient in a single contact instead of
 * calling them on Monday about a lab result and again on Thursday about a
 * refill.
 */
export default async function PatientOpportunities({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('patient.view')
  const params = await searchParams
  const filters = parseFilters(params, { lifecycle: 'open' })
  const { page, skip, take } = parsePage(params, PAGE_SIZE)
  const search = one(params, 'q')

  if (search) {
    // Searching by identifier is a PHI access event in its own right, whether
    // or not it returns anything.
    await audit(principal, {
      category: 'PHI_ACCESS',
      action: 'PATIENT_SEARCH',
      detail: { query: search },
    })
  }

  // Opportunities carrying a patient, grouped in memory. The grouping key is
  // the patient, so pagination has to happen over patients rather than over
  // opportunities — otherwise a patient's opportunities would split across
  // pages.
  const rows = await prisma.opportunity.findMany({
    where: { AND: [scopeWhere(principal, filters), { patientId: { not: null } }] },
    select: {
      id: true, reference: true, title: true, category: true, priority: true,
      score: true, potentialValue: true, status: true, detectedAt: true,
      slaDueAt: true,
      hospital: { select: { id: true, name: true, code: true } },
      specialty: { select: { name: true } },
      patient: {
        select: {
          id: true, mrn: true, firstName: true, lastName: true, phone: true, email: true,
          nationalIdMasked: true, dateOfBirth: true, gender: true, contactable: true,
          consentMarketing: true, preferredChannel: true, lastEncounterAt: true,
          insuranceStatus: true, distanceKm: true, vipFlag: true,
        },
      },
    },
    orderBy: { score: 'desc' },
  })

  interface PatientGroup {
    patient: NonNullable<(typeof rows)[number]['patient']>
    hospital: { id: string; name: string; code: string }
    opportunities: typeof rows
    totalValue: number
    topScore: number
    categories: Set<string>
    hasCritical: boolean
  }

  const grouped = new Map<string, PatientGroup>()
  for (const r of rows) {
    if (!r.patient) continue
    let g = grouped.get(r.patient.id)
    if (!g) {
      g = {
        patient: r.patient,
        hospital: r.hospital,
        opportunities: [],
        totalValue: 0,
        topScore: 0,
        categories: new Set(),
        hasCritical: false,
      }
      grouped.set(r.patient.id, g)
    }
    g.opportunities.push(r)
    g.totalValue += r.potentialValue
    g.topScore = Math.max(g.topScore, r.score)
    g.categories.add(r.category)
    if (r.priority === 'CRITICAL') g.hasCritical = true
  }

  let patients = [...grouped.values()]

  if (search) {
    const q = search.toLowerCase()
    patients = patients.filter(
      (g) =>
        g.patient.mrn.toLowerCase().includes(q) ||
        (can(principal, 'patient.view.phi') &&
          `${g.patient.firstName} ${g.patient.lastName}`.toLowerCase().includes(q))
    )
  }

  // A patient with several opportunities across different domains is the
  // highest-leverage call: one conversation closes several loops.
  patients.sort(
    (a, b) =>
      Number(b.hasCritical) - Number(a.hasCritical) ||
      b.categories.size - a.categories.size ||
      b.totalValue - a.totalValue
  )

  const total = patients.length
  const pageItems = patients.slice(skip, skip + take)

  const multiLoop = patients.filter((p) => p.categories.size > 1).length
  const totalValue = patients.reduce((s, p) => s + p.totalValue, 0)
  const uncontactable = patients.filter((p) => !p.patient.contactable).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Patient Opportunities"
        question="Which patients need attention, and what do they need?"
        description="Open opportunities grouped by patient, so one outreach can close several loops. Ranked by clinical urgency, then by how many distinct issues the patient has open."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Patients requiring action" value={total} hint="Distinct patients with at least one open opportunity." />
        <KpiCard
          label="Multi-issue patients"
          value={multiLoop}
          hint="Open opportunities in more than one domain — one call can resolve several."
        />
        <KpiCard label="Total potential value" value={totalValue} format="moneyCompact" />
        <KpiCard
          label="Not contactable"
          value={uncontactable}
          goodWhen="down"
          hint="Opted out or no number on file. These need a different route, not another call."
        />
      </div>

      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <input
            type="search"
            name="q"
            defaultValue={search ?? ''}
            placeholder={
              can(principal, 'patient.view.phi')
                ? 'Search by MRN or patient name…'
                : 'Search by MRN (name search needs PHI access)…'
            }
            className="input max-w-sm"
            aria-label="Search patients"
          />
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          {search && (
            <Link href={withParam(params, { q: undefined })} className="btn btn-ghost">
              Clear
            </Link>
          )}
        </form>

        {pageItems.length === 0 ? (
          <EmptyState
            title={search ? `No patients match “${search}”` : 'No patients with open opportunities'}
            description={
              search
                ? 'Check the MRN, or clear the search to see every patient with open work.'
                : 'Run detection to populate the pipeline.'
            }
          />
        ) : (
          <>
            <TableShell
              head={
                <>
                  <th className="th">Patient</th>
                  <th className="th">Hospital</th>
                  <th className="th text-right">Open</th>
                  <th className="th">Issues</th>
                  <th className="th text-right">Value</th>
                  <th className="th">Last seen</th>
                  <th className="th">Reachable</th>
                  <th className="th">Top priority</th>
                </>
              }
            >
              {pageItems.map((g) => {
                const p = projectPatient(principal, g.patient)
                const age = Math.floor(
                  (Date.now() - g.patient.dateOfBirth.getTime()) / (365.25 * 86_400_000)
                )
                const top = g.opportunities[0]
                return (
                  <tr key={g.patient.id} className="row-link align-top">
                    <td className="td">
                      <Link href={`/opportunities/${top.id}`} className="block max-w-[220px]">
                        <span className="block truncate font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100">
                          {p.displayName}
                          {g.patient.vipFlag && (
                            <span className="ml-1.5 text-2xs font-semibold text-brand-600">VIP</span>
                          )}
                        </span>
                        <span className="block truncate font-mono text-2xs text-ink-400">
                          {p.mrn} · {age}
                          {g.patient.gender === 'M' ? 'M' : 'F'}
                        </span>
                      </Link>
                    </td>
                    <td className="td whitespace-nowrap text-xs">{g.hospital.name}</td>
                    <td className="td tabular text-right font-semibold">{g.opportunities.length}</td>
                    <td className="td">
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {[...g.categories].map((c) => (
                          <CategoryBadge
                            key={c}
                            category={c}
                            label={CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="td tabular text-right font-medium">{money(g.totalValue)}</td>
                    <td className="td whitespace-nowrap text-xs text-ink-500">
                      {relative(g.patient.lastEncounterAt)}
                    </td>
                    <td className="td text-xs">
                      {g.patient.contactable ? (
                        <span className="text-ink-600 dark:text-ink-300">
                          {humanise(g.patient.preferredChannel)}
                        </span>
                      ) : (
                        <span className="font-medium text-warn-700 dark:text-warn-500">Opted out</span>
                      )}
                    </td>
                    <td className="td">
                      <PriorityBadge priority={top.priority} />
                      <span className="mt-1 block max-w-[200px] truncate text-2xs text-ink-500">
                        {top.title}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </TableShell>
            <Pagination params={params} page={page} total={total} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>

      {!can(principal, 'patient.view.phi') && (
        <p className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
          Patient identifiers are masked for your role under the minimum-necessary principle. You can
          see the shape of the cohort and act on aggregate patterns; unmasked identity requires the
          patient.view.phi permission, which is granted to clinical and outreach roles.
        </p>
      )}
    </div>
  )
}
