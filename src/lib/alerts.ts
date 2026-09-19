import 'server-only'
import { prisma } from './db'
import { scopeWhere } from './queries'
import { moneyCompact, count as fmtCount, percent } from './format'
import type { Principal } from './rbac'
import { TERMINAL_STATUSES } from './enums'

/**
 * Executive alerts (spec section 23).
 *
 * Alerts are evaluated live against the pipeline rather than read from a
 * precomputed table. At this data volume the queries are cheap, and a live
 * evaluation cannot go stale — an alert that says "rejections up 18%" when they
 * came back down yesterday is worse than no alert, because it spends the
 * executive's attention on a problem that has already resolved.
 *
 * Rules come from AlertRule, so thresholds and audiences are configurable; the
 * metric implementations live here because each one needs its own query shape.
 */

export interface EvaluatedAlert {
  id: string
  ruleName: string
  metric: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  message: string
  value: number
  threshold: number
  href?: string
}

const WINDOW_DAYS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30 }

export async function evaluateAlerts(
  principal: Principal,
  hospitalId?: string
): Promise<EvaluatedAlert[]> {
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } })
  const audienceRules = rules.filter((r) => {
    const audience = r.audience.split(',').map((a) => a.trim())
    // An empty audience means "everyone who can see the dashboard".
    return audience.length === 0 || audience.includes(principal.roleKey)
  })
  if (audienceRules.length === 0) return []

  const base = scopeWhere(principal, hospitalId ? { hospitalId } : {})
  const open = { AND: [base, { status: { notIn: TERMINAL_STATUSES } }] }
  const now = Date.now()

  const out: EvaluatedAlert[] = []

  for (const rule of audienceRules) {
    const days = WINDOW_DAYS[rule.window] ?? 7
    const since = new Date(now - days * 86_400_000)
    const priorSince = new Date(now - days * 2 * 86_400_000)

    let value: number | null = null
    let message = ''
    let href: string | undefined

    switch (rule.metric) {
      case 'OPEN_OPPORTUNITY_COUNT': {
        value = await prisma.opportunity.count({ where: open })
        message = `${fmtCount(value)} opportunities are open and unconverted.`
        href = '/opportunities?lifecycle=open&sort=score'
        break
      }

      case 'CRITICAL_UNASSIGNED_COUNT': {
        value = await prisma.opportunity.count({
          where: { AND: [open, { priority: 'CRITICAL' }, { ownerUserId: null }] },
        })
        message = `${fmtCount(value)} critical opportunities have no owner assigned.`
        href = '/opportunities?priority=CRITICAL&owner=unassigned&lifecycle=open'
        break
      }

      case 'SLA_BREACH_PCT': {
        const [breached, total] = await Promise.all([
          prisma.opportunity.count({ where: { AND: [open, { slaDueAt: { lt: new Date() } }] } }),
          prisma.opportunity.count({ where: open }),
        ])
        value = total > 0 ? (breached / total) * 100 : 0
        message = `${percent(value / 100, 0)} of open opportunities are past their SLA (${fmtCount(breached)} of ${fmtCount(total)}).`
        href = '/opportunities?sla=breached&lifecycle=open&sort=sla'
        break
      }

      case 'SURGERY_UNCONVERTED_COUNT': {
        value = await prisma.opportunity.count({
          where: { AND: [open, { category: 'SURGERY' }] },
        })
        message = `${fmtCount(value)} surgical consultations have not converted to a booked procedure.`
        href = '/clinical?category=SURGERY'
        break
      }

      case 'MEDICATION_ABANDONED_COUNT': {
        value = await prisma.opportunity.count({
          where: { AND: [open, { category: 'MEDICATION' }, { rule: { key: 'MED_REFILL_ABANDONED' } }] },
        })
        message = `${fmtCount(value)} patients have abandoned an established refill pattern.`
        href = '/clinical?category=MEDICATION'
        break
      }

      case 'INSURANCE_REJECTED_VALUE_WOW_PCT': {
        const [current, prior] = await Promise.all([
          prisma.opportunity.aggregate({
            where: { AND: [base, { category: 'INSURANCE' }, { detectedAt: { gte: since } }] },
            _sum: { potentialValue: true },
          }),
          prisma.opportunity.aggregate({
            where: { AND: [base, { category: 'INSURANCE' }, { detectedAt: { gte: priorSince, lt: since } }] },
            _sum: { potentialValue: true },
          }),
        ])
        const cur = current._sum.potentialValue ?? 0
        const pre = prior._sum.potentialValue ?? 0
        // With no prior-period baseline, a percentage change is undefined
        // rather than infinite — skip instead of raising a meaningless alert.
        if (pre === 0) continue
        value = ((cur - pre) / pre) * 100
        message = `Insurance recovery value rose ${percent(value / 100, 0)} this ${rule.window.toLowerCase()} to ${moneyCompact(cur)}.`
        href = '/insurance'
        break
      }

      case 'CLINICAL_OPEN_COUNT_WOW_PCT': {
        const clinical = ['LAB', 'SURGERY', 'MEDICATION']
        const [cur, pre] = await Promise.all([
          prisma.opportunity.count({
            where: { AND: [base, { category: { in: clinical } }, { detectedAt: { gte: since } }] },
          }),
          prisma.opportunity.count({
            where: { AND: [base, { category: { in: clinical } }, { detectedAt: { gte: priorSince, lt: since } }] },
          }),
        ])
        if (pre === 0) continue
        value = ((cur - pre) / pre) * 100
        message = `Clinical follow-up detections rose ${percent(value / 100, 0)} this ${rule.window.toLowerCase()} (${fmtCount(cur)} new).`
        href = '/clinical'
        break
      }

      default:
        continue
    }

    if (value == null) continue
    const breached =
      rule.comparator === 'GT'
        ? value > rule.threshold
        : rule.comparator === 'LT'
          ? value < rule.threshold
          : value === rule.threshold
    if (!breached) continue

    out.push({
      id: rule.id,
      ruleName: rule.name,
      metric: rule.metric,
      severity: (rule.severity as EvaluatedAlert['severity']) ?? 'INFO',
      message,
      value,
      threshold: rule.threshold,
      href,
    })
  }

  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}
