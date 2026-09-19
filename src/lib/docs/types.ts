/**
 * The document model behind the Help section.
 *
 * Documentation in a product like this fails in one predictable way: it is
 * written once, rendered twice — a page in the app and a file in the repo —
 * and the two drift until neither can be trusted. So a document is structured
 * content here, not prose in a page component. `DocView` renders it for the
 * app and `scripts/generate-docs.ts` renders the same object to Markdown, the
 * way `npm run docs:diagram` already publishes the integration diagram.
 *
 * The block vocabulary is deliberately small. Every kind has to render
 * sensibly in both targets, so there is no block that depends on interactivity
 * or on colour to carry meaning.
 *
 * Inline markup inside any `string` field is limited to `**bold**` and
 * `` `code` `` — enough to keep prose readable in source, and both survive the
 * Markdown round trip untouched.
 */

export type DocBlock =
  /** A paragraph. Several may follow each other. */
  | { kind: 'text'; body: string }
  /** A bulleted or numbered list of short points. */
  | { kind: 'list'; ordered?: boolean; items: string[] }
  /** Numbered procedure. Use when the reader is meant to *do* something. */
  | { kind: 'steps'; items: Array<{ title: string; body: string }> }
  /** Tabular reference. `columns.length` must match every row's length. */
  | { kind: 'table'; columns: string[]; rows: string[][]; caption?: string }
  /** Term/definition pairs — a glossary, a field reference, a role list. */
  | { kind: 'defs'; items: Array<{ term: string; body: string }> }
  /**
   * A called-out constraint. `rule` is for things that are enforced by the
   * platform, `warn` for things that will bite, `info` for context.
   */
  | { kind: 'note'; tone: 'info' | 'warn' | 'rule'; title?: string; body: string }
  /** Literal text — a command, a CSV line, a file path, a snippet. */
  | { kind: 'code'; language?: string; body: string }
  /** Links into the application itself. Rendered as a list in Markdown. */
  | { kind: 'links'; items: Array<{ href: string; label: string; body?: string }> }
  /**
   * The integration architecture diagram. Rendered as the live SVG component
   * in the app and as its Mermaid twin in Markdown — one source, both targets.
   */
  | { kind: 'diagram' }

export interface DocSection {
  /** Anchor and table-of-contents key. Stable: people link to these. */
  id: string
  title: string
  /** One line under the heading saying what the section is for. */
  summary?: string
  blocks: DocBlock[]
}

export interface DocDefinition {
  /** Route segment under /help and the Markdown filename stem. */
  slug: string
  title: string
  /** The operational question the document answers, per the house page style. */
  question: string
  description: string
  /** Who this is written for. Stated because the two documents differ on it. */
  audience: string
  sections: DocSection[]
}

/** Section count and a rough reading time, for the Help index cards. */
export function docStats(doc: DocDefinition): { sections: number; words: number; minutes: number } {
  let words = 0
  const add = (s: string) => {
    words += s.trim().split(/\s+/).filter(Boolean).length
  }
  for (const section of doc.sections) {
    add(section.title)
    if (section.summary) add(section.summary)
    for (const block of section.blocks) {
      switch (block.kind) {
        case 'text':
          add(block.body)
          break
        case 'list':
          block.items.forEach(add)
          break
        case 'steps':
          block.items.forEach((i) => {
            add(i.title)
            add(i.body)
          })
          break
        case 'table':
          block.rows.forEach((r) => r.forEach(add))
          break
        case 'defs':
          block.items.forEach((i) => {
            add(i.term)
            add(i.body)
          })
          break
        case 'note':
          add(block.body)
          break
        case 'links':
          block.items.forEach((i) => {
            add(i.label)
            if (i.body) add(i.body)
          })
          break
        case 'code':
        case 'diagram':
          // Not prose; counting it would overstate the reading time.
          break
      }
    }
  }
  // 200 wpm is the usual figure for reference material read attentively.
  return { sections: doc.sections.length, words, minutes: Math.max(1, Math.round(words / 200)) }
}
