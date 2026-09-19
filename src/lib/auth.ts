import 'server-only'
import { cookies, headers } from 'next/headers'
import { randomBytes } from 'crypto'
import { prisma } from './db'
import { hashPassword, verifyPassword } from './password'
import { ROLE_BY_KEY, type Permission, type Principal, type ScopeLevel } from './rbac'

export const SESSION_COOKIE = 'opportuna_session'
const SESSION_TTL_HOURS = 12

// Re-exported so callers have one auth import; the implementation lives in
// password.ts because scripts outside Next cannot import a server-only module.
export { hashPassword, verifyPassword }

export async function createSession(userId: string, ip?: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000)
  await prisma.session.create({ data: { userId, token, expiresAt, ip } })
  return token
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } })
}

/**
 * Resolves the caller into a Principal, collapsing role permissions and
 * hospital scope into one object so downstream code never re-queries roles.
 *
 * Returns null for anonymous or expired sessions; callers must treat null as
 * "not signed in" rather than "no permissions", because the two need different
 * responses (redirect vs 403).
 */
export async function getPrincipal(): Promise<Principal | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  // Session carries only a userId (no declared relation, to keep the table
  // portable), so the user is fetched separately below.
  const session = await prisma.session.findUnique({ where: { token } })
  if (!session || session.expiresAt < new Date()) return null

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true, hospitalScopes: true },
  })
  if (!user || !user.isActive) return null

  const definition = ROLE_BY_KEY[user.role.key]
  const permissions: Permission[] = definition
    ? definition.permissions
    : (JSON.parse(user.role.permissions) as Permission[])

  const scoped = user.hospitalScopes.map((s) => s.hospitalId)
  const hospitalIds =
    scoped.length > 0
      ? scoped
      : user.primaryHospitalId
        ? [user.primaryHospitalId]
        : []

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    title: user.title,
    roleKey: user.role.key,
    roleName: user.role.name,
    scopeLevel: user.role.scopeLevel as ScopeLevel,
    permissions,
    primaryHospitalId: user.primaryHospitalId,
    hospitalIds,
    departmentScope: user.departmentScope,
  }
}

/** Throws for unauthenticated callers — used by route handlers and pages. */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal()
  if (!principal) throw new AuthError('NOT_AUTHENTICATED')
  return principal
}

export async function requirePermission(permission: Permission): Promise<Principal> {
  const principal = await requirePrincipal()
  if (!principal.permissions.includes(permission)) {
    throw new AuthError('FORBIDDEN', permission)
  }
  return principal
}

export class AuthError extends Error {
  constructor(
    public code: 'NOT_AUTHENTICATED' | 'FORBIDDEN',
    public detail?: string
  ) {
    super(code === 'NOT_AUTHENTICATED' ? 'Not authenticated' : `Forbidden: ${detail}`)
    this.name = 'AuthError'
  }
}

/** Client metadata for the audit trail. */
export async function requestContext(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers()
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  }
}
