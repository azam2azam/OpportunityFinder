/**
 * The integration architecture diagram.
 *
 * Inline SVG rather than a charting library or an image: it has to read
 * correctly in both themes, scale on a phone, and stay selectable and
 * searchable. `currentColor` and CSS custom properties carry the palette, so
 * the diagram follows the theme without a second dark-mode copy.
 *
 * The layout is five vertical tiers matching the real data path — source
 * systems, transport, ingestion, platform, consumption — because the question
 * this diagram answers is "where does a given field come from and what reads
 * it", and a tiered flow answers that by tracing downwards.
 */

interface Node {
  id: string
  label: string
  sub?: string
  tone: 'source' | 'transport' | 'ingest' | 'core' | 'consume'
}

const TIERS: Array<{ title: string; note: string; nodes: Node[] }> = [
  {
    title: 'Source systems',
    note: 'Systems of record. The platform never writes back to any of them.',
    nodes: [
      { id: 'his', label: 'VIDA HIS', sub: 'Registration, encounters,\nappointments, diagnoses', tone: 'source' },
      { id: 'lis', label: 'VIDA LIS', sub: 'Results and\noutstanding orders', tone: 'source' },
      { id: 'rcm', label: 'VIDA RCM', sub: 'Claims, adjudication,\nrejections', tone: 'source' },
      { id: 'rx', label: 'Pharmacy', sub: 'Dispense events', tone: 'source' },
      { id: 'or', label: 'Theatre', sub: 'Surgical pathway', tone: 'source' },
      { id: 'ref', label: 'Referral network', sub: 'Onward care,\nexternal fulfilment', tone: 'source' },
    ],
  },
  {
    title: 'Transport',
    note: 'How each system delivers. Mode is a property of the source, not a platform choice.',
    nodes: [
      { id: 'cdc', label: 'CDC stream', sub: 'Debezium → Kafka\nfrom the read replica', tone: 'transport' },
      { id: 'api', label: 'API pull', sub: 'Scheduled, paginated,\nwatermarked', tone: 'transport' },
      { id: 'file', label: 'SFTP file drop', sub: 'Nightly CSV', tone: 'transport' },
      { id: 'manual', label: 'Manual upload', sub: 'Operator CSV,\nbackfills and fixes', tone: 'transport' },
    ],
  },
  {
    title: 'Ingestion',
    note: 'Where a row is accepted or rejected. Nothing reaches the platform schema unvalidated.',
    nodes: [
      { id: 'parse', label: 'Parse & coerce', sub: 'Typed per field,\nISO dates only', tone: 'ingest' },
      { id: 'resolve', label: 'Resolve references', sub: 'Business codes →\ninternal ids', tone: 'ingest' },
      { id: 'upsert', label: 'Upsert on natural key', sub: 'Idempotent —\nreplay is safe', tone: 'ingest' },
      { id: 'dq', label: 'Data quality', sub: 'Completeness, validity,\nfreshness', tone: 'ingest' },
    ],
  },
  {
    title: 'Platform',
    note: 'The semantic model, then the engines that turn it into prioritised work.',
    nodes: [
      { id: 'model', label: 'Semantic model', sub: '30 entities,\none vocabulary', tone: 'core' },
      { id: 'detect', label: 'Detection engine', sub: '33 configurable rules', tone: 'core' },
      { id: 'score', label: 'Scoring engine', sub: '9 weighted factors,\nexplained', tone: 'core' },
      { id: 'workflow', label: 'Opportunity workflow', sub: 'Owner, SLA,\nactions, outcome', tone: 'core' },
    ],
  },
  {
    title: 'Consumption',
    note: 'Everything below reads through the scoped access layer — nothing queries the tables directly.',
    nodes: [
      { id: 'exec', label: 'Executive dashboards', sub: 'Group and hospital', tone: 'consume' },
      { id: 'queue', label: 'Work queues', sub: 'Navigators, RCM,\ndepartments', tone: 'consume' },
      { id: 'ask', label: 'Ask Data', sub: 'NL → validated SQL', tone: 'consume' },
      { id: 'camp', label: 'Campaigns', sub: 'Approved outreach', tone: 'consume' },
      { id: 'audit', label: 'Audit & governance', sub: 'Every access logged', tone: 'consume' },
    ],
  },
]

const TONE_CLASS: Record<Node['tone'], { box: string; text: string; sub: string }> = {
  source: {
    box: 'fill-sky-50 stroke-sky-300 dark:fill-sky-950 dark:stroke-sky-800',
    text: 'fill-sky-900 dark:fill-sky-100',
    sub: 'fill-sky-700 dark:fill-sky-300',
  },
  transport: {
    box: 'fill-violet-50 stroke-violet-300 dark:fill-violet-950 dark:stroke-violet-800',
    text: 'fill-violet-900 dark:fill-violet-100',
    sub: 'fill-violet-700 dark:fill-violet-300',
  },
  ingest: {
    box: 'fill-amber-50 stroke-amber-300 dark:fill-amber-950 dark:stroke-amber-800',
    text: 'fill-amber-900 dark:fill-amber-100',
    sub: 'fill-amber-700 dark:fill-amber-300',
  },
  core: {
    box: 'fill-indigo-50 stroke-indigo-300 dark:fill-indigo-950 dark:stroke-indigo-800',
    text: 'fill-indigo-900 dark:fill-indigo-100',
    sub: 'fill-indigo-700 dark:fill-indigo-300',
  },
  consume: {
    box: 'fill-emerald-50 stroke-emerald-300 dark:fill-emerald-950 dark:stroke-emerald-800',
    text: 'fill-emerald-900 dark:fill-emerald-100',
    sub: 'fill-emerald-700 dark:fill-emerald-300',
  },
}

// Geometry. Fixed viewBox with the SVG scaled to its container — the diagram
// keeps its proportions on a phone and stays legible by scrolling rather than
// by reflowing into something that no longer reads as a flow.
const W = 1180
const NODE_H = 62
const TIER_GAP = 128
const TOP = 46
const LEFT = 150

export function IntegrationDiagram() {
  const tierY = (i: number) => TOP + i * TIER_GAP
  const height = TOP + (TIERS.length - 1) * TIER_GAP + NODE_H + 30

  return (
    <div className="scroll-x">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full min-w-[900px]"
        role="img"
        aria-label="Integration architecture: source systems flow through transport and ingestion into the platform model, detection and scoring engines, and out to dashboards, work queues, Ask Data, campaigns and the audit trail."
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-ink-400 dark:fill-ink-500" />
          </marker>
        </defs>

        {/* Tier-to-tier connectors, drawn before the boxes so they sit behind. */}
        {TIERS.slice(0, -1).map((_, i) => {
          const y1 = tierY(i) + NODE_H
          const y2 = tierY(i + 1)
          const mid = (y1 + y2) / 2
          return (
            <g key={`flow-${i}`}>
              <path
                d={`M ${LEFT + 60} ${y1 + 4} L ${LEFT + 60} ${mid} L ${W - 80} ${mid} L ${W - 80} ${y2 - 8}`}
                className="fill-none stroke-ink-300 dark:stroke-ink-700"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <line
                x1={W / 2}
                y1={y1 + 6}
                x2={W / 2}
                y2={y2 - 8}
                className="stroke-ink-400 dark:stroke-ink-500"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
            </g>
          )
        })}

        {TIERS.map((tier, tierIndex) => {
          const y = tierY(tierIndex)
          const available = W - LEFT - 40
          const gap = 14
          const nodeW = (available - gap * (tier.nodes.length - 1)) / tier.nodes.length

          return (
            <g key={tier.title}>
              <text x={16} y={y + 20} className="fill-ink-900 text-[13px] font-semibold dark:fill-ink-100">
                {tier.title}
              </text>
              <foreignObject x={16} y={y + 26} width={LEFT - 34} height={NODE_H}>
                <div className="text-[10px] leading-snug text-ink-500 dark:text-ink-400">{tier.note}</div>
              </foreignObject>

              {tier.nodes.map((node, i) => {
                const x = LEFT + i * (nodeW + gap)
                const tone = TONE_CLASS[node.tone]
                const lines = node.sub?.split('\n') ?? []
                return (
                  <g key={node.id}>
                    <rect
                      x={x}
                      y={y}
                      width={nodeW}
                      height={NODE_H}
                      rx={6}
                      className={tone.box}
                      strokeWidth={1}
                    />
                    <text
                      x={x + nodeW / 2}
                      y={y + (lines.length > 0 ? 20 : 36)}
                      textAnchor="middle"
                      className={`${tone.text} text-[11.5px] font-semibold`}
                    >
                      {node.label}
                    </text>
                    {lines.map((line, li) => (
                      <text
                        key={li}
                        x={x + nodeW / 2}
                        y={y + 34 + li * 11}
                        textAnchor="middle"
                        className={`${tone.sub} text-[9px]`}
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                )
              })}
            </g>
          )
        })}

        <text x={16} y={height - 8} className="fill-ink-400 text-[10px] dark:fill-ink-500">
          Solid arrow: primary data flow. Dashed: control and feedback — run status, quality results and watermarks return to the ingestion control plane.
        </text>
      </svg>
    </div>
  )
}

/** The same architecture as Mermaid, for docs and for pasting into a wiki. */
export const INTEGRATION_MERMAID = `flowchart TB
  subgraph SRC["Source systems"]
    HIS["VIDA HIS<br/>registration · encounters<br/>appointments · diagnoses"]
    LIS["VIDA LIS<br/>results · pending orders"]
    RCM["VIDA RCM<br/>claims · rejections"]
    RX["Pharmacy<br/>dispense events"]
    OR["Theatre<br/>surgical pathway"]
    REF["Referral network<br/>onward care"]
  end

  subgraph TRANSPORT["Transport"]
    CDC["CDC stream<br/>Debezium to Kafka"]
    API["API pull<br/>scheduled · watermarked"]
    FILE["SFTP file drop<br/>nightly CSV"]
    MAN["Manual upload<br/>operator CSV"]
  end

  subgraph INGEST["Ingestion"]
    PARSE["Parse and coerce<br/>typed · ISO dates only"]
    RESOLVE["Resolve references<br/>business codes to ids"]
    UPSERT["Upsert on natural key<br/>idempotent"]
    DQ["Data quality<br/>completeness · validity · freshness"]
  end

  subgraph PLATFORM["Platform"]
    MODEL["Semantic model<br/>30 entities"]
    DETECT["Detection engine<br/>33 configurable rules"]
    SCORE["Scoring engine<br/>9 weighted factors"]
    FLOW["Opportunity workflow<br/>owner · SLA · outcome"]
  end

  subgraph CONSUME["Consumption"]
    EXEC["Executive dashboards"]
    QUEUE["Work queues"]
    ASK["Ask Data"]
    CAMP["Campaigns"]
    AUD["Audit and governance"]
  end

  HIS --> CDC
  LIS --> API
  RCM --> FILE
  RX --> API
  OR --> API
  REF --> API

  CDC --> PARSE
  API --> PARSE
  FILE --> PARSE
  MAN --> PARSE

  PARSE --> RESOLVE --> UPSERT --> MODEL
  UPSERT --> DQ
  DQ -. "quality results" .-> INGEST

  MODEL --> DETECT --> SCORE --> FLOW
  FLOW --> EXEC
  FLOW --> QUEUE
  FLOW --> CAMP
  MODEL --> ASK
  FLOW --> AUD
  ASK --> AUD`
