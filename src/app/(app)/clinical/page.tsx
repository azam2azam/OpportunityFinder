import { guard } from '@/lib/guard'
import { OpportunityModule } from '@/components/OpportunityModule'
import type { SearchParams } from '@/lib/params'
import { one } from '@/lib/params'

export const dynamic = 'force-dynamic'

/**
 * Clinical Opportunities.
 *
 * Pinned to the three clinical categories rather than to one, because the
 * clinical question — which patients have an unclosed loop in their care — cuts
 * across laboratory, surgical and medication findings. A category filter inside
 * the module still narrows it further.
 */
export default async function ClinicalOpportunities({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('opportunity.view.clinical')
  const params = await searchParams

  // Within the clinical set the user may still pick one category; anything
  // outside the set is ignored rather than honoured.
  const requested = one(params, 'category')
  const clinical = ['LAB', 'SURGERY', 'MEDICATION']
  const category = requested && clinical.includes(requested) ? requested : undefined

  return (
    <OpportunityModule
      principal={principal}
      params={{ ...params, category }}
      title="Clinical Opportunities"
      question="Which patients have an open clinical loop?"
      description="Abnormal results without follow-up, surgical recommendations that never reached theatre, and medication gaps. Clinical opportunities support the treating team — they never constitute a clinical decision."
      pinned={{ categories: clinical, ...(category ? { category } : {}) }}
      lockedFilters={category ? ['category'] : []}
      columns={[
        'priority', 'title', 'patient', 'category', 'specialty',
        'physician', 'score', 'status', 'sla',
      ]}
      footer={
        <p className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
          Clinical opportunities are decision support, not decisions. Every finding here is a
          pattern in recorded data — a missing encounter, an unrepeated test, an uncollected
          refill — and needs a qualified clinician to judge whether action is appropriate for this
          patient. The platform does not autonomously contact patients about clinical findings.
        </p>
      }
    />
  )
}
