import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getPrincipal } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { SCORING_FACTORS } from '@/lib/enums'

const schema = z.object({
  modelId: z.string(),
  weights: z.record(z.string(), z.number().min(0).max(100)),
  thresholds: z
    .object({
      CRITICAL: z.number().min(0).max(100),
      HIGH: z.number().min(0).max(100),
      MEDIUM: z.number().min(0).max(100),
    })
    .optional(),
  activate: z.boolean().optional(),
})

/**
 * Updates the scoring model.
 *
 * Weights and priority bands are the model. Changing them re-prioritises the
 * entire pipeline on the next detection run, which is powerful enough that the
 * before-and-after is recorded in full — "why did everything become high
 * priority last Tuesday" needs to be answerable.
 */
export async function PATCH(request: Request) {
  const principal = await getPrincipal()
  if (!principal) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  if (!can(principal, 'scoring.edit')) {
    await audit(principal, {
      category: 'SECURITY',
      action: 'SCORING_EDIT_DENIED',
      detail: { reason: 'missing scoring.edit' },
      outcome: 'DENIED',
    })
    return NextResponse.json({ error: 'Your role cannot edit the scoring model.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid scoring configuration.' }, { status: 400 })
  }
  const { modelId, weights, thresholds, activate } = parsed.data

  // Unknown factor names would be stored and silently ignored by the scorer,
  // which is worse than refusing them.
  const unknown = Object.keys(weights).filter(
    (f) => !(SCORING_FACTORS as readonly string[]).includes(f)
  )
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown scoring factors: ${unknown.join(', ')}.` },
      { status: 400 }
    )
  }

  // A model with every weight at zero scores everything identically, which
  // silently destroys prioritisation across the whole platform.
  const sum = Object.values(weights).reduce((s, w) => s + w, 0)
  if (sum <= 0) {
    return NextResponse.json(
      { error: 'At least one factor must carry a non-zero weight.' },
      { status: 400 }
    )
  }

  if (thresholds && !(thresholds.CRITICAL > thresholds.HIGH && thresholds.HIGH > thresholds.MEDIUM)) {
    return NextResponse.json(
      { error: 'Priority bands must decrease: CRITICAL > HIGH > MEDIUM.' },
      { status: 400 }
    )
  }

  const existing = await prisma.scoringModel.findUnique({
    where: { id: modelId },
    include: { weights: true },
  })
  if (!existing) return NextResponse.json({ error: 'Scoring model not found.' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    for (const [factor, weight] of Object.entries(weights)) {
      await tx.scoringWeight.upsert({
        where: { modelId_factor: { modelId, factor } },
        create: { modelId, factor, weight },
        update: { weight },
      })
    }
    await tx.scoringModel.update({
      where: { id: modelId },
      data: {
        thresholds: thresholds ? JSON.stringify(thresholds) : existing.thresholds,
        updatedBy: principal.email,
      },
    })
    if (activate) {
      // Exactly one model is active at a time; the scorer reads the active one.
      await tx.scoringModel.updateMany({ where: { id: { not: modelId } }, data: { isActive: false } })
      await tx.scoringModel.update({ where: { id: modelId }, data: { isActive: true } })
    }
  })

  await audit(principal, {
    category: 'SCORING_CHANGE',
    action: 'SCORING_MODEL_UPDATED',
    entityType: 'ScoringModel',
    entityId: modelId,
    detail: {
      modelName: existing.name,
      activated: activate ?? false,
      before: {
        weights: Object.fromEntries(existing.weights.map((w) => [w.factor, w.weight])),
        thresholds: existing.thresholds,
      },
      after: { weights, thresholds },
    },
  })

  return NextResponse.json({ ok: true })
}
