import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { destroySession, getPrincipal, SESSION_COOKIE } from '@/lib/auth'
import { audit } from '@/lib/audit'

export async function POST() {
  const principal = await getPrincipal()
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value

  if (token) await destroySession(token)
  if (principal) {
    await audit(principal, { category: 'AUTH', action: 'LOGOUT', entityType: 'User', entityId: principal.userId })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return response
}
