import 'server-only'
import { redirect } from 'next/navigation'
import { getPrincipal } from './auth'
import type { Permission, Principal } from './rbac'

/**
 * Page-level access guard.
 *
 * Denied users are redirected to /forbidden rather than shown a stripped-down
 * page. A partially-rendered page invites the reader to wonder what is missing;
 * an explicit refusal, naming the permission, is more honest and easier to
 * resolve with an administrator.
 */
export async function guard(permission: Permission): Promise<Principal> {
  const principal = await getPrincipal()
  if (!principal) redirect('/login')
  if (!principal.permissions.includes(permission)) {
    redirect(`/forbidden?need=${encodeURIComponent(permission)}`)
  }
  return principal
}

/** For pages reachable by several permissions (any one is enough). */
export async function guardAny(permissions: Permission[]): Promise<Principal> {
  const principal = await getPrincipal()
  if (!principal) redirect('/login')
  if (!permissions.some((p) => principal.permissions.includes(p))) {
    redirect(`/forbidden?need=${encodeURIComponent(permissions.join(' or '))}`)
  }
  return principal
}
