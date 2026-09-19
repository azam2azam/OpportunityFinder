import { DOMAIN_BY_KEY } from './ingestion/domains'

/**
 * Data lineage: which source application feeds which page.
 *
 * The integration screens answer "is the data arriving". This answers the
 * question every other page raises and none of them could previously address:
 * *where did the numbers on this screen come from, and are they current?*
 *
 * Without it the connection between the source systems and the product is
 * knowledge that lives in one integrator's head. A director looking at a
 * conversion figure has no way to tell that it depends on a pharmacy feed that
 * stopped three days ago — the chart renders perfectly either way.
 *
 * One entry per route. The provenance bar in the app shell reads this by
 * pathname, so adding a page means adding an entry here and nothing else.
 */

export interface LineageEntry {
  /** Route this describes. Matched longest-prefix-first. */
  route: string
  label: string
  /** Ingestion feeds this page's content is derived from, most important first. */
  feeds: string[]
  /** What the page would get wrong, or stop showing, if those feeds stalled. */
  impact: string
  /**
   * Platform-internal derivation between the feed and the screen. Named so the
   * reader knows the figures are computed, not read straight from the source.
   */
  derivedBy?: string[]
}

/**
 * Routes whose content comes from the platform's own configuration and
 * operational records rather than from a clinical feed. Saying so explicitly
 * beats showing an empty provenance bar that reads as missing information.
 */
const PLATFORM_ONLY = 'PLATFORM'

export const LINEAGE: LineageEntry[] = [
  {
    route: '/',
    label: 'Executive Dashboard',
    feeds: ['PATIENT', 'ENCOUNTER', 'LAB_RESULT', 'CLAIM', 'APPOINTMENT', 'PHARMACY', 'SURGERY', 'REFERRAL', 'DIAGNOSIS'],
    impact:
      'Every KPI, the funnel and the hospital comparison are aggregates over the whole opportunity pipeline, so a stalled feed shows up here as a category quietly shrinking rather than as an error.',
    derivedBy: ['Detection engine', 'Scoring engine', 'Opportunity workflow'],
  },
  {
    route: '/opportunities',
    label: 'Opportunity Center',
    feeds: ['PATIENT', 'ENCOUNTER', 'LAB_RESULT', 'CLAIM', 'APPOINTMENT', 'PHARMACY', 'SURGERY', 'REFERRAL', 'DIAGNOSIS'],
    impact:
      'Opportunities only exist for feeds that have loaded. A missing feed removes its category from this list entirely, with nothing to indicate the absence.',
    derivedBy: ['Detection engine', 'Scoring engine'],
  },
  {
    route: '/queue',
    label: 'My Work Queue',
    feeds: ['PATIENT', 'ENCOUNTER', 'LAB_RESULT', 'CLAIM', 'APPOINTMENT', 'PHARMACY'],
    impact:
      'The queue is the open pipeline filtered to you. A stalled feed means work that should be here never arrives.',
    derivedBy: ['Detection engine', 'Opportunity workflow'],
  },
  {
    route: '/patients',
    label: 'Patient Opportunities',
    feeds: ['PATIENT', 'ENCOUNTER', 'LAB_RESULT', 'APPOINTMENT', 'PHARMACY', 'DIAGNOSIS'],
    impact:
      'Grouping by patient depends on the patient feed for identity, contactability and consent. Everything else supplies the issues attached to each one.',
    derivedBy: ['Detection engine'],
  },
  {
    route: '/revenue',
    label: 'Revenue Opportunities',
    feeds: ['CLAIM', 'SURGERY', 'REFERRAL', 'ENCOUNTER', 'PATIENT'],
    impact:
      'Potential value comes from claim amounts, surgical case values and referral estimates. Without those fields the figures here are structurally understated, not merely incomplete.',
    derivedBy: ['Scoring engine — financial value factor'],
  },
  {
    route: '/clinical',
    label: 'Clinical Opportunities',
    feeds: ['LAB_RESULT', 'SURGERY', 'PHARMACY', 'ENCOUNTER', 'DIAGNOSIS', 'PATIENT'],
    impact:
      'All three clinical rule families read from here. A laboratory feed missing its critical flags removes the highest-urgency findings in the platform.',
    derivedBy: ['Detection engine — 14 clinical rules', 'Clinical-safety priority floor'],
  },
  {
    route: '/service-lines',
    label: 'Service-Line Growth',
    feeds: ['ENCOUNTER', 'APPOINTMENT', 'REFERRAL'],
    impact:
      'Capacity, cancellation and leakage are aggregates. Contracted clinic capacity is modelled rather than fed — it has no source system, so it is configuration.',
    derivedBy: ['Service-line metrics rollup', 'Detection engine — 3 aggregate rules'],
  },
  {
    route: '/insurance',
    label: 'Insurance Recovery',
    feeds: ['CLAIM', 'PATIENT'],
    impact:
      'Entirely dependent on the claims feed. Recoverable value is the rejected amount weighted by the recovery rate that feed supplies — absent, it defaults to zero and this module reports nothing to work.',
    derivedBy: ['Detection engine — 5 recovery rules', 'Recovery pathway playbook'],
  },
  {
    route: '/reactivation',
    label: 'Patient Reactivation',
    feeds: ['PATIENT', 'ENCOUNTER', 'DIAGNOSIS', 'SURGERY'],
    impact:
      'Lapse is measured against encounter history; the chronic flag on diagnoses decides which lapses matter clinically. Consent on the patient feed decides who may be contacted at all.',
    derivedBy: ['Detection engine — 4 reactivation rules'],
  },
  {
    route: '/follow-up',
    label: 'Follow-up & Treatment Gaps',
    feeds: ['APPOINTMENT', 'ENCOUNTER', 'REFERRAL', 'PATIENT'],
    impact:
      'The documented follow-up interval on the encounter feed drives the largest rule here. Where a source holds it only as free text, this page understates the gap.',
    derivedBy: ['Detection engine — 7 appointment and referral rules'],
  },
  {
    route: '/campaigns',
    label: 'Campaigns & Actions',
    feeds: ['PATIENT'],
    impact:
      'Cohorts are built from the opportunity pipeline; contactability and consent come from the patient feed and gate who can be included.',
    derivedBy: ['Opportunity workflow', 'Campaign membership'],
  },
  {
    route: '/analytics',
    label: 'Analytics',
    feeds: ['PATIENT', 'ENCOUNTER', 'LAB_RESULT', 'CLAIM', 'APPOINTMENT', 'PHARMACY', 'SURGERY', 'REFERRAL', 'DIAGNOSIS'],
    impact:
      'Conversion, aging and rule performance are computed over the pipeline. Rule performance in particular is only meaningful where the feed behind a rule is actually arriving.',
    derivedBy: ['Detection engine', 'Scoring engine', 'Conversion records'],
  },
  {
    route: '/ask',
    label: 'Ask Data',
    feeds: ['PATIENT', 'ENCOUNTER', 'LAB_RESULT', 'CLAIM', 'APPOINTMENT', 'PHARMACY', 'SURGERY', 'REFERRAL', 'DIAGNOSIS'],
    impact:
      'Queries run against the semantic model directly. An answer is only as current as the feed behind it, which is why every result states its scope and row count.',
    derivedBy: ['Semantic model', 'Ask Data validator'],
  },
  {
    route: '/hospitals',
    label: 'Hospitals',
    feeds: ['PATIENT', 'ENCOUNTER', 'CLAIM', 'APPOINTMENT'],
    impact:
      'Comparison normalises by patient population, so a hospital whose patient feed lags will appear to carry disproportionate open work per thousand patients.',
    derivedBy: ['Detection engine', 'Hospital comparison rollup'],
  },
  {
    route: '/departments',
    label: 'Departments',
    feeds: ['ENCOUNTER', 'CLAIM'],
    impact:
      'Departmental attribution comes from the encounter feed; rejection attribution comes from the responsible-department field on the claims feed, which is a different thing and often a different team.',
    derivedBy: ['Opportunity ownership', 'Rejection attribution'],
  },
  {
    route: '/physicians',
    label: 'Physicians',
    feeds: ['ENCOUNTER', 'LAB_RESULT', 'SURGERY', 'REFERRAL'],
    impact:
      'Open loops are normalised per hundred encounters, so an incomplete encounter feed inflates every physician’s rate and makes the comparison unfair.',
    derivedBy: ['Detection engine', 'Encounter volume normalisation'],
  },
  {
    route: '/rules',
    label: 'Opportunity Rules',
    feeds: [PLATFORM_ONLY],
    impact:
      'Rule configuration is platform data, not fed from a source system. The yield figures beside each rule are derived from the pipeline those rules produced.',
    derivedBy: ['Rule catalogue', 'Detection run history'],
  },
  {
    route: '/admin',
    label: 'Administration',
    feeds: [PLATFORM_ONLY],
    impact:
      'Users, roles, scoring weights and alert thresholds are platform configuration. No source system supplies them.',
    derivedBy: ['Role catalogue', 'Scoring model', 'Alert rules'],
  },
  {
    route: '/audit',
    label: 'Audit & Governance',
    feeds: [PLATFORM_ONLY],
    impact:
      'The audit trail records activity inside this platform. It is deliberately not queryable through Ask Data and is never fed from a source system.',
    derivedBy: ['Audit trail', 'AI interaction log'],
  },
  {
    route: '/integration',
    label: 'Integration',
    feeds: [PLATFORM_ONLY],
    impact:
      'The ingestion control plane describes the feeds themselves — source systems, pipelines, run history and quality results.',
    derivedBy: ['Ingestion control plane'],
  },
]

/** Longest-prefix match, so `/opportunities/abc` resolves to `/opportunities`. */
export function lineageFor(pathname: string): LineageEntry | null {
  const candidates = LINEAGE.filter(
    (l) => pathname === l.route || (l.route !== '/' && pathname.startsWith(`${l.route}/`))
  )
  if (candidates.length === 0) return pathname === '/' ? (LINEAGE[0] ?? null) : null
  return candidates.reduce((a, b) => (b.route.length > a.route.length ? b : a))
}

export function isPlatformOnly(entry: LineageEntry): boolean {
  return entry.feeds.length === 1 && entry.feeds[0] === PLATFORM_ONLY
}

export function feedLabel(key: string): string {
  if (key === PLATFORM_ONLY) return 'Platform configuration'
  return DOMAIN_BY_KEY[key]?.label ?? key
}

/**
 * The reverse view: every page a given feed reaches.
 *
 * This is the question an integrator asks before taking a connector down for
 * maintenance, and the one a director asks when a feed has failed — "what am I
 * currently looking at that I should not trust?"
 */
export function pagesForFeed(feedKey: string): LineageEntry[] {
  return LINEAGE.filter((l) => l.feeds.includes(feedKey))
}

export { PLATFORM_ONLY }
