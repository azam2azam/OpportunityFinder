import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getPrincipal } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { scopeWhere } from '@/lib/queries'
import { can } from '@/lib/rbac'
import { ACTION_TYPES, OPPORTUNITY_STATUSES, isTerminal, statusRank } from '@/lib/enums'

const schema = z.object({
  type: z.enum(ACTION_TYPES),
  toStatus: z.enum(OPPORTUNITY_STATUSES).optional(),
  note: z.string().max(2000).optional(),
})

/**
 * Records an action against an opportunity and, where the action carries one,
 * advances its status.
 *
 * Three things are enforced server-side rather than trusted from the client:
 * the caller's permission, the opportunity being inside their scope, and the
 * transition being legal. The UI already hides invalid actions, but the UI is
 * not a security boundary.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal()
  if (!principal) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }
  if (!can(principal, 'opportunity.act')) {
    await audit(principal, {
      category: 'SECURITY',
      action: 'ACTION_DENIED',
      entityType: 'Opportunity',
      detail: { reason: 'missing opportunity.act' },
      outcome: 'DENIED',
    })
    return NextResponse.json({ error: 'Your role cannot act on opportunities.' }, { status: 403 })
  }

  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid action.', detail: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const { type, toStatus, note } = parsed.data

  // Scoped fetch: an opportunity at another hospital must be unreachable, not
  // merely unauthorised.
  const opportunity = await prisma.opportunity.findFirst({
    where: { AND: [{ id }, scopeWhere(principal, {})] },
    select: {
      id: true, status: true, hospitalId: true, patientId: true, reference: true,
      potentialValue: true, detectedAt: true, ownerUserId: true, category: true,
    },
  })
  if (!opportunity) {
    return NextResponse.json({ error: 'Opportunity not found.' }, { status: 404 })
  }

  if (isTerminal(opportunity.status)) {
    return NextResponse.json(
      { error: 'This opportunity is closed and cannot be modified.' },
      { status: 409 }
    )
  }

  if (toStatus) {
    const closing = isTerminal(toStatus)
    if (closing && !can(principal, 'opportunity.close')) {
      return NextResponse.json({ error: 'Your role cannot close opportunities.' }, { status: 403 })
    }
    // Progress must move forward. Allowing a backward jump would let the funnel
    // be rewritten after the fact, and conversion rates would stop meaning
    // anything. Closing is exempt — work can be abandoned from any stage.
    if (!closing && statusRank(toStatus) < statusRank(opportunity.status)) {
      return NextResponse.json(
        {
          error: `Cannot move from ${opportunity.status} back to ${toStatus}. Close the opportunity instead if it is no longer applicable.`,
        },
        { status: 409 }
      )
    }
    if (type === 'CLOSE' && !note) {
      return NextResponse.json({ error: 'Closing requires a reason.' }, { status: 400 })
    }
  }

  const now = new Date()
  const converting = toStatus === 'CONVERTED'
  const closing = toStatus ? isTerminal(toStatus) : false

  // Claiming an unowned opportunity assigns it to the actor; this is the only
  // path by which ownership is set from the UI.
  const takingOwnership =
    (type === 'ASSIGN' || opportunity.ownerUserId === null) && can(principal, 'opportunity.assign')

  const result = await prisma.$transaction(async (tx) => {
    const action = await tx.opportunityAction.create({
      data: {
        opportunityId: opportunity.id,
        type,
        performedById: principal.userId,
        performedAt: now,
        note,
        fromStatus: opportunity.status,
        toStatus: toStatus ?? opportunity.status,
      },
    })

    const updated = await tx.opportunity.update({
      where: { id: opportunity.id },
      data: {
        status: toStatus ?? opportunity.status,
        lastActionAt: now,
        nextActionAt: closing ? null : new Date(now.getTime() + 3 * 86_400_000),
        ownerUserId: takingOwnership ? principal.userId : opportunity.ownerUserId,
        ownerTeam: takingOwnership ? principal.roleKey : undefined,
        closedAt: closing ? now : undefined,
        outcome: closing ? toStatus : undefined,
        outcomeNote: closing ? note : undefined,
        // Realised value is only recognised on conversion. Estimating it
        // earlier would let the recovered-revenue figure count money that has
        // not arrived.
        realisedValue: converting ? opportunity.potentialValue : undefined,
      },
    })

    if (converting) {
      const daysToConvert = Math.max(
        1,
        Math.floor((now.getTime() - opportunity.detectedAt.getTime()) / 86_400_000)
      )
      await tx.conversion.upsert({
        where: { opportunityId: opportunity.id },
        create: {
          opportunityId: opportunity.id,
          convertedAt: now,
          conversionType: conversionTypeFor(opportunity.category),
          revenue: opportunity.potentialValue,
          daysToConvert,
          attributedUserId: principal.userId,
        },
        update: {
          convertedAt: now,
          revenue: opportunity.potentialValue,
          daysToConvert,
          attributedUserId: principal.userId,
        },
      })
    }

    return { action, updated }
  })

  await audit(principal, {
    category: 'OPPORTUNITY',
    action: `ACTION_${type}`,
    entityType: 'Opportunity',
    entityId: opportunity.id,
    patientId: opportunity.patientId ?? undefined,
    hospitalId: opportunity.hospitalId,
    detail: {
      reference: opportunity.reference,
      fromStatus: opportunity.status,
      toStatus: toStatus ?? opportunity.status,
      note,
    },
  })

  return NextResponse.json({
    ok: true,
    status: result.updated.status,
    actionId: result.action.id,
  })
}

function conversionTypeFor(category: string): string {
  switch (category) {
    case 'INSURANCE':
      return 'CLAIM_RECOVERED'
    case 'SURGERY':
      return 'SURGERY'
    case 'MEDICATION':
      return 'REFILL'
    case 'REACTIVATION':
      return 'REACTIVATION'
    case 'SERVICE_LINE':
      return 'TREATMENT'
    default:
      return 'APPOINTMENT'
  }
}
