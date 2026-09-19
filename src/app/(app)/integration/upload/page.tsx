import Link from 'next/link'
import { guard } from '@/lib/guard'
import { prisma } from '@/lib/db'
import { DOMAINS } from '@/lib/ingestion/domains'
import { one, type SearchParams } from '@/lib/params'
import { count, relative, humanise } from '@/lib/format'
import { PageHeader, Card, SectionHeader, TableShell, EmptyState } from '@/components/ui'
import { UploadData, type DomainOption } from '@/components/client/UploadData'
import { RunStatusChip } from '../page'

export const dynamic = 'force-dynamic'

/**
 * Upload Data.
 *
 * The manual ingestion path: validate a file, read exactly what would happen,
 * then commit. Used for backfills, corrections, and proving a mapping before an
 * automated connector is built for it.
 */
export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await guard('integration.ingest')
  const params = await searchParams
  const requested = one(params, 'domain')

  const [pipelines, recentUploads] = await Promise.all([
    prisma.ingestionPipeline.findMany({
      where: { sourceSystem: { connectionMode: 'MANUAL_UPLOAD' } },
      select: { id: true, domain: true },
    }),
    prisma.ingestionRun.findMany({
      where: { trigger: { in: ['UPLOAD', 'MANUAL'] } },
      orderBy: { startedAt: 'desc' },
      take: 12,
      include: { pipeline: { select: { domain: true } } },
    }),
  ])

  const pipelineByDomain = new Map(pipelines.map((p) => [p.domain, p.id]))

  const options: DomainOption[] = DOMAINS.filter((d) => pipelineByDomain.has(d.key)).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    targetEntity: d.targetEntity,
    naturalKey: d.naturalKey,
    requiredFields: d.fields.filter((f) => f.required).map((f) => f.name),
    fieldCount: d.fields.length,
    pipelineId: pipelineByDomain.get(d.key) as string,
    operatorNotes: d.operatorNotes,
  }))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Upload Data"
        question="How do I get a file into the platform?"
        description="Pick the feed, validate the file, read what would happen, then commit. Nothing is written until you have seen the dry run."
        actions={
          <Link href="/integration/mapping" className="btn btn-secondary">
            Field mapping reference
          </Link>
        }
      />

      {options.length === 0 ? (
        <Card>
          <EmptyState
            title="No manual upload pipelines configured"
            description="Run the integration seed to create one per domain."
          />
        </Card>
      ) : (
        <UploadData domains={options} initialDomain={requested} />
      )}

      <Card>
        <SectionHeader
          title="Recent uploads"
          description="Manual loads and dry runs, attributed to the operator who ran them."
        />
        {recentUploads.length === 0 ? (
          <EmptyState title="No uploads yet" description="Uploads you run will be listed here." />
        ) : (
          <TableShell
            head={
              <>
                <th className="th">When</th>
                <th className="th">Feed</th>
                <th className="th">File</th>
                <th className="th">By</th>
                <th className="th text-right">Read</th>
                <th className="th text-right">Loaded</th>
                <th className="th text-right">Rejected</th>
                <th className="th">Mode</th>
                <th className="th">Status</th>
              </>
            }
          >
            {recentUploads.map((r) => (
              <tr key={r.id}>
                <td className="td whitespace-nowrap text-xs text-ink-500">{relative(r.startedAt)}</td>
                <td className="td text-xs">{humanise(r.pipeline.domain)}</td>
                <td className="td max-w-[180px] truncate font-mono text-2xs text-ink-500">
                  {r.fileName ?? '—'}
                </td>
                <td className="td max-w-[160px] truncate text-2xs text-ink-500">{r.triggeredBy ?? '—'}</td>
                <td className="td tabular text-right">{count(r.recordsRead)}</td>
                <td className="td tabular text-right">{count(r.recordsInserted + r.recordsUpdated)}</td>
                <td className="td tabular text-right">
                  {r.recordsRejected > 0 ? (
                    <span className="font-medium text-warn-700 dark:text-warn-500">{count(r.recordsRejected)}</span>
                  ) : (
                    <span className="text-ink-400">0</span>
                  )}
                </td>
                <td className="td text-2xs">
                  {r.dryRun ? (
                    <span className="chip border-ink-200 bg-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800">
                      dry run
                    </span>
                  ) : (
                    <span className="chip border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200">
                      committed
                    </span>
                  )}
                </td>
                <td className="td">
                  <RunStatusChip status={r.status} />
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>

      <Card>
        <SectionHeader title="What happens to an uploaded file" />
        <ol className="space-y-2.5 text-sm text-ink-600 dark:text-ink-300">
          {[
            ['Parsed', 'RFC 4180 CSV — quoted fields, embedded commas and newlines, doubled quotes. A UTF-8 byte-order mark from Excel is stripped rather than becoming part of your first column name.'],
            ['Typed', 'Every value is coerced against the field contract. Dates must be ISO 8601; ambiguous formats are rejected rather than guessed.'],
            ['Resolved', 'Business codes — MRN, hospital code, specialty code — are looked up. Unknown codes reject the row; the platform never invents a placeholder record to satisfy a reference.'],
            ['Upserted', 'Matched on the natural key for that feed. Re-sending the same file updates rather than duplicates, so recovering from a partial failure is just sending it again.'],
            ['Measured', 'Quality checks run against what landed, testing whether the fields the detection rules depend on are actually populated.'],
            ['Recorded', 'The run, every rejected row and the quality result are written to the audit trail, attributed to you.'],
          ].map(([title, detail], i) => (
            <li key={title} className="flex gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-2xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
                {i + 1}
              </span>
              <span>
                <strong className="font-medium text-ink-900 dark:text-ink-100">{title}.</strong> {detail}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-500 dark:border-ink-800 dark:text-ink-400">
          Uploading patient data is a PHI-handling action and is audited as one. Use this for
          corrections and backfills; a recurring feed belongs in an automated connector, where the
          same contract applies without a person in the loop.
        </p>
      </Card>
    </div>
  )
}
