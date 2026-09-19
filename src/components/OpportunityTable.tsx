import Link from 'next/link'
import clsx from 'clsx'
import { money, relative, shortDate } from '@/lib/format'
import { isTerminal, CATEGORY_LABEL } from '@/lib/enums'
import { projectPatient, can, type Principal } from '@/lib/rbac'
import type { OpportunityListItem } from '@/lib/queries'
import {
  TableShell, PriorityBadge, StatusBadge, CategoryBadge, ScorePill, SlaBadge, EmptyState,
} from './ui'

/**
 * The opportunity list, reused by every module that shows opportunities.
 *
 * Patient identity is projected through `projectPatient` here rather than at
 * each call site, so a page cannot forget to mask. Columns are configurable
 * because the same rows answer different questions: the insurance module cares
 * about recoverable amount and payer, the clinical module about urgency and
 * the physician who owns the follow-up.
 */
export type Column =
  | 'reference'
  | 'priority'
  | 'score'
  | 'title'
  | 'category'
  | 'patient'
  | 'hospital'
  | 'specialty'
  | 'physician'
  | 'value'
  | 'realised'
  | 'status'
  | 'owner'
  | 'age'
  | 'sla'
  | 'action'

const DEFAULT_COLUMNS: Column[] = [
  'priority', 'title', 'patient', 'category', 'value', 'score', 'status', 'owner', 'sla',
]

export function OpportunityTable({
  principal,
  items,
  columns = DEFAULT_COLUMNS,
  emptyTitle = 'No opportunities match these filters',
  emptyDescription = 'Widen the filters, or run detection if the pipeline has not been populated yet.',
}: {
  principal: Principal
  items: OpportunityListItem[]
  columns?: Column[]
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  const showPhi = can(principal, 'patient.view.phi')

  const head = columns.map((c) => (
    <th key={c} scope="col" className={clsx('th', NUMERIC.has(c) && 'text-right')}>
      {HEADINGS[c]}
    </th>
  ))

  return (
    <TableShell head={head} caption="Opportunities">
      {items.map((o) => {
        const closed = isTerminal(o.status)
        const patient = o.patient ? projectPatient(principal, o.patient) : null
        return (
          <tr key={o.id} className="row-link">
            {columns.map((c) => (
              <td key={c} className={clsx('td', NUMERIC.has(c) && 'text-right tabular')}>
                {renderCell(c, o, patient, closed, showPhi)}
              </td>
            ))}
          </tr>
        )
      })}
    </TableShell>
  )
}

const NUMERIC = new Set<Column>(['value', 'realised', 'score', 'age'])

const HEADINGS: Record<Column, string> = {
  reference: 'Reference',
  priority: 'Priority',
  score: 'Score',
  title: 'Opportunity',
  category: 'Type',
  patient: 'Patient',
  hospital: 'Hospital',
  specialty: 'Specialty',
  physician: 'Physician',
  value: 'Potential',
  realised: 'Realised',
  status: 'Status',
  owner: 'Owner',
  age: 'Age',
  sla: 'SLA',
  action: 'Recommended action',
}

function renderCell(
  column: Column,
  o: OpportunityListItem,
  patient: (NonNullable<OpportunityListItem['patient']> & { displayName: string }) | null,
  closed: boolean,
  showPhi: boolean
) {
  switch (column) {
    case 'reference':
      return (
        <Link href={`/opportunities/${o.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-300">
          {o.reference}
        </Link>
      )
    case 'priority':
      return <PriorityBadge priority={o.priority} />
    case 'score':
      return <ScorePill score={o.score} />
    case 'title':
      return (
        <Link href={`/opportunities/${o.id}`} className="group block max-w-md">
          <span className="block truncate font-medium text-ink-900 group-hover:text-brand-700 dark:text-ink-100 dark:group-hover:text-brand-300">
            {o.title}
          </span>
          <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
            {o.reference} · detected {relative(o.detectedAt)}
          </span>
        </Link>
      )
    case 'category':
      return (
        <CategoryBadge
          category={o.category}
          label={CATEGORY_LABEL[o.category as keyof typeof CATEGORY_LABEL]}
        />
      )
    case 'patient':
      if (!patient) {
        // Service-line and repeat-rejection opportunities are about a clinic or
        // a process, not a person. Saying so beats an empty cell.
        return <span className="text-xs italic text-ink-400">Aggregate — no patient</span>
      }
      return (
        <div className="max-w-[180px]">
          <span className={clsx('block truncate text-sm', showPhi ? 'text-ink-900 dark:text-ink-100' : 'text-ink-500')}>
            {patient.displayName}
          </span>
          <span className="block truncate font-mono text-2xs text-ink-400">{patient.mrn}</span>
        </div>
      )
    case 'hospital':
      return <span className="whitespace-nowrap text-sm">{o.hospital.name}</span>
    case 'specialty':
      return <span className="whitespace-nowrap text-sm">{o.specialty?.name ?? '—'}</span>
    case 'physician':
      return <span className="whitespace-nowrap text-sm">{o.physician?.name ?? '—'}</span>
    case 'value':
      return <span className="font-medium text-ink-900 dark:text-ink-100">{money(o.potentialValue)}</span>
    case 'realised':
      return o.realisedValue > 0 ? (
        <span className="font-medium text-positive-600 dark:text-positive-500">{money(o.realisedValue)}</span>
      ) : (
        <span className="text-ink-400">—</span>
      )
    case 'status':
      return <StatusBadge status={o.status} />
    case 'owner':
      return o.owner ? (
        <span className="whitespace-nowrap text-sm">{o.owner.name}</span>
      ) : (
        <span className="chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20">
          Unassigned
        </span>
      )
    case 'age':
      return (
        <span className="text-sm text-ink-600 dark:text-ink-300">
          {Math.max(0, Math.floor((Date.now() - o.detectedAt.getTime()) / 86_400_000))}d
        </span>
      )
    case 'sla':
      return <SlaBadge dueAt={o.slaDueAt} closed={closed} />
    case 'action':
      return (
        <span className="block max-w-sm truncate text-xs text-ink-600 dark:text-ink-300" title={o.recommendedAction}>
          {o.recommendedAction}
        </span>
      )
    default:
      return null
  }
}

/** Compact variant for dashboard panels where only the top few matter. */
export function OpportunityMiniList({
  principal,
  items,
  emptyLabel = 'Nothing outstanding',
}: {
  principal: Principal
  items: OpportunityListItem[]
  emptyLabel?: string
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-400">{emptyLabel}</p>
  }
  return (
    <ul className="divide-y divide-ink-100 dark:divide-ink-800">
      {items.map((o) => {
        const patient = o.patient ? projectPatient(principal, o.patient) : null
        return (
          <li key={o.id}>
            <Link
              href={`/opportunities/${o.id}`}
              className="flex items-start gap-3 px-1 py-2.5 transition-colors hover:bg-brand-50/60 dark:hover:bg-ink-800/60"
            >
              <PriorityBadge priority={o.priority} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900 dark:text-ink-100">
                  {o.title}
                </span>
                <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                  {patient ? `${patient.displayName} · ` : ''}
                  {o.hospital.name} · detected {shortDate(o.detectedAt)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block tabular text-sm font-medium text-ink-900 dark:text-ink-100">
                  {money(o.potentialValue)}
                </span>
                <span className="block text-2xs text-ink-400">score {o.score.toFixed(0)}</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
