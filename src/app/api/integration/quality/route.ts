import { NextResponse } from 'next/server'
import { getPrincipal } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { evaluateQuality } from '@/lib/ingestion/quality'

export const maxDuration = 120

/** Re-runs every enabled data-quality check against what is currently loaded. */
export async function POST() {
  const principal = await getPrincipal()
  if (!principal) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  if (!can(principal, 'integration.manage')) {
    await audit(principal, {
      category: 'SECURITY',
      action: 'QUALITY_RUN_DENIED',
      detail: { reason: 'missing integration.manage' },
      outcome: 'DENIED',
    })
    return NextResponse.json({ error: 'Your role cannot run quality evaluation.' }, { status: 403 })
  }

  try {
    const results = await evaluateQuality({ persist: true })
    const failed = results.filter((r) => !r.passed)

    await audit(principal, {
      category: 'ADMIN',
      action: 'QUALITY_EVALUATED',
      detail: {
        evaluated: results.length,
        failed: failed.length,
        failing: failed.map((f) => f.ruleKey),
      },
    })

    return NextResponse.json({
      ok: true,
      evaluated: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Quality evaluation failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
