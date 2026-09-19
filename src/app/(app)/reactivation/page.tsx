import { guard } from '@/lib/guard'
import { OpportunityModule } from '@/components/OpportunityModule'
import type { SearchParams } from '@/lib/params'

export const dynamic = 'force-dynamic'

export default async function PatientReactivation({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('opportunity.view')
  const params = await searchParams

  return (
    <OpportunityModule
      principal={principal}
      params={params}
      title="Patient Reactivation"
      question="Which patients have we lost, and which are worth bringing back?"
      description="Previously active patients who have stopped attending — chronic-disease patients past their care interval, lapsed specialist patterns, post-surgical patients never followed up, and high-value patients now inactive."
      pinned={{ category: 'REACTIVATION' }}
      lockedFilters={['category']}
      columns={[
        'priority', 'title', 'patient', 'hospital', 'specialty',
        'value', 'score', 'status', 'owner', 'age',
      ]}
      footer={
        <p className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
          Reactivation outreach only reaches patients who are contactable and have consented to
          contact. Patients who have opted out are excluded at detection, so they never appear in
          this list and cannot be added to a campaign from it.
        </p>
      }
    />
  )
}
