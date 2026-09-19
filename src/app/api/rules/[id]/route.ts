import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getPrincipal } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { audit } from '@/lib/audit'

const schema = z.object({
  enabled: z.boolean().optional(),
  slaDays: z.number().int().min(1).max(365).optional(),
  clinicalUrgency: z.number().int().min(0).max(100).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Updates a detection rule's configuration.
 *
 * The whole point of the rules table is that thresholds are data. That makes
 * this endpoint a governance surface as much as a settings one: every change
 * bumps the rule version and records the before-and-after in the audit trail,
 * so an opportunity raised last month can be explained against the rule as it
 * was configured then rather than as it is now.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal()
  if (!principal) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  if (!can(principal, 'rules.edit')) {
    await audit(principal, {
      category: 'SECURITY',
      action: 'RULE_EDIT_DENIED',
      detail: { reason: 'missing rules.edit' },
      outcome: 'DENIED',
    })
    return NextResponse.json({ error: 'Your role cannot edit detection rules.' }, { status: 403 })
  }

  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid rule configuration.' }, { status: 400 })
  }

  const existing = await prisma.opportunityRule.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Rule not found.' }, { status: 404 })

  const { enabled, slaDays, clinicalUrgency, params } = parsed.data

  const updated = await prisma.opportunityRule.update({
    where: { id },
    data: {
      enabled: enabled ?? existing.enabled,
      slaDays: slaDays ?? existing.slaDays,
      clinicalUrgency: clinicalUrgency ?? existing.clinicalUrgency,
      params: params ? JSON.stringify(params) : existing.params,
      version: { increment: 1 },
      updatedBy: principal.email,
    },
  })

  await audit(principal, {
    category: 'RULE_CHANGE',
    action: 'RULE_UPDATED',
    entityType: 'OpportunityRule',
    entityId: id,
    detail: {
      ruleKey: existing.key,
      version: updated.version,
      before: {
        enabled: existing.enabled,
        slaDays: existing.slaDays,
        clinicalUrgency: existing.clinicalUrgency,
        params: existing.params,
      },
      after: {
        enabled: updated.enabled,
        slaDays: updated.slaDays,
        clinicalUrgency: updated.clinicalUrgency,
        params: updated.params,
      },
    },
  })

  return NextResponse.json({ ok: true, version: updated.version })
}
