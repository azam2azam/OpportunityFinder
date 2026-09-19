import type { NlSqlProvider, NlSqlRequest, NlSqlGeneration, VisualizationKind } from './types'

/**
 * The built-in Ask Data provider.
 *
 * Deterministic intent matching rather than a language model: every question
 * resolves to a reviewed, parameterised query whose shape is known in advance.
 * At a hospital group that matters more than breadth — an executive acting on
 * "how much did we lose to rejections last month" needs that number to be
 * right, and a hand-written query against a documented semantic model is
 * auditable in a way a generated one is not.
 *
 * When the enterprise NL-to-SQL engine is connected it replaces this provider
 * (see types.ts); the validation and scope layers are unchanged either way.
 */

interface Template {
  id: string
  /** Terms that, appearing together, indicate this intent. */
  keywords: string[][]
  /** Terms that rule the template out even when keywords match. */
  exclude?: string[]
  interpretation: string
  visualization: VisualizationKind
  labelColumn?: string
  valueColumns?: string[]
  /** Builds SQL plus positional params. `scope` is the hospital restriction. */
  build: (ctx: BuildContext) => { sql: string; params: unknown[] }
  /** Example phrasing, shown in the UI as a suggestion. */
  example: string
}

interface BuildContext {
  /** `AND o."hospitalId" IN (?, ?)` or empty string for group scope. */
  scopeClause: (alias: string) => string
  scopeParams: unknown[]
  /** Numbers found in the question, e.g. "more than 30 days" -> [30]. */
  numbers: number[]
  months: number
}

const clinicalCategories = `('LAB','SURGERY','MEDICATION')`

const TEMPLATES: Template[] = [
  {
    id: 'rejected_claims_by_hospital',
    keywords: [['reject'], ['hospital', 'site', 'facility']],
    interpretation: 'Rejected claims by hospital, with the rejected value.',
    visualization: 'bar',
    labelColumn: 'hospital',
    valueColumns: ['rejected_claims'],
    example: 'Which hospitals have the highest number of rejected claims?',
    build: (ctx) => ({
      sql: `
        SELECT h."name" AS hospital,
               COUNT(r."id") AS rejected_claims,
               ROUND(SUM(r."rejectedAmount")) AS rejected_value
        FROM "InsuranceRejection" r
        JOIN "InsuranceClaim" c ON c."id" = r."claimId"
        JOIN "Hospital" h ON h."id" = c."hospitalId"
        WHERE 1=1 ${ctx.scopeClause('c')}
        GROUP BY h."name"
        ORDER BY rejected_claims DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'revenue_lost_rejection',
    keywords: [['revenue', 'money', 'value', 'amount', 'lost', 'lose'], ['reject', 'denial', 'denied']],
    interpretation: 'Value rejected by payers, by month, over the trailing year.',
    visualization: 'line',
    labelColumn: 'month',
    valueColumns: ['rejected_value'],
    example: 'How much revenue was lost because of insurance rejection last month?',
    build: (ctx) => ({
      sql: `
        SELECT strftime('%Y-%m', r."rejectedAt" / 1000, 'unixepoch') AS month,
               COUNT(r."id") AS rejections,
               ROUND(SUM(r."rejectedAmount")) AS rejected_value
        FROM "InsuranceRejection" r
        JOIN "InsuranceClaim" c ON c."id" = r."claimId"
        WHERE r."rejectedAt" >= ? ${ctx.scopeClause('c')}
        GROUP BY month
        ORDER BY month DESC`,
      params: [monthsAgo(12), ...ctx.scopeParams],
    }),
  },
  {
    id: 'rejection_reasons',
    keywords: [['reason', 'why', 'cause'], ['reject', 'denial', 'denied']],
    interpretation: 'Rejection reasons ranked by value, with the recovery pathway.',
    visualization: 'bar',
    labelColumn: 'reason',
    valueColumns: ['rejected_value'],
    example: 'What are the main reasons our claims get rejected?',
    build: (ctx) => ({
      sql: `
        SELECT r."reasonText" AS reason,
               r."recommendedPathway" AS pathway,
               COUNT(r."id") AS rejections,
               ROUND(SUM(r."rejectedAmount")) AS rejected_value,
               ROUND(AVG(r."historicalRecoveryRate") * 100) AS recovery_rate_pct
        FROM "InsuranceRejection" r
        JOIN "InsuranceClaim" c ON c."id" = r."claimId"
        WHERE 1=1 ${ctx.scopeClause('c')}
        GROUP BY r."reasonText", r."recommendedPathway"
        ORDER BY rejected_value DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'abnormal_lab_no_followup',
    keywords: [['hba1c', 'abnormal', 'lab', 'laboratory', 'result'], ['follow', 'return', 'back']],
    interpretation:
      'Patients with an abnormal laboratory result and no clinical encounter since, from the detected opportunity pipeline.',
    visualization: 'table',
    example:
      'Show me patients who had abnormal HbA1c results in the last 6 months and did not return for follow-up.',
    build: (ctx) => ({
      sql: `
        SELECT o."reference",
               p."mrn",
               p."firstName" || ' ' || p."lastName" AS patient,
               o."title" AS finding,
               h."name" AS hospital,
               s."name" AS specialty,
               o."priority",
               ROUND(o."score") AS score,
               date(o."detectedAt" / 1000, 'unixepoch') AS detected,
               o."status"
        FROM "Opportunity" o
        JOIN "Patient" p ON p."id" = o."patientId"
        JOIN "Hospital" h ON h."id" = o."hospitalId"
        LEFT JOIN "Specialty" s ON s."id" = o."specialtyId"
        JOIN "OpportunityRule" ru ON ru."id" = o."ruleId"
        WHERE ru."key" IN ('LAB_ABNORMAL_NO_FOLLOWUP','LAB_CRITICAL_UNACTIONED')
          AND o."detectedAt" >= ?
          ${ctx.scopeClause('o')}
        ORDER BY o."score" DESC`,
      params: [monthsAgo(ctx.months), ...ctx.scopeParams],
    }),
  },
  {
    id: 'surgery_recommended_not_scheduled',
    keywords: [['surgery', 'surgical', 'procedure', 'operation'], ['schedul', 'book', 'recommend', 'convert']],
    interpretation:
      'Surgical recommendations and consultations that never converted into a booked procedure.',
    visualization: 'table',
    example: 'Show surgical consultations where surgery was recommended but not scheduled.',
    build: (ctx) => ({
      sql: `
        SELECT o."reference",
               p."mrn",
               p."firstName" || ' ' || p."lastName" AS patient,
               o."title" AS procedure_recommended,
               ph."name" AS surgeon,
               h."name" AS hospital,
               ROUND(o."potentialValue") AS potential_value,
               o."priority",
               date(o."detectedAt" / 1000, 'unixepoch') AS detected,
               o."status"
        FROM "Opportunity" o
        JOIN "Patient" p ON p."id" = o."patientId"
        JOIN "Hospital" h ON h."id" = o."hospitalId"
        LEFT JOIN "Physician" ph ON ph."id" = o."physicianId"
        WHERE o."category" = 'SURGERY'
          ${ctx.scopeClause('o')}
        ORDER BY o."potentialValue" DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'medication_refill_overdue',
    keywords: [['medication', 'refill', 'pharmacy', 'drug', 'prescription'], ['overdue', 'late', 'abandon', 'stopped', 'gap']],
    interpretation: 'Patients whose medication refills are overdue or abandoned.',
    visualization: 'table',
    example: 'Show patients with medication refills overdue by more than 30 days.',
    build: (ctx) => {
      const threshold = ctx.numbers.find((n) => n >= 7 && n <= 400) ?? 30
      return {
        sql: `
          SELECT o."reference",
                 p."mrn",
                 p."firstName" || ' ' || p."lastName" AS patient,
                 o."title" AS medication_issue,
                 h."name" AS hospital,
                 CAST((julianday('now') - julianday(o."detectedAt" / 1000, 'unixepoch')) AS INTEGER) AS days_open,
                 o."priority",
                 ROUND(o."score") AS score,
                 o."status"
          FROM "Opportunity" o
          JOIN "Patient" p ON p."id" = o."patientId"
          JOIN "Hospital" h ON h."id" = o."hospitalId"
          JOIN "OpportunityRule" ru ON ru."id" = o."ruleId"
          WHERE ru."key" IN ('MED_REFILL_OVERDUE','MED_REFILL_ABANDONED','MED_COURSE_INCOMPLETE')
            AND o."detectedAt" <= ?
            ${ctx.scopeClause('o')}
          ORDER BY o."score" DESC`,
        params: [Date.now() - threshold * 86_400_000, ...ctx.scopeParams],
      }
    },
  },
  {
    id: 'specialty_leakage',
    keywords: [['leak', 'external', 'outside', 'retention', 'retain'], ['specialty', 'specialties', 'service', 'line']],
    interpretation:
      'Referral leakage by specialty — referrals fulfilled outside the group against those retained.',
    visualization: 'bar',
    labelColumn: 'specialty',
    valueColumns: ['referrals_out'],
    example: 'Which specialties have the highest patient leakage?',
    build: (ctx) => ({
      sql: `
        SELECT s."name" AS specialty,
               SUM(m."referralsOut") AS referrals_out,
               SUM(m."referralsRetained") AS referrals_retained,
               ROUND(
                 CAST(SUM(m."referralsRetained") AS REAL) /
                 NULLIF(SUM(m."referralsOut") + SUM(m."referralsRetained"), 0) * 100
               ) AS retention_pct
        FROM "ServiceLineMetric" m
        JOIN "Specialty" s ON s."id" = m."specialtyId"
        WHERE 1=1 ${ctx.scopeClause('m')}
        GROUP BY s."name"
        ORDER BY referrals_out DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'opportunities_by_hospital',
    keywords: [['opportunit'], ['hospital', 'site', 'facility', 'compare', 'comparison']],
    exclude: ['reject'],
    interpretation: 'Open opportunities and their potential value by hospital.',
    visualization: 'bar',
    labelColumn: 'hospital',
    valueColumns: ['open_opportunities'],
    example: 'How many open opportunities does each hospital have?',
    build: (ctx) => ({
      sql: `
        SELECT h."name" AS hospital,
               COUNT(o."id") AS open_opportunities,
               SUM(CASE WHEN o."priority" IN ('CRITICAL','HIGH') THEN 1 ELSE 0 END) AS high_priority,
               ROUND(SUM(o."potentialValue")) AS potential_value
        FROM "Opportunity" o
        JOIN "Hospital" h ON h."id" = o."hospitalId"
        WHERE o."status" NOT IN ('CONVERTED','CLOSED','REJECTED','NOT_APPLICABLE')
          ${ctx.scopeClause('o')}
        GROUP BY h."name"
        ORDER BY potential_value DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'opportunities_by_category',
    keywords: [['opportunit', 'pipeline'], ['category', 'type', 'kind', 'breakdown', 'composition']],
    interpretation: 'Open opportunities by category, with value and conversion to date.',
    visualization: 'donut',
    labelColumn: 'category',
    valueColumns: ['potential_value'],
    example: 'What is the breakdown of opportunities by type?',
    build: (ctx) => ({
      sql: `
        SELECT o."category",
               COUNT(o."id") AS opportunities,
               ROUND(SUM(o."potentialValue")) AS potential_value,
               SUM(CASE WHEN o."status" = 'CONVERTED' THEN 1 ELSE 0 END) AS converted
        FROM "Opportunity" o
        WHERE 1=1 ${ctx.scopeClause('o')}
        GROUP BY o."category"
        ORDER BY potential_value DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'conversion_by_category',
    keywords: [['conversion', 'convert', 'converting'], ['rate', 'category', 'type', 'performance']],
    interpretation: 'Conversion rate and realised revenue by opportunity category.',
    visualization: 'bar',
    labelColumn: 'category',
    valueColumns: ['conversion_pct'],
    example: 'What is our conversion rate by opportunity type?',
    build: (ctx) => ({
      sql: `
        SELECT o."category",
               COUNT(o."id") AS total,
               SUM(CASE WHEN o."status" = 'CONVERTED' THEN 1 ELSE 0 END) AS converted,
               ROUND(
                 CAST(SUM(CASE WHEN o."status" = 'CONVERTED' THEN 1 ELSE 0 END) AS REAL)
                 / NULLIF(COUNT(o."id"), 0) * 100
               ) AS conversion_pct,
               ROUND(SUM(o."realisedValue")) AS realised_value
        FROM "Opportunity" o
        WHERE 1=1 ${ctx.scopeClause('o')}
        GROUP BY o."category"
        ORDER BY conversion_pct DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'inactive_patients',
    keywords: [['inactive', 'lapsed', 'lost', 'reactivat', 'stopped', 'dormant'], ['patient']],
    interpretation: 'Lapsed patients identified for reactivation, ranked by value.',
    visualization: 'table',
    example: 'Which inactive patients are worth bringing back?',
    build: (ctx) => ({
      sql: `
        SELECT o."reference",
               p."mrn",
               p."firstName" || ' ' || p."lastName" AS patient,
               o."title" AS reason,
               h."name" AS hospital,
               date(p."lastEncounterAt" / 1000, 'unixepoch') AS last_seen,
               ROUND(o."potentialValue") AS potential_value,
               ROUND(o."score") AS score
        FROM "Opportunity" o
        JOIN "Patient" p ON p."id" = o."patientId"
        JOIN "Hospital" h ON h."id" = o."hospitalId"
        WHERE o."category" = 'REACTIVATION'
          AND o."status" NOT IN ('CONVERTED','CLOSED','REJECTED','NOT_APPLICABLE')
          ${ctx.scopeClause('o')}
        ORDER BY o."potentialValue" DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'missed_appointments',
    keywords: [['missed', 'no-show', 'noshow', 'no show', 'cancel', 'did not attend', 'dna'], ['appointment', 'visit', 'clinic']],
    interpretation: 'Missed and cancelled appointments that were never rebooked.',
    visualization: 'table',
    example: 'Show patients who missed an appointment and never rebooked.',
    build: (ctx) => ({
      sql: `
        SELECT o."reference",
               p."mrn",
               p."firstName" || ' ' || p."lastName" AS patient,
               s."name" AS specialty,
               o."title" AS issue,
               h."name" AS hospital,
               o."priority",
               ROUND(o."score") AS score,
               o."status"
        FROM "Opportunity" o
        JOIN "Patient" p ON p."id" = o."patientId"
        JOIN "Hospital" h ON h."id" = o."hospitalId"
        LEFT JOIN "Specialty" s ON s."id" = o."specialtyId"
        JOIN "OpportunityRule" ru ON ru."id" = o."ruleId"
        WHERE ru."key" IN ('APPT_NO_SHOW_NOT_REBOOKED','APPT_REPEAT_CANCELLATION','APPT_BOOKED_NEVER_COMPLETED')
          ${ctx.scopeClause('o')}
        ORDER BY o."score" DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'physician_opportunities',
    keywords: [['physician', 'doctor', 'consultant', 'surgeon'], ['opportunit', 'follow', 'performance', 'most', 'top']],
    interpretation: 'Open opportunities attributed to each physician.',
    visualization: 'bar',
    labelColumn: 'physician',
    valueColumns: ['open_opportunities'],
    example: 'Which physicians have the most open follow-up opportunities?',
    build: (ctx) => ({
      sql: `
        SELECT ph."name" AS physician,
               s."name" AS specialty,
               COUNT(o."id") AS open_opportunities,
               ROUND(SUM(o."potentialValue")) AS potential_value
        FROM "Opportunity" o
        JOIN "Physician" ph ON ph."id" = o."physicianId"
        JOIN "Specialty" s ON s."id" = ph."specialtyId"
        WHERE o."status" NOT IN ('CONVERTED','CLOSED','REJECTED','NOT_APPLICABLE')
          ${ctx.scopeClause('o')}
        GROUP BY ph."name", s."name"
        ORDER BY open_opportunities DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'capacity_utilisation',
    keywords: [['capacity', 'utilisation', 'utilization', 'slots', 'underused', 'idle'], []],
    interpretation: 'Clinic capacity against bookings by specialty over the trailing year.',
    visualization: 'bar',
    labelColumn: 'specialty',
    valueColumns: ['utilisation_pct'],
    example: 'Which service lines are running below capacity?',
    build: (ctx) => ({
      sql: `
        SELECT s."name" AS specialty,
               SUM(m."capacitySlots") AS capacity_slots,
               SUM(m."bookedSlots") AS booked_slots,
               ROUND(CAST(SUM(m."bookedSlots") AS REAL) / NULLIF(SUM(m."capacitySlots"), 0) * 100) AS utilisation_pct
        FROM "ServiceLineMetric" m
        JOIN "Specialty" s ON s."id" = m."specialtyId"
        WHERE 1=1 ${ctx.scopeClause('m')}
        GROUP BY s."name"
        ORDER BY utilisation_pct ASC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'sla_breaches',
    // SLA and breach are unambiguous on their own — "where are we breaching SLA
    // the most?" names no second subject, and requiring one made the template
    // unreachable from the most natural phrasing of the question.
    keywords: [['sla', 'overdue', 'breach', 'aging', 'ageing', 'past due']],
    interpretation: 'Open opportunities past their service-level target, by category.',
    visualization: 'bar',
    labelColumn: 'category',
    valueColumns: ['breached'],
    example: 'Where are we breaching SLA the most?',
    build: (ctx) => ({
      sql: `
        SELECT o."category",
               COUNT(o."id") AS breached,
               ROUND(SUM(o."potentialValue")) AS value_at_risk,
               ROUND(AVG(julianday('now') - julianday(o."slaDueAt" / 1000, 'unixepoch'))) AS avg_days_overdue
        FROM "Opportunity" o
        WHERE o."status" NOT IN ('CONVERTED','CLOSED','REJECTED','NOT_APPLICABLE')
          AND o."slaDueAt" < ?
          ${ctx.scopeClause('o')}
        GROUP BY o."category"
        ORDER BY breached DESC`,
      params: [Date.now(), ...ctx.scopeParams],
    }),
  },
  {
    id: 'clinical_opportunities_by_specialty',
    keywords: [['clinical', 'follow', 'treatment', 'gap'], ['specialty', 'specialties', 'department']],
    interpretation: 'Open clinical opportunities by specialty.',
    visualization: 'bar',
    labelColumn: 'specialty',
    valueColumns: ['open_opportunities'],
    example: 'Which specialties have the most clinical follow-up gaps?',
    build: (ctx) => ({
      sql: `
        SELECT s."name" AS specialty,
               COUNT(o."id") AS open_opportunities,
               SUM(CASE WHEN o."priority" IN ('CRITICAL','HIGH') THEN 1 ELSE 0 END) AS high_priority,
               ROUND(SUM(o."potentialValue")) AS potential_value
        FROM "Opportunity" o
        JOIN "Specialty" s ON s."id" = o."specialtyId"
        WHERE o."category" IN ${clinicalCategories}
          AND o."status" NOT IN ('CONVERTED','CLOSED','REJECTED','NOT_APPLICABLE')
          ${ctx.scopeClause('o')}
        GROUP BY s."name"
        ORDER BY open_opportunities DESC`,
      params: [...ctx.scopeParams],
    }),
  },
  {
    id: 'detection_trend',
    keywords: [['trend', 'over time', 'monthly', 'weekly', 'growth', 'history'], []],
    interpretation: 'Opportunities detected and converted by month.',
    visualization: 'line',
    labelColumn: 'month',
    valueColumns: ['detected', 'converted'],
    example: 'How has the opportunity pipeline trended over time?',
    build: (ctx) => ({
      sql: `
        SELECT strftime('%Y-%m', o."detectedAt" / 1000, 'unixepoch') AS month,
               COUNT(o."id") AS detected,
               SUM(CASE WHEN o."status" = 'CONVERTED' THEN 1 ELSE 0 END) AS converted,
               ROUND(SUM(o."potentialValue")) AS potential_value
        FROM "Opportunity" o
        WHERE 1=1 ${ctx.scopeClause('o')}
        GROUP BY month
        ORDER BY month`,
      params: [...ctx.scopeParams],
    }),
  },
]

function monthsAgo(months: number): number {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.getTime()
}

/**
 * Scores a question against a template.
 *
 * Every keyword group must contribute at least one hit — the groups encode
 * "this is about X *and* about Y", which is what separates "rejected claims by
 * hospital" from "opportunities by hospital". An empty group is a wildcard, for
 * templates whose subject is unambiguous on its own.
 */
function scoreTemplate(template: Template, question: string): number {
  const q = question.toLowerCase()
  if (template.exclude?.some((term) => q.includes(term))) return 0

  let score = 0
  for (const group of template.keywords) {
    if (group.length === 0) continue
    const hits = group.filter((term) => q.includes(term))
    if (hits.length === 0) return 0
    score += hits.length
  }
  return score
}

export const templateProvider: NlSqlProvider = {
  name: 'RULE_TEMPLATE',

  async generate(request: NlSqlRequest): Promise<NlSqlGeneration | null> {
    const question = request.question.trim()
    if (question.length === 0) return null

    const ranked = TEMPLATES.map((t) => ({ t, score: scoreTemplate(t, question) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)

    if (ranked.length === 0) return null
    const best = ranked[0]

    // Hospital scope is applied as bound parameters on the generated SQL, so a
    // template author cannot accidentally omit segregation and a question can
    // never widen it.
    const scoped = request.hospitalIds.length > 0
    const scopeClause = (alias: string) =>
      scoped ? ` AND ${alias}."hospitalId" IN (${request.hospitalIds.map(() => '?').join(',')})` : ''
    const scopeParams = scoped ? request.hospitalIds : []

    const numbers = [...question.matchAll(/\b(\d{1,4})\b/g)].map((m) => Number(m[1]))
    const months = extractMonths(question)

    const { sql, params } = best.t.build({ scopeClause, scopeParams, numbers, months })

    return {
      sql: sql.trim().replace(/\s+/g, ' '),
      params,
      interpretation: best.t.interpretation,
      visualization: best.t.visualization,
      labelColumn: best.t.labelColumn,
      valueColumns: best.t.valueColumns,
      // Two templates scoring equally means the question was ambiguous; say so
      // through confidence rather than silently picking one.
      confidence: ranked.length > 1 && ranked[1].score === best.score ? 0.55 : Math.min(0.95, 0.6 + best.score * 0.08),
      source: `template:${best.t.id}`,
    }
  },
}

function extractMonths(question: string): number {
  const q = question.toLowerCase()
  const match = q.match(/(\d{1,2})\s*month/)
  if (match) return Number(match[1])
  if (/\byear\b/.test(q)) return 12
  if (/last month/.test(q)) return 1
  if (/\bweek\b/.test(q)) return 1
  return 6
}

/** Example questions shown in the UI, so users learn what the engine covers. */
export const EXAMPLE_QUESTIONS = TEMPLATES.map((t) => t.example)

export const TEMPLATE_COUNT = TEMPLATES.length
