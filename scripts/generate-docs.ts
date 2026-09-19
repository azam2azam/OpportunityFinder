/**
 * Publishes the Help documents to docs/ as Markdown.
 *
 * The architecture document and the user manual are structured content in
 * src/lib/docs/, rendered in the application by DocView. This script renders
 * the same objects to Markdown so the repository copies cannot drift from the
 * in-app ones — there is only one copy of the content, and both outputs are
 * projections of it.
 *
 * Run: npm run docs:generate
 */
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { DocBlock, DocDefinition } from '../src/lib/docs/types'
import { ARCHITECTURE_DOC } from '../src/lib/docs/architecture'
import { USER_MANUAL_DOC } from '../src/lib/docs/manual'
import { INTEGRATION_MERMAID } from '../src/components/IntegrationDiagram'

const FENCE = '```'

/** Markdown table cells cannot contain a raw pipe or a line break. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ')
}

function renderBlock(block: DocBlock): string {
  switch (block.kind) {
    case 'text':
      return block.body

    case 'list':
      return block.items
        .map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${item}`)
        .join('\n')

    case 'steps':
      return block.items
        .map((item, i) => `${i + 1}. **${item.title}** — ${item.body}`)
        .join('\n')

    case 'table': {
      const header = `| ${block.columns.map(cell).join(' | ')} |`
      const divider = `|${block.columns.map(() => '---').join('|')}|`
      const rows = block.rows.map((r) => `| ${r.map(cell).join(' | ')} |`)
      const table = [header, divider, ...rows].join('\n')
      return block.caption ? `${table}\n\n*${block.caption}*` : table
    }

    case 'defs':
      return block.items.map((item) => `**${item.term}**\n\n${item.body}`).join('\n\n')

    case 'note': {
      // GitHub alert syntax, which degrades to a plain blockquote elsewhere.
      const alert = block.tone === 'warn' ? 'WARNING' : block.tone === 'rule' ? 'IMPORTANT' : 'NOTE'
      const body = block.title ? `**${block.title}**\n>\n> ${block.body}` : block.body
      return `> [!${alert}]\n> ${body}`
    }

    case 'code':
      return `${FENCE}${block.language ?? ''}\n${block.body}\n${FENCE}`

    case 'links':
      return block.items
        .map((item) => `- [${item.label}](${item.href})${item.body ? ` — ${item.body}` : ''}`)
        .join('\n')

    case 'diagram':
      return `${FENCE}mermaid\n${INTEGRATION_MERMAID}\n${FENCE}`
  }
}

function renderDoc(doc: DocDefinition): string {
  const contents = doc.sections
    .map((s, i) => `${i + 1}. [${s.title}](#${s.id})`)
    .join('\n')

  const body = doc.sections
    .map((section) => {
      const parts = [`<a id="${section.id}"></a>`, `## ${section.title}`]
      if (section.summary) parts.push(`*${section.summary}*`)
      parts.push(...section.blocks.map(renderBlock))
      return parts.join('\n\n')
    })
    .join('\n\n---\n\n')

  return [
    `# ${doc.title}`,
    `**${doc.question}**`,
    doc.description,
    `**Written for:** ${doc.audience}`,
    `*Generated from \`src/lib/docs/${doc.slug}.ts\` by \`npm run docs:generate\`. Do not edit by hand — edit the source and regenerate, or the application and this file will disagree.*`,
    '## Contents',
    contents,
    '---',
    body,
  ].join('\n\n') + '\n'
}

const outputs: Array<{ file: string; doc: DocDefinition }> = [
  { file: 'ARCHITECTURE.md', doc: ARCHITECTURE_DOC },
  { file: 'USER-MANUAL.md', doc: USER_MANUAL_DOC },
]

for (const { file, doc } of outputs) {
  const path = join(process.cwd(), 'docs', file)
  const markdown = renderDoc(doc)
  writeFileSync(path, markdown, 'utf8')
  console.log(
    `${file.padEnd(18)} ${String(doc.sections.length).padStart(2)} sections  ${String(markdown.length).padStart(6)} bytes`
  )
}
