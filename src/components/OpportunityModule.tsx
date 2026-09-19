import Link from 'next/link'
import { prisma } from '@/lib/db'
import { listOpportunities, getKpis, getCategorySummary, type OpportunityFilters } from '@/lib/queries'
import { parseFilters, parseSort, parsePage, type SearchParams } from '@/lib/params'
import { money, moneyCompact, count, percent } from '@/lib/format'
import { PageHeader, Card, KpiCard } from '@/components/ui'
import { FilterBar, Pagination } from '@/components/FilterBar'
import { OpportunityTable, type Column } from '@/components/OpportunityTable'
import type { Principal } from '@/lib/rbac'

const PAGE_SIZE = 40

/**
 * The shared opportunity module.
 *
 * Seven of the primary navigation entries are the same view over a different
 * slice — Clinical Opportunities is the list pinned to the clinical categories,
 * Insurance Recovery is the list pinned to INSURANCE, and so on. Building them
 * from one component means a fix to scoping, masking or pagination lands in all
 * of them at once, instead of in whichever copy someone remembered.
 */
export async function OpportunityModule({
  principal,
  params,
  title,
  question,
  description,
  pinned = {},
  lockedFilters = [],
  columns,
  kpis: kpiMode = 'summary',
  footer,
}: {
  principal: Principal
  params: SearchParams
  title: string
  question?: string
  description?: string
  pinned?: Partial<OpportunityFilters>
  lockedFilters?: Array<'category' | 'priority' | 'status' | 'lifecycle' | 'hospital' | 'specialty'>
  columns?: Column[]
  kpis?: 'summary' | 'none'
  footer?: React.ReactNode
}) {
  const filters = parseFilters(params, pinned)
  const sort = parseSort(params)
  const { page, skip, take } = parsePage(params, PAGE_SIZE)

  const [{ items, total }, hospitals, specialties, kpis, categories] = await Promise.all([
    listOpportunities(principal, filters, { skip, take, sort }),
    prisma.hospital.findMany({
      where: principal.scopeLevel === 'GROUP' ? { isActive: true } : { id: { in: principal.hospitalIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    lockedFilters.includes('specialty')
      ? Promise.resolve([])
      : prisma.specialty.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    kpiMode === 'summary' ? getKpis(principal, filters) : Promise.resolve(null),
    kpiMode === 'summary' ? getCategorySummary(principal, { ...filters, lifecycle: 'all' }) : Promise.resolve([]),
  ])

  const openValue = categories.reduce((s, c) => s + c.potentialValue, 0)
  const realised = categories.reduce((s, c) => s + c.realisedValue, 0)
  const convertedCount = categories.reduce((s, c) => s + c.converted, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        question={question}
        description={description}
        actions={
          <Link
            href={`/api/export/opportunities?${new URLSearchParams(
              Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
                const s = Array.isArray(v) ? v[0] : v
                if (s) acc[k] = s
                return acc
              }, {})
            ).toString()}`}
            className="btn btn-secondary"
          >
            Export CSV
          </Link>
        }
      />

      {kpis && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Open in this view"
            value={total}
            hint="Matching the filters currently applied."
          />
          <KpiCard
            label="Potential value"
            value={openValue}
            format="moneyCompact"
            hint="If every open opportunity here converted."
          />
          <KpiCard
            label="Converted to date"
            value={convertedCount}
            hint={`${money(realised)} realised from this slice.`}
          />
          <KpiCard
            label="Past SLA"
            value={kpis.slaBreached}
            goodWhen="down"
            accent={kpis.slaBreached > 0 ? 'critical' : 'default'}
            hint="Open work whose response window has already closed."
          />
        </div>
      )}

      <Card>
        <FilterBar
          principal={principal}
          params={params}
          hospitals={hospitals}
          specialties={specialties}
          locked={lockedFilters}
        />

        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <p className="text-sm text-ink-600 dark:text-ink-300">
            <span className="tabular font-semibold text-ink-900 dark:text-ink-50">{count(total)}</span>{' '}
            opportunities
            {openValue > 0 && (
              <>
                {' '}
                · <span className="tabular font-medium">{moneyCompact(openValue)}</span> potential
              </>
            )}
            {total > 0 && convertedCount > 0 && (
              <>
                {' '}
                · <span className="tabular">{percent(convertedCount / (convertedCount + total), 0)}</span>{' '}
                converted historically
              </>
            )}
          </p>
        </div>

        <OpportunityTable principal={principal} items={items} columns={columns} />
        <Pagination params={params} page={page} total={total} pageSize={PAGE_SIZE} />
      </Card>

      {footer}
    </div>
  )
}
