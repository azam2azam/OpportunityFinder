import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getPrincipal } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { runDetection } from '@/lib/detection/engine'

// A full run scans every patient; the default serverless timeout is not enough.
export const maxDuration = 300

/**
 * Triggers a detection run.
 *
 * Hospital-scoped users run detection over their own hospital only. That is not
 * just an access control — running the group-wide scan from a single hospital's
 * console would produce opportunities its staff cannot see, which looks like
 * the run silently failed.
 */
export async function POST() {
  const principal = await getPrincipal()
  if (!principal) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  if (!can(principal, 'detection.run')) {
    await audit(principal, {
      category: 'SECURITY',
      action: 'DETECTION_RUN_DENIED',
      detail: { reason: 'missing detection.run' },
      outcome: 'DENIED',
    })
    return NextResponse.json({ error: 'Your role cannot trigger detection runs.' }, { status: 403 })
  }

  const hospitalId =
    principal.scopeLevel === 'GROUP'
      ? undefined
      : (principal.primaryHospitalId ?? principal.hospitalIds[0])

  try {
    const result = await runDetection(prisma, {
      triggeredBy: `${principal.email} (${principal.roleKey})`,
      hospitalId,
    })

    await audit(principal, {
      category: 'ADMIN',
      action: 'DETECTION_RUN',
      entityType: 'DetectionRun',
      entityId: result.runId,
      hospitalId,
      detail: result.totals,
    })

    return NextResponse.json({ ok: true, runId: result.runId, totals: result.totals, stats: result.stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Detection failed.'
    await audit(principal, {
      category: 'ADMIN',
      action: 'DETECTION_RUN_FAILED',
      detail: { message },
      outcome: 'ERROR',
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
