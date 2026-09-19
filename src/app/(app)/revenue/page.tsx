import { guard } from '@/lib/guard'
import { OpportunityModule } from '@/components/OpportunityModule'
import type { SearchParams } from '@/lib/params'

export const dynamic = 'force-dynamic'

export default async function RevenueOpportunities({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const principal = await guard('opportunity.view.financial')
  const params = await searchParams

  return (
    <OpportunityModule
      principal={principal}
      params={params}
      title="Revenue Opportunities"
      question="Where is the recoverable and realisable revenue?"
      description="Every open opportunity ranked by financial value — recoverable claims, unbooked procedures, unused clinic capacity and lapsed high-value patients."
      pinned={{ minScore: undefined }}
      columns={[
        'priority', 'title', 'category', 'hospital', 'specialty',
        'value', 'realised', 'status', 'owner', 'age',
      ]}
    />
  )
}
