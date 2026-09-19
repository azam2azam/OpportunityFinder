import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifyPassword, createSession, SESSION_COOKIE } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { role: true },
  })

  // One message for every failure mode. Distinguishing "no such user" from
  // "wrong password" would let anyone enumerate staff accounts.
  const invalid = () => NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })

  if (!user || !user.isActive) {
    await audit(null, {
      category: 'AUTH',
      action: 'LOGIN_FAILED',
      detail: { email, reason: user ? 'INACTIVE' : 'UNKNOWN_USER' },
      outcome: 'DENIED',
    })
    return invalid()
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    await audit(null, {
      category: 'AUTH',
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      detail: { email, reason: 'BAD_PASSWORD' },
      outcome: 'DENIED',
    })
    return invalid()
  }

  const token = await createSession(user.id)
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  await audit(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      title: user.title,
      roleKey: user.role.key,
      roleName: user.role.name,
      scopeLevel: user.role.scopeLevel as 'GROUP',
      permissions: [],
      primaryHospitalId: user.primaryHospitalId,
      hospitalIds: [],
      departmentScope: user.departmentScope,
    },
    { category: 'AUTH', action: 'LOGIN_SUCCESS', entityType: 'User', entityId: user.id }
  )

  const response = NextResponse.json({ ok: true, role: user.role.key })
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 3600,
  })
  return response
}
