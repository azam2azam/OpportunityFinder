/*
 * Not marked 'server-only': the reset pipeline and operational scripts invoke
 * this from the command line, as they do the detection engine. Web access is
 * gated at the route handlers that call it.
 */
import { prisma } from '../db'
import { loadCsv, type LoadResult } from './load'
import { evaluateQuality, type QualityEvaluation } from './quality'
import { DOMAIN_BY_KEY } from './domains'

/**
 * Ingestion run orchestration.
 *
 * Wraps a load in the record-keeping that makes ingestion operable: a run row,
 * its issues, and the quality evaluation of what landed. A dry run produces the
 * same record with `dryRun` set, because "we validated this file and it had
 * 340 bad rows" is itself worth keeping — it is the evidence an integrator
 * needs when the source team disputes that anything was wrong.
 */

export interface RunOutcome {
  runId: string | null
  pipelineKey: string
  domain: string
  load: LoadResult
  quality: QualityEvaluation[]
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
}

export async function ingestCsv(options: {
  pipelineId: string
  csv: string
  fileName: string
  dryRun: boolean
  triggeredBy: string
  trigger?: string
}): Promise<RunOutcome> {
  const pipeline = await prisma.ingestionPipeline.findUnique({
    where: { id: options.pipelineId },
    include: { sourceSystem: { select: { name: true, code: true } } },
  })
  if (!pipeline) throw new Error('Pipeline not found.')
  if (!pipeline.enabled) throw new Error(`Pipeline ${pipeline.key} is disabled.`)

  const domain = DOMAIN_BY_KEY[pipeline.domain]
  if (!domain) throw new Error(`Pipeline ${pipeline.key} targets unknown domain ${pipeline.domain}.`)

  const run = await prisma.ingestionRun.create({
    data: {
      pipelineId: pipeline.id,
      trigger: options.trigger ?? (options.dryRun ? 'MANUAL' : 'UPLOAD'),
      triggeredBy: options.triggeredBy,
      fileName: options.fileName,
      status: 'RUNNING',
      dryRun: options.dryRun,
      bytesProcessed: Buffer.byteLength(options.csv, 'utf8'),
    },
  })

  try {
    const load = await loadCsv(pipeline.domain, options.csv, { dryRun: options.dryRun })

    const status: RunOutcome['status'] =
      load.recordsRejected === 0
        ? 'SUCCEEDED'
        : load.recordsInserted + load.recordsUpdated === 0
          ? 'FAILED'
          : 'PARTIAL'

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status,
        recordsRead: load.recordsRead,
        recordsInserted: load.recordsInserted,
        recordsUpdated: load.recordsUpdated,
        recordsRejected: load.recordsRejected,
        recordsSkipped: load.recordsSkipped,
        durationMs: load.durationMs,
        errorSummary: summarise(load),
      },
    })

    if (load.issues.length > 0) {
      await prisma.ingestionIssue.createMany({
        data: load.issues.map((i) => ({
          runId: run.id,
          rowNumber: i.rowNumber,
          severity: i.severity,
          code: i.code,
          field: i.field,
          message: i.message,
          rawValue: i.rawValue,
        })),
      })
    }

    // Quality is only meaningful against data that actually landed, and only
    // worth the queries when something did.
    const quality =
      !options.dryRun && load.recordsInserted + load.recordsUpdated > 0
        ? await evaluateQuality({ pipelineId: pipeline.id, runId: run.id })
        : []

    // Advance the watermark so the next incremental run starts where this one
    // finished. Only on a real run — a dry run must not move it, or the rows it
    // validated would be skipped by the load that follows.
    if (!options.dryRun && pipeline.watermarkField && status !== 'FAILED') {
      await prisma.ingestionPipeline.update({
        where: { id: pipeline.id },
        data: { lastWatermark: new Date().toISOString() },
      })
    }

    if (!options.dryRun) {
      await prisma.sourceSystem.update({
        where: { id: pipeline.sourceSystemId },
        data: { lastContactAt: new Date(), status: status === 'FAILED' ? 'DEGRADED' : 'CONNECTED' },
      })
    }

    return { runId: run.id, pipelineKey: pipeline.key, domain: pipeline.domain, load, quality, status }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed.'
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: 'FAILED', errorSummary: message },
    })
    throw err
  }
}

function summarise(load: LoadResult): string | null {
  if (load.recordsRejected === 0 && load.issues.length === 0) return null

  // Group by code so the summary names the problem rather than the first row
  // that happened to hit it.
  const byCode = new Map<string, number>()
  for (const issue of load.issues) {
    byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1)
  }
  const top = [...byCode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([code, n]) => `${code} (${n})`)

  return `${load.recordsRejected} of ${load.recordsRead} rows rejected. Most common: ${top.join(', ')}.`
}

/**
 * Health summary across every pipeline, for the integration overview.
 *
 * "Stale" is measured against each pipeline's own schedule rather than a global
 * constant: a nightly claims feed untouched for six hours is fine, an hourly
 * encounter feed in the same state is not.
 */
export interface PipelineHealth {
  pipelineId: string
  key: string
  name: string
  domain: string
  sourceName: string
  sourceCode: string
  enabled: boolean
  mode: string
  schedule: string | null
  lastRunAt: Date | null
  lastStatus: string | null
  lastRecords: number
  rejectRate: number
  isStale: boolean
  slaMinutes: number
  runsLast30: number
  failuresLast30: number
}

export async function getPipelineHealth(): Promise<PipelineHealth[]> {
  const [pipelines, recentRuns] = await Promise.all([
    prisma.ingestionPipeline.findMany({
      include: { sourceSystem: { select: { name: true, code: true } } },
      orderBy: [{ sourceSystem: { name: 'asc' } }, { name: 'asc' }],
    }),
    prisma.ingestionRun.findMany({
      where: { startedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { startedAt: 'desc' },
      select: {
        pipelineId: true, startedAt: true, status: true, recordsRead: true,
        recordsRejected: true, recordsInserted: true, recordsUpdated: true,
      },
    }),
  ])

  return pipelines.map((p) => {
    const runs = recentRuns.filter((r) => r.pipelineId === p.id)
    const last = runs[0] ?? null
    const read = last?.recordsRead ?? 0

    // A pipeline is stale once it has gone more than three scheduled intervals
    // without a run — one missed cycle is noise, three is a fault.
    const intervalMs = p.slaMinutes * 60_000
    const isStale = p.enabled
      ? !last || Date.now() - last.startedAt.getTime() > intervalMs * 3
      : false

    return {
      pipelineId: p.id,
      key: p.key,
      name: p.name,
      domain: p.domain,
      sourceName: p.sourceSystem.name,
      sourceCode: p.sourceSystem.code,
      enabled: p.enabled,
      mode: p.mode,
      schedule: p.schedule,
      lastRunAt: last?.startedAt ?? null,
      lastStatus: last?.status ?? null,
      lastRecords: (last?.recordsInserted ?? 0) + (last?.recordsUpdated ?? 0),
      rejectRate: read > 0 ? (last?.recordsRejected ?? 0) / read : 0,
      isStale,
      slaMinutes: p.slaMinutes,
      runsLast30: runs.length,
      failuresLast30: runs.filter((r) => r.status === 'FAILED' || r.status === 'PARTIAL').length,
    }
  })
}
