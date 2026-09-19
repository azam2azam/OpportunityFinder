import Link from 'next/link'
import clsx from 'clsx'
import { guard } from '@/lib/guard'
import { can } from '@/lib/rbac'
import { DOMAINS, DOMAIN_BY_KEY } from '@/lib/ingestion/domains'
import { one, withParam, type SearchParams } from '@/lib/params'
import { count } from '@/lib/format'
import { PageHeader, Card, SectionHeader, TableShell, KpiCard } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * Field Mapping.
 *
 * The contract an integrator builds against: every field each feed accepts, its
 * type, whether it is required, how references resolve, and what the platform
 * does with it. Generated from the domain specs rather than maintained
 * separately, so it cannot drift from what the loader will actually accept —
 * which is the failure mode of every hand-written interface spec.
 */
export default async function FieldMapping({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('integration.view')
  const params = await searchParams
  const selectedKey = one(params, 'domain') ?? DOMAINS[0].key
  const domain = DOMAIN_BY_KEY[selectedKey] ?? DOMAINS[0]

  const required = domain.fields.filter((f) => f.required)
  const references = domain.fields.filter((f) => f.reference)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Field Mapping"
        question="What exactly does each feed accept?"
        description="The interface contract, generated from the loader itself. If a column is listed here the platform accepts it; if it is not, the loader ignores it."
        actions={
          <>
            <Link href={`/api/integration/template/${domain.key}`} className="btn btn-secondary">
              Download CSV template
            </Link>
            {can(principal, 'integration.ingest') && (
              <Link href={`/integration/upload?domain=${domain.key}`} className="btn btn-primary">
                Upload this feed
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-14 shrink-0 text-2xs font-semibold uppercase tracking-wide text-ink-400">Feed</span>
        {DOMAINS.map((d) => (
          <Link
            key={d.key}
            href={withParam(params, { domain: d.key })}
            className={clsx(
              'chip transition-colors',
              d.key === domain.key
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
            )}
          >
            {d.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Fields accepted" value={domain.fields.length} />
        <KpiCard label="Required" value={required.length} hint="A missing column here rejects the whole file." />
        <KpiCard
          label="Reference lookups"
          value={references.length}
          hint="Business codes resolved to internal ids at load time."
        />
        <KpiCard label="Natural key parts" value={domain.naturalKey.length} hint={domain.naturalKey.join(' + ')} />
      </div>

      <Card>
        <SectionHeader title={domain.label} description={domain.description} />

        <dl className="mb-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="label">Target entity</dt>
            <dd className="mt-0.5 font-mono text-sm text-ink-900 dark:text-ink-100">{domain.targetEntity}</dd>
          </div>
          <div>
            <dt className="label">Natural key</dt>
            <dd className="mt-0.5 font-mono text-sm text-ink-900 dark:text-ink-100">
              {domain.naturalKey.join(' + ')}
            </dd>
          </div>
          <div>
            <dt className="label">Load behaviour</dt>
            <dd className="mt-0.5 text-sm text-ink-900 dark:text-ink-100">
              Upsert — a matching key updates, otherwise inserts
            </dd>
          </div>
        </dl>

        <div className="rounded-md border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/40">
          <p className="text-2xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">
            What integrators get wrong on this feed
          </p>
          <ul className="mt-1.5 space-y-1">
            {domain.operatorNotes.map((note, i) => (
              <li key={i} className="flex gap-2 text-sm text-brand-900/90 dark:text-brand-100/90">
                <span aria-hidden className="text-brand-400">
                  •
                </span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="Fields"
          description="Column name, type, and what the platform does with it. Required fields are marked; a file missing one is rejected before any row is read."
        />
        <TableShell
          head={
            <>
              <th className="th">Column</th>
              <th className="th">Type</th>
              <th className="th">Required</th>
              <th className="th">Lands in</th>
              <th className="th">Meaning</th>
              <th className="th">Example</th>
            </>
          }
        >
          {domain.fields.map((f) => (
            <tr key={f.name} className={clsx(f.required && 'bg-brand-50/30 dark:bg-brand-950/20')}>
              <td className="td whitespace-nowrap">
                <span className="font-mono text-xs font-medium text-ink-900 dark:text-ink-100">{f.name}</span>
                {domain.naturalKey.includes(toCamel(f.name)) && (
                  <span className="ml-1.5 chip border-brand-200 bg-brand-50 text-2xs text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200">
                    key
                  </span>
                )}
              </td>
              <td className="td whitespace-nowrap text-xs">
                {f.type}
                {f.values && (
                  <span className="block max-w-[180px] truncate text-2xs text-ink-400" title={f.values.join(', ')}>
                    {f.values.join(' | ')}
                  </span>
                )}
                {(f.min != null || f.max != null) && (
                  <span className="block text-2xs text-ink-400">
                    {f.min != null ? `min ${f.min}` : ''}
                    {f.min != null && f.max != null ? ' · ' : ''}
                    {f.max != null ? `max ${f.max}` : ''}
                  </span>
                )}
              </td>
              <td className="td">
                {f.required ? (
                  <span className="chip border-critical-border bg-critical-bg text-2xs text-critical-text dark:border-red-900 dark:bg-critical-dark dark:text-red-200">
                    required
                  </span>
                ) : (
                  <span className="text-2xs text-ink-400">optional</span>
                )}
              </td>
              <td className="td whitespace-nowrap font-mono text-2xs text-ink-500">
                {f.reference ? (
                  <>
                    {f.reference.foreignKey}
                    <span className="block text-2xs text-ink-400">
                      ← {f.reference.entity}.{f.reference.lookupBy}
                    </span>
                  </>
                ) : (
                  toCamel(f.name)
                )}
              </td>
              <td className="td max-w-md text-xs text-ink-600 dark:text-ink-300">{f.description}</td>
              <td className="td whitespace-nowrap font-mono text-2xs text-ink-500">{f.example}</td>
            </tr>
          ))}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader
          title="Type rules"
          description="How each type is parsed, and what gets rejected."
        />
        <TableShell
          head={
            <>
              <th className="th">Type</th>
              <th className="th">Accepted</th>
              <th className="th">Rejected</th>
            </>
          }
        >
          {[
            ['string', 'Any text. Quoted fields may contain commas and newlines.', 'Nothing, unless the field is required and empty.'],
            ['integer', 'Whole numbers. Thousands separators are tolerated (1,250).', 'Decimals, and anything non-numeric.'],
            ['number', 'Decimals and whole numbers. Thousands separators tolerated.', 'Non-numeric text; values outside a declared min/max.'],
            ['boolean', 'true/false, 1/0, yes/no, y/n, t/f — any case.', 'Anything else, including blank where the field is required.'],
            ['date / datetime', 'ISO 8601 only: 2026-06-18 or 2026-06-18T10:30:00Z. A date with no timezone is read as UTC.', 'Ambiguous formats such as 06/18/2026 or 18-06-2026. These are rejected rather than guessed, because getting one wrong shifts a clinical window by a month.'],
            ['enum', 'One of the listed values, any case. Normalised to upper case on load.', 'Anything outside the list. The platform does not map synonyms.'],
            ['reference', 'A business code that exists in the platform — hospital code, MRN, specialty code.', 'Unknown codes. The loader never creates a placeholder record to satisfy a reference.'],
          ].map(([type, accepted, rejected]) => (
            <tr key={type}>
              <td className="td whitespace-nowrap font-mono text-xs font-medium text-ink-900 dark:text-ink-100">
                {type}
              </td>
              <td className="td max-w-md text-xs text-ink-600 dark:text-ink-300">{accepted}</td>
              <td className="td max-w-md text-xs text-ink-600 dark:text-ink-300">{rejected}</td>
            </tr>
          ))}
        </TableShell>
      </Card>

      <Card>
        <SectionHeader
          title="Load order"
          description="Feeds resolve references to one another, so sequence matters. Loading out of order rejects rows that would otherwise be valid."
        />
        <ol className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
          {[
            ['Reference data', 'Hospitals, departments, specialties, physicians, payers and the medication formulary. Everything else references these. Currently loaded by the platform seed rather than by a feed.'],
            ['Patients', 'Every clinical feed resolves its patient by MRN.'],
            ['Encounters', 'Laboratory results, diagnoses and claims may reference an encounter.'],
            ['Everything else', 'Laboratory, appointments, claims, pharmacy, surgery, referrals and diagnoses can load in any order once the above are in place.'],
          ].map(([title, detail], i) => (
            <li key={title} className="flex gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-2xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
                {i + 1}
              </span>
              <span>
                <strong className="font-medium text-ink-900 dark:text-ink-100">{title}.</strong> {detail}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
          Across all {count(DOMAINS.length)} feeds the platform accepts{' '}
          {count(DOMAINS.reduce((s, d) => s + d.fields.length, 0))} fields. Loads are idempotent on
          the natural key, so re-sending a file after a fix updates rather than duplicates.
        </p>
      </Card>
    </div>
  )
}

function toCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
