import type { ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Info, TriangleAlert, ShieldCheck, ArrowRight } from 'lucide-react'
import type { DocBlock, DocDefinition } from '@/lib/docs/types'
import { docStats } from '@/lib/docs/types'
import { IntegrationDiagram } from '@/components/IntegrationDiagram'
import { PageHeader, Card } from '@/components/ui'

/**
 * Renders a DocDefinition as a reference page.
 *
 * A server component with no interactivity: the contents list is plain anchor
 * links and the sections are all expanded. Collapsible sections would look
 * tidier and would break the two things people actually do with documentation
 * — search the page, and print it.
 *
 * Long-form prose needs a narrower measure than the rest of the product, so
 * the body is capped at roughly 75 characters per line while tables and the
 * diagram are allowed the full width they need.
 */
export function DocView({ doc }: { doc: DocDefinition }) {
  const stats = docStats(doc)

  return (
    <div className="space-y-5">
      <PageHeader
        title={doc.title}
        question={doc.question}
        description={doc.description}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
        <div className="min-w-0 space-y-4 lg:order-1">
          <Card className="border-brand-100 bg-brand-50/50 dark:border-brand-900 dark:bg-brand-950/40">
            <p className="text-sm text-ink-700 dark:text-ink-200">
              <span className="label">Written for</span>
              <span className="mt-1 block">{doc.audience}</span>
            </p>
          </Card>

          {doc.sections.map((section) => (
            <Card key={section.id} className="scroll-mt-20" pad={false}>
              <section id={section.id} className="scroll-mt-20 p-4 sm:p-5">
                <h2 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
                  {section.title}
                </h2>
                {section.summary && (
                  <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{section.summary}</p>
                )}
                <div className="mt-4 space-y-4">
                  {section.blocks.map((block, i) => (
                    <Block key={i} block={block} />
                  ))}
                </div>
              </section>
            </Card>
          ))}
        </div>

        {/* Contents. Ordered first on narrow screens so it is reachable
            without scrolling past the whole document to find it. */}
        <nav
          aria-label="Contents"
          className="lg:sticky lg:top-4 lg:order-2"
        >
          <Card>
            <p className="label">Contents</p>
            <p className="mt-1 text-2xs text-ink-400 dark:text-ink-500">
              {stats.sections} sections · about {stats.minutes} min
            </p>
            <ol className="mt-3 space-y-1.5">
              {doc.sections.map((section, i) => (
                <li key={section.id} className="flex gap-2 text-sm leading-snug">
                  <span className="tabular w-4 shrink-0 text-2xs text-ink-400 dark:text-ink-600">
                    {i + 1}
                  </span>
                  <a
                    href={`#${section.id}`}
                    className="text-ink-600 hover:text-brand-700 hover:underline dark:text-ink-300 dark:hover:text-brand-300"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </Card>
        </nav>
      </div>
    </div>
  )
}

// ── blocks ──────────────────────────────────────────────────────────────

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'text':
      return (
        <p className="max-w-[72ch] text-sm leading-relaxed text-ink-700 dark:text-ink-300">
          {inline(block.body)}
        </p>
      )

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          className={clsx(
            'max-w-[72ch] space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700 dark:text-ink-300',
            block.ordered ? 'list-decimal' : 'list-disc'
          )}
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              {inline(item)}
            </li>
          ))}
        </Tag>
      )
    }

    case 'steps':
      return (
        <ol className="max-w-[72ch] space-y-3">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-2xs font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                  {inline(item.title)}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                  {inline(item.body)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )

    case 'table':
      return (
        <div>
          <div className="scroll-x">
            <table className="w-full min-w-[560px] border-collapse">
              <thead className="border-b border-ink-200 dark:border-ink-800">
                <tr>
                  {block.columns.map((c) => (
                    <th key={c} className="th">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {block.rows.map((row, i) => (
                  <tr key={i} className="align-top">
                    {row.map((cell, j) => (
                      <td key={j} className="td leading-relaxed">
                        {inline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && (
            <p className="mt-2 text-2xs text-ink-400 dark:text-ink-500">{block.caption}</p>
          )}
        </div>
      )

    case 'defs':
      return (
        <dl className="max-w-[72ch] space-y-3">
          {block.items.map((item, i) => (
            <div
              key={i}
              className="border-l-2 border-ink-200 pl-3 dark:border-ink-700"
            >
              <dt className="text-sm font-medium text-ink-900 dark:text-ink-100">
                {inline(item.term)}
              </dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                {inline(item.body)}
              </dd>
            </div>
          ))}
        </dl>
      )

    case 'note': {
      const tone = NOTE_TONE[block.tone]
      const Icon = tone.icon
      return (
        <div className={clsx('max-w-[72ch] rounded-lg border p-3', tone.box)}>
          <div className="flex gap-2.5">
            <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', tone.icon_)} />
            <div className="min-w-0">
              {block.title && (
                <p className={clsx('text-sm font-semibold', tone.title)}>{inline(block.title)}</p>
              )}
              <p
                className={clsx(
                  'text-sm leading-relaxed',
                  block.title && 'mt-1',
                  tone.body
                )}
              >
                {inline(block.body)}
              </p>
            </div>
          </div>
        </div>
      )
    }

    case 'code':
      return (
        <pre className="scroll-x rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs leading-relaxed text-ink-800 dark:border-ink-800 dark:bg-ink-950 dark:text-ink-200">
          <code>{block.body}</code>
        </pre>
      )

    case 'links':
      return (
        <div className="flex flex-wrap gap-2">
          {block.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex min-w-[13rem] flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 transition-colors hover:border-brand-300 hover:bg-brand-50/60 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-brand-800 dark:hover:bg-ink-800"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-700 dark:text-brand-300">
                  {item.label}
                </p>
                {item.body && (
                  <p className="mt-0.5 text-2xs text-ink-500 dark:text-ink-400">{item.body}</p>
                )}
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 dark:text-ink-600" />
            </Link>
          ))}
        </div>
      )

    case 'diagram':
      return (
        <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
          <IntegrationDiagram />
        </div>
      )
  }
}

const NOTE_TONE = {
  info: {
    icon: Info,
    box: 'border-ink-200 bg-ink-50 dark:border-ink-800 dark:bg-ink-950',
    icon_: 'text-ink-400',
    title: 'text-ink-900 dark:text-ink-100',
    body: 'text-ink-600 dark:text-ink-400',
  },
  warn: {
    icon: TriangleAlert,
    box: 'border-warn-100 bg-warn-50/70 dark:border-warn-700 dark:bg-warn-700/10',
    icon_: 'text-warn-600',
    title: 'text-warn-800 dark:text-warn-400',
    body: 'text-ink-700 dark:text-ink-300',
  },
  rule: {
    icon: ShieldCheck,
    box: 'border-brand-200 bg-brand-50/70 dark:border-brand-900 dark:bg-brand-950/50',
    icon_: 'text-brand-600 dark:text-brand-400',
    title: 'text-brand-800 dark:text-brand-200',
    body: 'text-ink-700 dark:text-ink-300',
  },
} as const

/**
 * Minimal inline markup: `**bold**` and `` `code` ``.
 *
 * Deliberately not a Markdown parser. The document model is authored in
 * TypeScript by people who can read this function, and a real parser would
 * invite arbitrary HTML into a page that renders content from source files.
 */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[1] !== undefined) {
      parts.push(
        <strong key={key++} className="font-semibold text-ink-900 dark:text-ink-100">
          {match[1]}
        </strong>
      )
    } else if (match[2] !== undefined) {
      parts.push(
        <code
          key={key++}
          className="rounded border border-ink-200 bg-ink-100 px-1 py-0.5 text-[0.85em] text-ink-800 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
        >
          {match[2]}
        </code>
      )
    } else {
      parts.push(
        <em key={key++} className="italic">
          {match[3]}
        </em>
      )
    }
    last = pattern.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
