import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPrincipal } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { ingestCsv } from '@/lib/ingestion/run'

// Loading a large extract row by row takes longer than the default timeout.
export const maxDuration = 300

// 12 MB of CSV is roughly 60,000 clinical rows. Beyond that the file belongs in
// an automated connector, not in a browser upload.
const MAX_CSV_BYTES = 12 * 1024 * 1024

const schema = z.object({
  pipelineId: z.string().min(1),
  fileName: z.string().max(260),
  csv: z.string().min(1),
  dryRun: z.boolean(),
})

/**
 * Validates or commits an uploaded CSV.
 *
 * Committing writes patient data, so it is audited as a PHI-handling action
 * with the row counts attached — "who loaded what, when, and how much of it
 * was rejected" has to be answerable afterwards.
 */
export async function POST(request: Request) {
  const principal = await getPrincipal()
  if (!principal) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  if (!can(principal, 'integration.ingest')) {
    await audit(principal, {
      category: 'SECURITY',
      action: 'INGEST_DENIED',
      detail: { reason: 'missing integration.ingest' },
      outcome: 'DENIED',
    })
    return NextResponse.json({ error: 'Your role cannot ingest data.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'A pipeline, file name and CSV body are required.' }, { status: 400 })
  }

  const { pipelineId, fileName, csv, dryRun } = parsed.data

  const bytes = Buffer.byteLength(csv, 'utf8')
  if (bytes > MAX_CSV_BYTES) {
    return NextResponse.json(
      {
        error: `The file is ${(bytes / 1024 / 1024).toFixed(1)} MB, above the ${MAX_CSV_BYTES / 1024 / 1024} MB upload limit. Split it, or move this feed to an automated connector.`,
      },
      { status: 413 }
    )
  }

  try {
    const outcome = await ingestCsv({
      pipelineId,
      csv,
      fileName,
      dryRun,
      triggeredBy: `${principal.email} (${principal.roleKey})`,
    })

    await audit(principal, {
      // A dry run touches no data; a commit writes patient records and is
      // categorised accordingly.
      category: dryRun ? 'ADMIN' : 'PHI_ACCESS',
      action: dryRun ? 'INGEST_DRY_RUN' : 'INGEST_COMMIT',
      entityType: 'IngestionRun',
      entityId: outcome.runId ?? undefined,
      detail: {
        pipeline: outcome.pipelineKey,
        domain: outcome.domain,
        fileName,
        bytes,
        recordsRead: outcome.load.recordsRead,
        recordsInserted: outcome.load.recordsInserted,
        recordsUpdated: outcome.load.recordsUpdated,
        recordsRejected: outcome.load.recordsRejected,
        status: outcome.status,
      },
      outcome: outcome.status === 'FAILED' ? 'ERROR' : 'SUCCESS',
    })

    return NextResponse.json({
      ok: true,
      runId: outcome.runId,
      status: outcome.status,
      dryRun,
      load: outcome.load,
      quality: outcome.quality.map((q) => ({
        name: q.name,
        passed: q.passed,
        measuredValue: q.measuredValue,
        threshold: q.threshold,
        severity: q.severity,
        remediation: q.remediation,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed.'
    await audit(principal, {
      category: 'ADMIN',
      action: 'INGEST_FAILED',
      detail: { pipelineId, fileName, message },
      outcome: 'ERROR',
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
