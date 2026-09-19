/*
 * Not marked 'server-only': the reset pipeline and operational scripts invoke
 * this from the command line, as they do the detection engine. Web access is
 * gated at the route handlers and layouts that call it.
 */
import { prisma } from '../db'

/**
 * Per-feed freshness and quality, summarised for the provenance bar.
 *
 * One query set, read once per request in the app shell and shared by every
 * page — the bar appears on all of them, so this must not cost a query per
 * page or per feed.
 */

export interface FeedStatus {
  domain: string
  sourceName: string
  sourceCode: string
  connectionMode: string
  lastRunAt: Date | null
  lastRecords: number
  /** OK | STALE | DEGRADED | NEVER */
  state: 'OK' | 'STALE' | 'DEGRADED' | 'NEVER'
  slaMinutes: number
  rejectRate: number
  qualityFailures: number
  criticalQualityFailures: number
}

export async function getFeedStatus(): Promise<Record<string, FeedStatus>> {
  const [pipelines, runs, qualityResults] = await Promise.all([
    // Manual upload pipelines exist for every domain and never run on a
    // schedule; including them would make every feed look permanently stale.
    prisma.ingestionPipeline.findMany({
      where: { sourceSystem: { connectionMode: { not: 'MANUAL_UPLOAD' } } },
      include: { sourceSystem: { select: { name: true, code: true, connectionMode: true } } },
    }),
    prisma.ingestionRun.findMany({
      where: { startedAt: { gte: new Date(Date.now() - 14 * 86_400_000) }, dryRun: false },
      orderBy: { startedAt: 'desc' },
      select: {
        pipelineId: true, startedAt: true, status: true,
        recordsRead: true, recordsRejected: true, recordsInserted: true, recordsUpdated: true,
      },
    }),
    prisma.dataQualityResult.findMany({
      orderBy: { evaluatedAt: 'desc' },
      take: 200,
      include: { rule: { select: { id: true, pipelineId: true, severity: true } } },
    }),
  ])

  // Latest quality result per rule; earlier ones are history, not extra failures.
  const seenRule = new Set<string>()
  const currentQuality = qualityResults.filter((r) => {
    if (seenRule.has(r.ruleId)) return false
    seenRule.add(r.ruleId)
    return true
  })

  const out: Record<string, FeedStatus> = {}

  for (const pipeline of pipelines) {
    const pipelineRuns = runs.filter((r) => r.pipelineId === pipeline.id)
    const last = pipelineRuns[0] ?? null
    const read = last?.recordsRead ?? 0

    const failures = currentQuality.filter(
      (q) => q.rule.pipelineId === pipeline.id && !q.passed
    )

    // Three missed cycles is a fault; one is noise. Measured against the
    // pipeline's own SLA so a nightly feed and a 15-minute feed are judged
    // on their own terms.
    const staleAfter = pipeline.slaMinutes * 60_000 * 3
    const state: FeedStatus['state'] = !last
      ? 'NEVER'
      : Date.now() - last.startedAt.getTime() > staleAfter
        ? 'STALE'
        : last.status === 'FAILED' || (read > 0 && (last.recordsRejected ?? 0) / read > 0.1)
          ? 'DEGRADED'
          : 'OK'

    out[pipeline.domain] = {
      domain: pipeline.domain,
      sourceName: pipeline.sourceSystem.name,
      sourceCode: pipeline.sourceSystem.code,
      connectionMode: pipeline.sourceSystem.connectionMode,
      lastRunAt: last?.startedAt ?? null,
      lastRecords: (last?.recordsInserted ?? 0) + (last?.recordsUpdated ?? 0),
      state,
      slaMinutes: pipeline.slaMinutes,
      rejectRate: read > 0 ? (last?.recordsRejected ?? 0) / read : 0,
      qualityFailures: failures.length,
      criticalQualityFailures: failures.filter((f) => f.rule.severity === 'CRITICAL').length,
    }
  }

  return out
}
