import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPrincipal } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { ask } from '@/lib/nlsql'
import { audit } from '@/lib/audit'

const schema = z.object({ question: z.string().min(1).max(500) })

export async function POST(request: Request) {
  const principal = await getPrincipal()
  if (!principal) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  if (!can(principal, 'askdata.use')) {
    await audit(principal, {
      category: 'SECURITY',
      action: 'ASK_DATA_DENIED',
      detail: { reason: 'missing askdata.use' },
      outcome: 'DENIED',
    })
    return NextResponse.json({ error: 'Your role cannot use Ask Data.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'A question is required.' }, { status: 400 })
  }

  const result = await ask(principal, parsed.data.question)
  return NextResponse.json(result)
}
