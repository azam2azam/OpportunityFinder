import Link from 'next/link'
import { getPrincipal } from '@/lib/auth'
import { landingRoute } from '@/lib/navigation'
import { Card } from '@/components/ui'
import type { SearchParams } from '@/lib/params'

export const dynamic = 'force-dynamic'

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const need = Array.isArray(params.need) ? params.need[0] : params.need
  const principal = await getPrincipal()

  return (
    <div className="mx-auto max-w-lg py-12">
      <Card>
        <h1 className="text-xl font-semibold text-ink-900 dark:text-ink-50">
          You do not have access to this module
        </h1>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
          Access here follows the minimum-necessary principle: each role sees only the modules its
          work requires. This is a permission boundary, not an error.
        </p>
        {need && (
          <dl className="mt-4 space-y-2 rounded-md bg-ink-50 p-3 text-sm dark:bg-ink-800/60">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500 dark:text-ink-400">Permission required</dt>
              <dd className="font-mono text-xs text-ink-900 dark:text-ink-100">{need}</dd>
            </div>
            {principal && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500 dark:text-ink-400">Your role</dt>
                <dd className="text-ink-900 dark:text-ink-100">{principal.roleName}</dd>
              </div>
            )}
          </dl>
        )}
        <p className="mt-4 text-xs text-ink-500 dark:text-ink-400">
          This attempt has been recorded in the audit trail. If you need this access, ask a platform
          administrator to review your role assignment.
        </p>
        <Link href={principal ? landingRoute(principal) : '/login'} className="btn btn-primary mt-5">
          Back to your dashboard
        </Link>
      </Card>
    </div>
  )
}
