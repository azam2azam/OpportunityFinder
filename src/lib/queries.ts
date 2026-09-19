import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { can, hospitalFilter, visibleCategories, type Principal } from './rbac'
import { FUNNEL_STAGES, TERMINAL_STATUSES, isTerminal, STATUS_LABEL, CATEGORY_LABEL } from './enums'

/**
 * The scoped data-access layer.
 *
 * Every read that can reach patient-linked rows goes through `scopeWhere`,
 * which folds the principal's hospital segregation and visible categories into
 * the Prisma filter. Pages never build their own `where` for opportunities —
 * that is what keeps a missed check from becoming a cross-hospital data leak.
 */

export interface OpportunityFilters {
  hospitalId?: string
  category?: string
  /**
   * A set of categories the view is restricted to. Modules that cover a domain
   * rather than a single rule type use this — Clinical Opportunities spans
   * laboratory, surgical and medication findings — and `category` then narrows
   * within it.
   */
  categories?: string[]
  priority?: string
  status?: string
  /** 'open' excludes terminal states; 'closed' keeps only them. */
  lifecycle?: 'open' | 'closed' | 'all'
  specialtyId?: string
  departmentId?: string
  physicianId?: string
  ownerUserId?: string
  /** 'me' resolves to the principal; 'unassigned' means no owner. */
  owner?: 'me' | 'unassigned'
  search?: string
  detectedFrom?: Date
  detectedTo?: Date
  slaBreached?: boolean
  minScore?: number
}

export function scopeWhere(
  principal: Principal,
  filters: OpportunityFilters = {}
): Prisma.OpportunityWhereInput {
  const where: Prisma.OpportunityWhereInput = {}
  const and: Prisma.OpportunityWhereInput[] = []

  // Hospital segregation. A GROUP principal gets no constraint; everyone else
  // gets an explicit list, and an explicitly requested hospital is intersected
  // with it rather than replacing it.
  const scope = hospitalFilter(principal)
  if (scope.hospitalId) and.push({ hospitalId: scope.hospitalId })
  if (filters.hospitalId) and.push({ hospitalId: filters.hospitalId })

  // Category visibility follows from the role: an RCM specialist has no
  // business reading clinical follow-ups.
  const allowed = visibleCategories(principal)
  and.push({ category: { in: allowed } })
  // A module's category set is intersected with the role's, never unioned: a
  // page cannot widen what its viewer is entitled to see.
  if (filters.categories?.length) {
    and.push({ category: { in: filters.categories.filter((c) => allowed.includes(c)) } })
  }
  if (filters.category) and.push({ category: filters.category })

  if (filters.priority) and.push({ priority: filters.priority })
  if (filters.status) and.push({ status: filters.status })
  if (filters.lifecycle === 'open') and.push({ status: { notIn: TERMINAL_STATUSES } })
  if (filters.lifecycle === 'closed') and.push({ status: { in: TERMINAL_STATUSES } })
  if (filters.specialtyId) and.push({ specialtyId: filters.specialtyId })
  if (filters.departmentId) and.push({ departmentId: filters.departmentId })
  if (filters.physicianId) and.push({ physicianId: filters.physicianId })
  if (filters.ownerUserId) and.push({ ownerUserId: filters.ownerUserId })
  if (filters.owner === 'me') and.push({ ownerUserId: principal.userId })
  if (filters.owner === 'unassigned') and.push({ ownerUserId: null })
  if (filters.minScore != null) and.push({ score: { gte: filters.minScore } })

  if (filters.detectedFrom || filters.detectedTo) {
    and.push({
      detectedAt: {
        ...(filters.detectedFrom ? { gte: filters.detectedFrom } : {}),
        ...(filters.detectedTo ? { lte: filters.detectedTo } : {}),
      },
    })
  }

  // An SLA is only breached while the work is still open — a converted
  // opportunity that took three weeks is a slow success, not a live breach.
  if (filters.slaBreached) {
    and.push({ slaDueAt: { lt: new Date() }, status: { notIn: TERMINAL_STATUSES } })
  }

  if (filters.search) {
    const q = filters.search.trim()
    and.push({
      OR: [
        { reference: { contains: q } },
        { title: { contains: q } },
        { patient: { mrn: { contains: q } } },
        // Name search is only offered to principals allowed to see names;
        // otherwise it would confirm identities through the result count.
        ...(can(principal, 'patient.view.phi')
          ? [
              { patient: { firstName: { contains: q } } } as Prisma.OpportunityWhereInput,
              { patient: { lastName: { contains: q } } } as Prisma.OpportunityWhereInput,
            ]
          : []),
      ],
    })
  }

  where.AND = and
  return where
}

export const OPPORTUNITY_LIST_SELECT = {
  id: true,
  reference: true,
  title: true,
  category: true,
  priority: true,
  status: true,
  score: true,
  potentialValue: true,
  realisedValue: true,
  detectedAt: true,
  slaDueAt: true,
  lastActionAt: true,
  nextActionAt: true,
  ownerTeam: true,
  recommendedAction: true,
  confidence: true,
  hospital: { select: { id: true, name: true, code: true } },
  specialty: { select: { id: true, name: true, line: true } },
  department: { select: { id: true, name: true } },
  physician: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  patient: {
    select: {
      id: true, mrn: true, firstName: true, lastName: true, phone: true,
      email: true, nationalIdMasked: true, dateOfBirth: true, gender: true,
      preferredChannel: true, contactable: true,
    },
  },
} satisfies Prisma.OpportunitySelect

export type OpportunityListItem = Prisma.OpportunityGetPayload<{
  select: typeof OPPORTUNITY_LIST_SELECT
}>

export type SortKey = 'score' | 'value' | 'detected' | 'sla' | 'priority'

const ORDER: Record<SortKey, Prisma.OpportunityOrderByWithRelationInput[]> = {
  score: [{ score: 'desc' }, { detectedAt: 'desc' }],
  value: [{ potentialValue: 'desc' }, { score: 'desc' }],
  detected: [{ detectedAt: 'desc' }],
  // Nulls sort last in SQLite for ASC, which is what we want: work with no SLA
  // should not outrank work that has one.
  sla: [{ slaDueAt: 'asc' }, { score: 'desc' }],
  priority: [{ priority: 'asc' }, { score: 'desc' }],
}

export async function listOpportunities(
  principal: Principal,
  filters: OpportunityFilters,
  options: { skip?: number; take?: number; sort?: SortKey } = {}
): Promise<{ items: OpportunityListItem[]; total: number }> {
  const where = scopeWhere(principal, filters)
  const [items, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      select: OPPORTUNITY_LIST_SELECT,
      orderBy: ORDER[options.sort ?? 'score'],
      skip: options.skip ?? 0,
      take: options.take ?? 50,
    }),
    prisma.opportunity.count({ where }),
  ])
  return { items, total }
}

export async function getOpportunity(principal: Principal, id: string) {
  // Fetch under the principal's scope rather than fetching then checking — a
  // row outside scope must be indistinguishable from one that does not exist.
  const where = scopeWhere(principal, {})
  return prisma.opportunity.findFirst({
    where: { AND: [{ id }, where] },
    include: {
      rule: true,
      hospital: true,
      department: true,
      specialty: true,
      physician: { select: { id: true, name: true, code: true, specialty: { select: { name: true } } } },
      owner: { select: { id: true, name: true, title: true } },
      scoringModel: { select: { id: true, name: true } },
      conversion: true,
      actions: {
        orderBy: { performedAt: 'desc' },
        include: { performedBy: { select: { id: true, name: true, title: true } } },
      },
      communications: { orderBy: { sentAt: 'desc' }, take: 20 },
      patient: {
        include: {
          payer: { select: { name: true, code: true } },
          primaryPhysician: { select: { id: true, name: true, specialty: { select: { name: true } } } },
        },
      },
    },
  })
}

/**
 * The full clinical timeline for a patient, merged into one ordered stream.
 *
 * The spec's opportunity profile shows registration through follow-up as a
 * single narrative; keeping each domain in its own list would make the reader
 * reconstruct the chronology themselves.
 */
export interface TimelineEvent {
  at: Date
  kind: 'REGISTRATION' | 'ENCOUNTER' | 'DIAGNOSIS' | 'LAB' | 'MEDICATION' | 'SURGERY' | 'CLAIM' | 'APPOINTMENT' | 'REFERRAL' | 'COMMUNICATION'
  title: string
  detail: string
  emphasis?: 'normal' | 'warning' | 'critical' | 'positive'
}

export async function getPatientTimeline(patientId: string, limit = 80): Promise<TimelineEvent[]> {
  const [patient, encounters, labs, surgeries, prescriptions, claims, appointments, referrals, diagnoses] =
    await Promise.all([
      prisma.patient.findUnique({ where: { id: patientId }, select: { registeredAt: true, hospital: { select: { name: true } } } }),
      prisma.encounter.findMany({
        where: { patientId },
        orderBy: { startedAt: 'desc' }, take: 25,
        select: { startedAt: true, type: true, chiefComplaint: true, grossCharge: true, followUpRecommended: true, followUpDays: true, specialty: { select: { name: true } }, physician: { select: { name: true } } },
      }),
      prisma.labResult.findMany({
        where: { patientId }, orderBy: { resultedAt: 'desc' }, take: 25,
        select: { resultedAt: true, testName: true, value: true, unit: true, flag: true, isPending: true, refLow: true, refHigh: true },
      }),
      prisma.surgery.findMany({ where: { patientId }, orderBy: { recommendedAt: 'desc' }, take: 10 }),
      prisma.prescription.findMany({
        where: { patientId }, orderBy: { prescribedAt: 'desc' }, take: 15,
        select: { prescribedAt: true, dosage: true, daysSupply: true, medication: { select: { name: true, isChronic: true } } },
      }),
      prisma.insuranceClaim.findMany({
        where: { patientId }, orderBy: { serviceDate: 'desc' }, take: 15,
        include: { rejections: true, payer: { select: { name: true } } },
      }),
      prisma.appointment.findMany({ where: { patientId }, orderBy: { scheduledFor: 'desc' }, take: 20, include: { specialty: { select: { name: true } } } }),
      prisma.referral.findMany({ where: { patientId }, orderBy: { issuedAt: 'desc' }, take: 10, include: { toSpecialty: { select: { name: true } } } }),
      prisma.diagnosis.findMany({ where: { patientId }, orderBy: { diagnosedAt: 'desc' }, take: 15 }),
    ])

  const events: TimelineEvent[] = []

  if (patient) {
    events.push({
      at: patient.registeredAt,
      kind: 'REGISTRATION',
      title: 'Registered',
      detail: `First registered at ${patient.hospital.name}.`,
    })
  }

  for (const e of encounters) {
    events.push({
      at: e.startedAt,
      kind: 'ENCOUNTER',
      title: `${e.specialty.name} — ${e.type.toLowerCase()}`,
      detail:
        `${e.chiefComplaint ?? 'Clinical encounter'} with ${e.physician.name}.` +
        (e.followUpRecommended && e.followUpDays ? ` Follow-up recommended in ${e.followUpDays} days.` : ''),
      emphasis: e.type === 'EMERGENCY' ? 'warning' : 'normal',
    })
  }

  for (const l of labs) {
    const critical = l.flag.startsWith('CRITICAL')
    events.push({
      at: l.resultedAt,
      kind: 'LAB',
      title: l.isPending ? `${l.testName} — pending` : `${l.testName} — ${l.flag.replace('_', ' ').toLowerCase()}`,
      detail: l.isPending
        ? 'Ordered; no result filed.'
        : `${l.value ?? '—'} ${l.unit} (reference ${l.refLow ?? '—'}–${l.refHigh ?? '—'}).`,
      emphasis: critical ? 'critical' : l.flag !== 'NORMAL' ? 'warning' : 'normal',
    })
  }

  for (const d of diagnoses) {
    events.push({
      at: d.diagnosedAt,
      kind: 'DIAGNOSIS',
      title: `${d.icd10} — ${d.description}`,
      detail: d.isChronic ? 'Chronic condition.' : 'Acute presentation.',
    })
  }

  for (const s of surgeries) {
    events.push({
      at: s.performedAt ?? s.scheduledFor ?? s.recommendedAt,
      kind: 'SURGERY',
      title: `${s.description} — ${s.status.replace(/_/g, ' ').toLowerCase()}`,
      detail: `${s.cptCode}, ${s.urgency.toLowerCase()}.${s.cancelReason ? ` Cancelled: ${s.cancelReason}.` : ''}`,
      emphasis: s.status === 'PERFORMED' ? 'positive' : s.status === 'CANCELLED' ? 'warning' : 'normal',
    })
  }

  for (const r of prescriptions) {
    events.push({
      at: r.prescribedAt,
      kind: 'MEDICATION',
      title: `${r.medication.name} prescribed`,
      detail: `${r.dosage}, ${r.daysSupply} days supply.${r.medication.isChronic ? ' Long-term therapy.' : ''}`,
    })
  }

  for (const c of claims) {
    const rejection = c.rejections[0]
    events.push({
      at: c.serviceDate,
      kind: 'CLAIM',
      title: `${c.serviceDescription} — ${c.status.replace(/_/g, ' ').toLowerCase()}`,
      detail: rejection
        ? `${c.payer.name}: ${rejection.reasonText}.`
        : `${c.payer.name}, billed ${Math.round(c.billedAmount).toLocaleString()} SAR.`,
      emphasis: c.status === 'REJECTED' ? 'warning' : c.status === 'PAID' ? 'positive' : 'normal',
    })
  }

  for (const a of appointments) {
    events.push({
      at: a.scheduledFor,
      kind: 'APPOINTMENT',
      title: `${a.specialty.name} appointment — ${a.status.replace(/_/g, ' ').toLowerCase()}`,
      detail: a.isFollowUp ? 'Follow-up appointment.' : 'New appointment.',
      emphasis: a.status === 'NO_SHOW' ? 'warning' : a.status === 'COMPLETED' ? 'positive' : 'normal',
    })
  }

  for (const r of referrals) {
    events.push({
      at: r.issuedAt,
      kind: 'REFERRAL',
      title: `Referral to ${r.toSpecialty.name} — ${r.status.toLowerCase()}`,
      detail: `${r.reason}.${r.externalProvider ? ` Fulfilled by ${r.externalProvider}.` : ''}`,
      emphasis: r.status === 'LEAKED' || r.status === 'EXPIRED' ? 'warning' : 'normal',
    })
  }

  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit)
}

// ── aggregate analytics ─────────────────────────────────────────────────

export interface KpiSet {
  activeOpportunities: number
  highPriority: number
  potentialValue: number
  patientsRequiringAction: number
  insuranceRecoveryPotential: number
  followUpOpportunities: number
  reactivationOpportunities: number
  conversionRate: number
  realisedValue: number
  slaBreached: number
  /** Same metrics for the preceding equal-length window, for trend arrows. */
  previous: {
    activeOpportunities: number
    highPriority: number
    potentialValue: number
    conversionRate: number
    insuranceRecoveryPotential: number
    realisedValue: number
  }
}

/**
 * Headline KPIs for the executive and hospital dashboards.
 *
 * "Active" means open work regardless of when it was detected — a director
 * needs the size of the standing backlog, not just this week's arrivals. The
 * period window is used for the comparison figures and for conversion, both of
 * which are only meaningful over a bounded span.
 */
export async function getKpis(
  principal: Principal,
  filters: OpportunityFilters = {},
  periodDays = 30
): Promise<KpiSet> {
  const now = new Date()
  const periodStart = new Date(now.getTime() - periodDays * 86_400_000)
  const priorStart = new Date(now.getTime() - periodDays * 2 * 86_400_000)

  const base = scopeWhere(principal, filters)
  const open = scopeWhere(principal, { ...filters, lifecycle: 'open' })

  const [
    activeOpportunities,
    highPriority,
    openAgg,
    patientsRequiringAction,
    insuranceAgg,
    followUpCount,
    reactivationCount,
    slaBreached,
    periodTotal,
    periodConverted,
    priorTotal,
    priorConverted,
    realisedAgg,
    priorRealisedAgg,
    priorOpenCount,
    priorHighCount,
    priorInsuranceAgg,
  ] = await Promise.all([
    prisma.opportunity.count({ where: open }),
    prisma.opportunity.count({ where: { AND: [open, { priority: { in: ['CRITICAL', 'HIGH'] } }] } }),
    prisma.opportunity.aggregate({ where: open, _sum: { potentialValue: true } }),
    prisma.opportunity
      .findMany({ where: { AND: [open, { patientId: { not: null } }] }, select: { patientId: true }, distinct: ['patientId'] })
      .then((r) => r.length),
    prisma.opportunity.aggregate({
      where: { AND: [open, { category: 'INSURANCE' }] },
      _sum: { potentialValue: true },
    }),
    prisma.opportunity.count({ where: { AND: [open, { category: { in: ['LAB', 'APPOINTMENT', 'MEDICATION'] } }] } }),
    prisma.opportunity.count({ where: { AND: [open, { category: 'REACTIVATION' }] } }),
    prisma.opportunity.count({
      where: { AND: [open, { slaDueAt: { lt: now } }] },
    }),
    prisma.opportunity.count({ where: { AND: [base, { detectedAt: { gte: periodStart } }] } }),
    prisma.opportunity.count({ where: { AND: [base, { detectedAt: { gte: periodStart } }, { status: 'CONVERTED' }] } }),
    prisma.opportunity.count({ where: { AND: [base, { detectedAt: { gte: priorStart, lt: periodStart } }] } }),
    prisma.opportunity.count({
      where: { AND: [base, { detectedAt: { gte: priorStart, lt: periodStart } }, { status: 'CONVERTED' }] },
    }),
    prisma.opportunity.aggregate({
      where: { AND: [base, { closedAt: { gte: periodStart } }, { status: 'CONVERTED' }] },
      _sum: { realisedValue: true },
    }),
    prisma.opportunity.aggregate({
      where: { AND: [base, { closedAt: { gte: priorStart, lt: periodStart } }, { status: 'CONVERTED' }] },
      _sum: { realisedValue: true },
    }),
    prisma.opportunity.count({
      where: { AND: [base, { detectedAt: { lt: periodStart } }, { status: { notIn: TERMINAL_STATUSES } }] },
    }),
    prisma.opportunity.count({
      where: {
        AND: [base, { detectedAt: { lt: periodStart } }, { status: { notIn: TERMINAL_STATUSES } }, { priority: { in: ['CRITICAL', 'HIGH'] } }],
      },
    }),
    prisma.opportunity.aggregate({
      where: { AND: [base, { detectedAt: { lt: periodStart } }, { category: 'INSURANCE' }, { status: { notIn: TERMINAL_STATUSES } }] },
      _sum: { potentialValue: true },
    }),
  ])

  return {
    activeOpportunities,
    highPriority,
    potentialValue: openAgg._sum.potentialValue ?? 0,
    patientsRequiringAction,
    insuranceRecoveryPotential: insuranceAgg._sum.potentialValue ?? 0,
    followUpOpportunities: followUpCount,
    reactivationOpportunities: reactivationCount,
    conversionRate: periodTotal > 0 ? periodConverted / periodTotal : 0,
    realisedValue: realisedAgg._sum.realisedValue ?? 0,
    slaBreached,
    previous: {
      activeOpportunities: priorOpenCount,
      highPriority: priorHighCount,
      potentialValue: priorInsuranceAgg._sum.potentialValue ?? 0,
      conversionRate: priorTotal > 0 ? priorConverted / priorTotal : 0,
      insuranceRecoveryPotential: priorInsuranceAgg._sum.potentialValue ?? 0,
      realisedValue: priorRealisedAgg._sum.realisedValue ?? 0,
    },
  }
}

export interface FunnelStage {
  key: string
  label: string
  count: number
  /** Share of the stage above it — where the drop-off actually happens. */
  stepRate: number
  /** Share of the top of the funnel. */
  overallRate: number
}

/**
 * Funnel occupancy by furthest stage reached, not by current status.
 *
 * An opportunity that converted passed through "contacted"; counting only its
 * current status would show zero at every intermediate stage and make the
 * funnel useless. Stage membership therefore comes from the action history.
 */
export async function getFunnel(
  principal: Principal,
  filters: OpportunityFilters = {}
): Promise<FunnelStage[]> {
  const where = scopeWhere(principal, filters)

  const [total, reached] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunityAction.findMany({
      where: { toStatus: { in: [...FUNNEL_STAGES] }, opportunity: where },
      select: { opportunityId: true, toStatus: true },
      distinct: ['opportunityId', 'toStatus'],
    }),
  ])

  const counts = new Map<string, number>()
  for (const r of reached) {
    if (!r.toStatus) continue
    counts.set(r.toStatus, (counts.get(r.toStatus) ?? 0) + 1)
  }

  const stages: FunnelStage[] = []
  let previousCount = total
  for (const stage of FUNNEL_STAGES) {
    const c = stage === 'DETECTED' ? total : (counts.get(stage) ?? 0)
    stages.push({
      key: stage,
      label: STATUS_LABEL[stage],
      count: c,
      stepRate: previousCount > 0 ? c / previousCount : 0,
      overallRate: total > 0 ? c / total : 0,
    })
    previousCount = c
  }
  return stages
}

export interface CategorySummary {
  category: string
  label: string
  open: number
  critical: number
  potentialValue: number
  converted: number
  realisedValue: number
  conversionRate: number
}

export async function getCategorySummary(
  principal: Principal,
  filters: OpportunityFilters = {}
): Promise<CategorySummary[]> {
  const where = scopeWhere(principal, filters)
  const rows = await prisma.opportunity.findMany({
    where,
    select: { category: true, status: true, priority: true, potentialValue: true, realisedValue: true },
  })

  const map = new Map<string, CategorySummary>()
  for (const r of rows) {
    let s = map.get(r.category)
    if (!s) {
      s = {
        category: r.category,
        label: CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category,
        open: 0, critical: 0, potentialValue: 0, converted: 0, realisedValue: 0, conversionRate: 0,
      }
      map.set(r.category, s)
    }
    if (!isTerminal(r.status)) {
      s.open++
      s.potentialValue += r.potentialValue
      if (r.priority === 'CRITICAL') s.critical++
    }
    if (r.status === 'CONVERTED') {
      s.converted++
      s.realisedValue += r.realisedValue
    }
  }

  const out = [...map.values()]
  for (const s of out) {
    const totalInCategory = rows.filter((r) => r.category === s.category).length
    s.conversionRate = totalInCategory > 0 ? s.converted / totalInCategory : 0
  }
  return out.sort((a, b) => b.potentialValue - a.potentialValue)
}

export interface HospitalComparison {
  hospitalId: string
  name: string
  code: string
  city: string
  patients: number
  open: number
  critical: number
  potentialValue: number
  converted: number
  realisedValue: number
  conversionRate: number
  slaBreached: number
  avgAgeDays: number
}

export async function getHospitalComparison(
  principal: Principal,
  filters: OpportunityFilters = {}
): Promise<HospitalComparison[]> {
  const where = scopeWhere(principal, filters)
  const [hospitals, rows, patientCounts] = await Promise.all([
    prisma.hospital.findMany({
      where: principal.scopeLevel === 'GROUP' ? {} : { id: { in: principal.hospitalIds } },
      select: { id: true, name: true, code: true, city: true },
    }),
    prisma.opportunity.findMany({
      where,
      select: { hospitalId: true, status: true, priority: true, potentialValue: true, realisedValue: true, detectedAt: true, slaDueAt: true },
    }),
    prisma.patient.groupBy({ by: ['hospitalId'], _count: true }),
  ])

  const now = Date.now()
  const patientsBy = new Map(patientCounts.map((p) => [p.hospitalId, p._count]))

  return hospitals
    .map((h) => {
      const mine = rows.filter((r) => r.hospitalId === h.id)
      const open = mine.filter((r) => !isTerminal(r.status))
      const converted = mine.filter((r) => r.status === 'CONVERTED')
      const ageSum = open.reduce((s, r) => s + (now - r.detectedAt.getTime()) / 86_400_000, 0)
      return {
        hospitalId: h.id,
        name: h.name,
        code: h.code,
        city: h.city,
        patients: patientsBy.get(h.id) ?? 0,
        open: open.length,
        critical: open.filter((r) => r.priority === 'CRITICAL').length,
        potentialValue: open.reduce((s, r) => s + r.potentialValue, 0),
        converted: converted.length,
        realisedValue: converted.reduce((s, r) => s + r.realisedValue, 0),
        conversionRate: mine.length > 0 ? converted.length / mine.length : 0,
        slaBreached: open.filter((r) => r.slaDueAt && r.slaDueAt.getTime() < now).length,
        avgAgeDays: open.length > 0 ? Math.round(ageSum / open.length) : 0,
      }
    })
    .sort((a, b) => b.potentialValue - a.potentialValue)
}

export interface TrendPoint {
  period: string
  detected: number
  converted: number
  potentialValue: number
  realisedValue: number
}

/** Weekly detection and conversion trend for the trailing N weeks. */
export async function getTrend(
  principal: Principal,
  filters: OpportunityFilters = {},
  weeks = 12
): Promise<TrendPoint[]> {
  const where = scopeWhere(principal, filters)
  const start = new Date(Date.now() - weeks * 7 * 86_400_000)
  const rows = await prisma.opportunity.findMany({
    where: { AND: [where, { OR: [{ detectedAt: { gte: start } }, { closedAt: { gte: start } }] }] },
    select: { detectedAt: true, closedAt: true, status: true, potentialValue: true, realisedValue: true },
  })

  const buckets = new Map<string, TrendPoint>()
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(Date.now() - w * 7 * 86_400_000)
    const key = weekKey(d)
    buckets.set(key, { period: key, detected: 0, converted: 0, potentialValue: 0, realisedValue: 0 })
  }

  for (const r of rows) {
    const dk = weekKey(r.detectedAt)
    const db = buckets.get(dk)
    if (db) {
      db.detected++
      db.potentialValue += r.potentialValue
    }
    if (r.status === 'CONVERTED' && r.closedAt) {
      const ck = weekKey(r.closedAt)
      const cb = buckets.get(ck)
      if (cb) {
        cb.converted++
        cb.realisedValue += r.realisedValue
      }
    }
  }
  return [...buckets.values()]
}

function weekKey(d: Date): string {
  // ISO-ish week label; the exact boundary matters less than consistency
  // between the detected and converted series.
  const monday = new Date(d)
  const day = (monday.getDay() + 6) % 7
  monday.setDate(monday.getDate() - day)
  return `${monday.getMonth() + 1}/${monday.getDate()}`
}

export interface AgingBucket {
  label: string
  count: number
  potentialValue: number
  breached: number
}

export async function getAging(
  principal: Principal,
  filters: OpportunityFilters = {}
): Promise<AgingBucket[]> {
  const where = scopeWhere(principal, { ...filters, lifecycle: 'open' })
  const rows = await prisma.opportunity.findMany({
    where,
    select: { detectedAt: true, potentialValue: true, slaDueAt: true },
  })
  const now = Date.now()
  const defs = [
    { label: '0–3 days', min: 0, max: 3 },
    { label: '4–7 days', min: 4, max: 7 },
    { label: '8–14 days', min: 8, max: 14 },
    { label: '15–30 days', min: 15, max: 30 },
    { label: '31–60 days', min: 31, max: 60 },
    { label: '60+ days', min: 61, max: Infinity },
  ]
  return defs.map((d) => {
    const mine = rows.filter((r) => {
      const age = Math.floor((now - r.detectedAt.getTime()) / 86_400_000)
      return age >= d.min && age <= d.max
    })
    return {
      label: d.label,
      count: mine.length,
      potentialValue: mine.reduce((s, r) => s + r.potentialValue, 0),
      breached: mine.filter((r) => r.slaDueAt && r.slaDueAt.getTime() < now).length,
    }
  })
}

export interface WorkQueueGroup {
  category: string
  label: string
  count: number
  critical: number
  potentialValue: number
  oldestDays: number
  breached: number
}

/** The "today's priority work" summary from the spec's operational work queue. */
export async function getWorkQueue(
  principal: Principal,
  filters: OpportunityFilters = {}
): Promise<WorkQueueGroup[]> {
  const where = scopeWhere(principal, { ...filters, lifecycle: 'open' })
  const rows = await prisma.opportunity.findMany({
    where,
    select: { category: true, priority: true, potentialValue: true, detectedAt: true, slaDueAt: true },
  })
  const now = Date.now()
  const map = new Map<string, WorkQueueGroup>()
  for (const r of rows) {
    let g = map.get(r.category)
    if (!g) {
      g = {
        category: r.category,
        label: CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category,
        count: 0, critical: 0, potentialValue: 0, oldestDays: 0, breached: 0,
      }
      map.set(r.category, g)
    }
    g.count++
    g.potentialValue += r.potentialValue
    if (r.priority === 'CRITICAL' || r.priority === 'HIGH') g.critical++
    const age = Math.floor((now - r.detectedAt.getTime()) / 86_400_000)
    if (age > g.oldestDays) g.oldestDays = age
    if (r.slaDueAt && r.slaDueAt.getTime() < now) g.breached++
  }
  return [...map.values()].sort((a, b) => b.critical - a.critical || b.count - a.count)
}
