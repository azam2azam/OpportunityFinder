import { guard } from '@/lib/guard'
import { OpportunityModule } from '@/components/OpportunityModule'
import type { SearchParams } from '@/lib/params'

export const dynamic = 'force-dynamic'

/**
 * Follow-up & Treatment Gaps — the appointment-driven view.
 *
 * Distinct from Clinical Opportunities: this is about the scheduling loop
 * (missed, cancelled, never booked, interval exceeded) rather than the clinical
 * finding behind it, and it is worked by the access team rather than by
 * clinicians.
 */
export default async function FollowUpGaps({
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
      title="Follow-up & Treatment Gaps"
      question="Who was meant to come back and has not?"
      description="Missed appointments never rebooked, repeated cancellations, physician follow-up intervals exceeded, referrals issued but never booked or left to expire, and bookings that were never reconciled."
      pinned={{ categories: ['APPOINTMENT', 'REFERRAL'] }}

      columns={[
        'priority', 'title', 'patient', 'specialty', 'physician',
        'value', 'score', 'status', 'owner', 'sla',
      ]}
    />
  )
}
