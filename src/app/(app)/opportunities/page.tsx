import { guard } from '@/lib/guard'
import { OpportunityModule } from '@/components/OpportunityModule'
import type { SearchParams } from '@/lib/params'

export const dynamic = 'force-dynamic'

export default async function OpportunityCenter({
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
      title="Opportunity Center"
      question="Which opportunities matter most right now?"
      description="Every detected opportunity in your scope, ranked by score. Filter by type, priority, hospital or ownership; every filter state has its own shareable link."
      columns={[
        'priority', 'title', 'patient', 'category', 'hospital',
        'value', 'score', 'status', 'owner', 'sla',
      ]}
    />
  )
}
