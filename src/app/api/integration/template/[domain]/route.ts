import { getPrincipal } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { DOMAIN_BY_KEY, templateHeader, templateExampleRow } from '@/lib/ingestion/domains'

/**
 * CSV template for a feed.
 *
 * Generated from the domain contract, so the header row is always exactly what
 * the loader accepts. The example row is included because a header-only
 * template leaves the integrator guessing at formats — and date format is the
 * single most common reason a first upload fails.
 */
export async function GET(_request: Request, context: { params: Promise<{ domain: string }> }) {
  const principal = await getPrincipal()
  if (!principal) return new Response('Not authenticated.', { status: 401 })
  if (!can(principal, 'integration.view')) {
    return new Response('Your role cannot access integration tooling.', { status: 403 })
  }

  const { domain: domainKey } = await context.params
  const domain = DOMAIN_BY_KEY[domainKey.toUpperCase()]
  if (!domain) return new Response('Unknown feed.', { status: 404 })

  const csv = [templateHeader(domain), templateExampleRow(domain)].join('\r\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="opportuna-${domain.key.toLowerCase()}-template.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
