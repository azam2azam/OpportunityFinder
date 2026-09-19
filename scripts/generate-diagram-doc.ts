/**
 * Generates docs/INTEGRATION-DIAGRAM.md from the diagram component and the feed
 * contracts.
 *
 * The Mermaid source lives beside the React diagram in
 * src/components/IntegrationDiagram.tsx so the rendered version and the
 * documented version cannot drift apart. This script publishes it, along with a
 * feed table derived from the domain specs rather than retyped.
 *
 * Run: npm run docs:diagram
 */
import { writeFileSync } from 'fs'
import { INTEGRATION_MERMAID } from '../src/components/IntegrationDiagram'
import { DOMAINS } from '../src/lib/ingestion/domains'

const fence = '```'
const tick = '`'

const feedRows = DOMAINS.map(
  (d) =>
    `| **${d.label}** | ${tick}${d.targetEntity}${tick} | ${tick}${d.naturalKey.join(' + ')}${tick} | ${d.fields.length} | ${d.fields.filter((f) => f.required).length} |`
).join('\n')

const doc = `# Integration diagram

The same architecture the application renders on **Data & integration → Integration Overview**,
as Mermaid source — for pasting into a wiki, a design document or a slide.

GitHub, GitLab, Notion and Confluence all render this natively.

*Generated from ${tick}src/components/IntegrationDiagram.tsx${tick} by ${tick}npm run docs:diagram${tick}. Do not edit by hand.*

## Architecture

${fence}mermaid
${INTEGRATION_MERMAID}
${fence}

## Reading it

**Five tiers, top to bottom, following the real data path.**

| Tier | What it is | How it fails |
|---|---|---|
| **Source systems** | Systems of record. The platform never writes back to any of them. | Schema changes announced late, or not at all. |
| **Transport** | How each system delivers. A property of the source, not a platform choice. | Going silent — which looks identical to a quiet period, so staleness is measured against each pipeline's own schedule rather than a global constant. |
| **Ingestion** | Where a row is accepted or rejected. Nothing reaches the platform schema unvalidated. | Loudly. Rejected rows carry their row number, column and offending value. |
| **Platform** | The semantic model, then the engines that turn it into prioritised work. | Quietly — a rule whose input field stopped arriving simply finds nothing, and nobody notices for weeks. |
| **Consumption** | Everything that reads. All of it through the scoped access layer; nothing queries tables directly. | Access errors, which fail closed. |

**The dashed line is the feedback path.** Run status, quality results and watermarks return to the
ingestion control plane — that is what the Pipelines and Data Quality screens read.

## Feeds

| Feed | Lands in | Natural key | Fields | Required |
|---|---|---|---|---|
${feedRows}

## Where each piece lives

| Element | Code |
|---|---|
| Feed contracts | ${tick}src/lib/ingestion/domains.ts${tick} |
| Parsing and type coercion | ${tick}src/lib/ingestion/parse.ts${tick} |
| Reference resolution and upsert | ${tick}src/lib/ingestion/load.ts${tick} |
| Run orchestration, pipeline health | ${tick}src/lib/ingestion/run.ts${tick} |
| Quality checks | ${tick}src/lib/ingestion/quality.ts${tick} |
| Semantic model | ${tick}prisma/schema.prisma${tick}, ${tick}src/lib/enums.ts${tick} |
| Detection engine | ${tick}src/lib/detection/${tick} |
| Scoring engine | ${tick}src/lib/scoring.ts${tick} |
| Scoped access layer | ${tick}src/lib/queries.ts${tick}, ${tick}src/lib/rbac.ts${tick} |
| Ask Data | ${tick}src/lib/nlsql/${tick} |
| Diagram source | ${tick}src/components/IntegrationDiagram.tsx${tick} |

## Integration seams

Three modules are isolated so a production swap touches one file each.

| Seam | Module | Replace it to |
|---|---|---|
| Identity | ${tick}getPrincipal()${tick} in ${tick}src/lib/auth.ts${tick} | Move from session cookies to enterprise SSO / OIDC. Everything downstream consumes the resolved ${tick}Principal${tick}, so nothing else moves. |
| Natural language to SQL | ${tick}NlSqlProvider${tick} in ${tick}src/lib/nlsql/types.ts${tick} | Connect the hospital's existing engine. Validation, scope binding, execution and auditing stay on the platform side of the seam, so a new engine inherits the guardrails rather than reimplementing them. |
| Source reads | ${tick}loadContext()${tick} in ${tick}src/lib/detection/context.ts${tick} | Move the warehouse to Snowflake or Postgres. The 33 detection rules are untouched. |

See [DATA-PLATFORM.md](DATA-PLATFORM.md) for the full production mapping, and
[INGESTION-MANUAL.md](INGESTION-MANUAL.md) for the operating procedure.
`

writeFileSync('docs/INTEGRATION-DIAGRAM.md', doc)
console.log(`docs/INTEGRATION-DIAGRAM.md written — ${doc.split('\n').length} lines, ${DOMAINS.length} feeds`)
