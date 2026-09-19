/**
 * Advances a share of the detected pipeline through the operational lifecycle.
 *
 * Detection alone leaves every opportunity in DETECTED, which makes the funnel,
 * conversion rate, SLA and aging views structurally empty — they would render,
 * but they would show nothing, and a reviewer could not tell a working chart
 * from a broken one. This backfills the operational history that a live
 * deployment accumulates over months: assignments, outreach attempts, booked
 * appointments, conversions with attributed revenue, and the ones that were
 * closed as not applicable.
 *
 * Deliberately imperfect: conversion rates differ by category, some work
 * breaches SLA, and a slice of outreach fails. A pipeline where everything
 * converts teaches the user nothing about where their problems are.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const DAY = 86_400_000

let _state = 987654321
function rnd() {
  _state |= 0
  _state = (_state + 0x6d2b79f5) | 0
  let t = Math.imul(_state ^ (_state >>> 15), 1 | _state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (a: number, b: number) => Math.floor(rnd() * (b - a + 1)) + a
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]
const chance = (p: number) => rnd() < p

/**
 * How far a category's work typically gets, and how often it converts.
 * Insurance recovery converts well because it does not depend on a patient
 * answering the phone; reactivation converts poorly for exactly that reason.
 */
const CATEGORY_PROFILE: Record<string, { worked: number; conversion: number }> = {
  INSURANCE: { worked: 0.72, conversion: 0.46 },
  LAB: { worked: 0.55, conversion: 0.34 },
  SURGERY: { worked: 0.66, conversion: 0.38 },
  MEDICATION: { worked: 0.5, conversion: 0.3 },
  APPOINTMENT: { worked: 0.58, conversion: 0.36 },
  REFERRAL: { worked: 0.52, conversion: 0.33 },
  REACTIVATION: { worked: 0.38, conversion: 0.18 },
  SERVICE_LINE: { worked: 0.6, conversion: 0.25 },
}

const CONVERSION_TYPE: Record<string, string> = {
  INSURANCE: 'CLAIM_RECOVERED',
  LAB: 'APPOINTMENT',
  SURGERY: 'SURGERY',
  MEDICATION: 'REFILL',
  APPOINTMENT: 'APPOINTMENT',
  REFERRAL: 'APPOINTMENT',
  REACTIVATION: 'REACTIVATION',
  SERVICE_LINE: 'TREATMENT',
}

const CLOSE_REASONS = [
  'Patient declined — receiving care elsewhere',
  'Clinically reviewed, no further action indicated',
  'Duplicate of an existing care plan',
  'Contact details invalid, no alternative on file',
  'Patient relocated outside the catchment',
]

async function main() {
  console.log('Simulating operational workflow over the detected pipeline...')

  // Re-running must not stack a second history on top of the first, so the
  // previous simulation is cleared and every opportunity returned to DETECTED.
  await prisma.conversion.deleteMany({})
  await prisma.opportunityAction.deleteMany({})
  await prisma.campaignMember.deleteMany({})
  await prisma.communication.deleteMany({})
  await prisma.campaign.deleteMany({})
  await prisma.opportunity.updateMany({
    data: {
      status: 'DETECTED', ownerUserId: null, ownerTeam: null, realisedValue: 0,
      lastActionAt: null, nextActionAt: null, closedAt: null, outcome: null, outcomeNote: null,
    },
  })

  const [opportunities, users, rules] = await Promise.all([
    prisma.opportunity.findMany({
      select: {
        id: true, category: true, hospitalId: true, patientId: true,
        detectedAt: true, potentialValue: true, priority: true,
        conversionProbability: true, recommendedChannel: true, slaDueAt: true,
      },
    }),
    prisma.user.findMany({ include: { role: true, hospitalScopes: true } }),
    prisma.opportunityRule.findMany({ select: { key: true, defaultOwnerRole: true } }),
  ])
  void rules

  // Owners are drawn from roles that actually work a queue — assigning a
  // clinical follow-up to the compliance auditor would be noise, not realism.
  const workers = users.filter((u) =>
    ['CARE_NAVIGATOR', 'RCM_SPECIALIST', 'DEPARTMENT_MANAGER', 'EXECUTIVE_DIRECTOR', 'GENERAL_DIRECTOR'].includes(
      u.role.key
    )
  )
  const workersByHospital = new Map<string, typeof workers>()
  for (const w of workers) {
    for (const s of w.hospitalScopes) {
      const arr = workersByHospital.get(s.hospitalId) ?? []
      arr.push(w)
      workersByHospital.set(s.hospitalId, arr)
    }
  }
  const anyWorker = workers.length ? workers : users

  const actions: any[] = []
  const conversions: any[] = []
  const communications: any[] = []
  const updates: { id: string; data: any }[] = []

  let seq = 0
  for (const opp of opportunities) {
    const profile = CATEGORY_PROFILE[opp.category] ?? { worked: 0.5, conversion: 0.3 }
    // Priority drives attention: critical work gets picked up far more often.
    const priorityBoost =
      opp.priority === 'CRITICAL' ? 0.28 : opp.priority === 'HIGH' ? 0.15 : opp.priority === 'LOW' ? -0.14 : 0
    if (!chance(profile.worked + priorityBoost)) continue

    const pool = workersByHospital.get(opp.hospitalId) ?? anyWorker
    if (pool.length === 0) continue
    const owner = pick(pool)

    // Work starts somewhere between detection and now.
    const ageDays = Math.max(1, Math.floor((Date.now() - opp.detectedAt.getTime()) / DAY))
    let cursor = new Date(opp.detectedAt.getTime() + int(0, Math.min(6, ageDays)) * DAY)
    const step = (maxDays: number) => {
      cursor = new Date(cursor.getTime() + int(1, maxDays) * DAY)
      return cursor > new Date() ? new Date() : cursor
    }

    const push = (type: string, note: string, from: string | null, to: string | null, at: Date) => {
      actions.push({
        id: `act${String(++seq).padStart(7, '0')}`,
        opportunityId: opp.id,
        type,
        performedById: owner.id,
        performedAt: at,
        note,
        fromStatus: from,
        toStatus: to,
      })
    }

    const reviewedAt = step(3)
    push('REVIEW', 'Opportunity reviewed and confirmed as actionable.', 'DETECTED', 'REVIEWED', reviewedAt)

    // Work stalls. Some opportunities are triaged and never picked up; some are
    // assigned and then sit in a queue. Both are ordinary, and both are what
    // the aging and SLA views exist to expose — a simulator that always runs
    // the full lifecycle would render those views permanently green.
    if (chance(0.09)) {
      updates.push({
        id: opp.id,
        data: { status: 'REVIEWED', lastActionAt: reviewedAt, nextActionAt: new Date(reviewedAt.getTime() + int(3, 14) * DAY) },
      })
      continue
    }

    const assignedAt = step(2)
    push('ASSIGN', `Assigned to ${owner.name}.`, 'REVIEWED', 'ASSIGNED', assignedAt)

    if (chance(0.14)) {
      updates.push({
        id: opp.id,
        data: {
          status: 'ASSIGNED',
          ownerUserId: owner.id,
          ownerTeam: owner.role.key,
          lastActionAt: assignedAt,
          nextActionAt: new Date(assignedAt.getTime() + int(2, 12) * DAY),
        },
      })
      continue
    }

    let status = 'ASSIGNED'
    let realisedValue = 0
    let closedAt: Date | null = null
    let outcome: string | null = null
    let outcomeNote: string | null = null

    // Outreach. Insurance work is a back-office action; everything else is an
    // attempt to reach a patient, which can simply fail.
    const isBackOffice = opp.category === 'INSURANCE' || opp.category === 'SERVICE_LINE'
    const contactAt = step(5)

    if (isBackOffice) {
      const actionType = opp.category === 'INSURANCE' ? 'RESUBMIT_CLAIM' : 'NOTE'
      push(actionType, 'Recovery action submitted and logged against the claim.', status, 'CONTACTED', contactAt)
      status = 'CONTACTED'
    } else {
      const channel = opp.recommendedChannel === 'PHONE' ? 'CALL' : opp.recommendedChannel
      const reached = chance(0.68)
      push(
        channel,
        reached ? 'Patient contacted and the recommendation discussed.' : 'Contact attempted — no answer.',
        status,
        'CONTACTED',
        contactAt
      )
      status = 'CONTACTED'
      if (opp.patientId) {
        communications.push({
          id: `com${String(seq).padStart(7, '0')}`,
          patientId: opp.patientId,
          opportunityId: opp.id,
          channel: opp.recommendedChannel,
          direction: 'OUTBOUND',
          sentAt: contactAt,
          subject: 'Follow-up from your care team',
          body:
            'Our care team would like to arrange your next appointment. ' +
            'Please contact us at your convenience to confirm a suitable time.',
          status: reached ? 'DELIVERED' : 'NO_ANSWER',
          sentById: owner.id,
        })
      }
      if (!reached && chance(0.45)) {
        // Unreachable and nobody chased it again — left open, which is exactly
        // the kind of stall the aging view is meant to surface.
        updates.push({
          id: opp.id,
          data: {
            status, ownerUserId: owner.id, ownerTeam: owner.role.key,
            lastActionAt: contactAt, nextActionAt: new Date(contactAt.getTime() + 7 * DAY),
          },
        })
        continue
      }
    }

    // Conversion, or an explicit disposition.
    const converts = chance(profile.conversion + priorityBoost * 0.5)
    if (converts) {
      const bookedAt = step(8)
      push('SCHEDULE_APPOINTMENT', 'Appointment scheduled with the patient.', status, 'APPOINTMENT_SCHEDULED', bookedAt)
      status = 'APPOINTMENT_SCHEDULED'

      if (chance(0.82)) {
        const returnedAt = step(14)
        push('STATUS_CHANGE', 'Patient attended.', status, 'PATIENT_RETURNED', returnedAt)
        status = 'PATIENT_RETURNED'

        if (chance(0.86)) {
          const completedAt = step(10)
          push('STATUS_CHANGE', 'Treatment completed.', status, 'TREATMENT_COMPLETED', completedAt)
          status = 'TREATMENT_COMPLETED'

          const convertedAt = step(4)
          // Realised value lands near the estimate but rarely on it.
          realisedValue = Math.round(opp.potentialValue * (0.72 + rnd() * 0.5))
          push('STATUS_CHANGE', `Converted — ${realisedValue.toLocaleString()} SAR realised.`, status, 'CONVERTED', convertedAt)
          status = 'CONVERTED'
          closedAt = convertedAt
          outcome = 'CONVERTED'
          conversions.push({
            id: `cnv${String(seq).padStart(7, '0')}`,
            opportunityId: opp.id,
            convertedAt,
            conversionType: CONVERSION_TYPE[opp.category] ?? 'TREATMENT',
            revenue: realisedValue,
            daysToConvert: Math.max(
              1,
              Math.floor((convertedAt.getTime() - opp.detectedAt.getTime()) / DAY)
            ),
            attributedUserId: owner.id,
          })
        }
      }
    } else if (chance(0.34)) {
      const closeAt = step(12)
      const reason = pick(CLOSE_REASONS)
      const notApplicable = reason.startsWith('Clinically reviewed') || reason.startsWith('Duplicate')
      const finalStatus = notApplicable ? 'NOT_APPLICABLE' : 'REJECTED'
      push('CLOSE', reason, status, finalStatus, closeAt)
      status = finalStatus
      closedAt = closeAt
      outcome = finalStatus
      outcomeNote = reason
    }

    const last = actions[actions.length - 1]
    updates.push({
      id: opp.id,
      data: {
        status,
        ownerUserId: owner.id,
        ownerTeam: owner.role.key,
        realisedValue,
        lastActionAt: last?.performedAt ?? null,
        nextActionAt: closedAt ? null : new Date((last?.performedAt ?? new Date()).getTime() + int(2, 10) * DAY),
        closedAt,
        outcome,
        outcomeNote,
      },
    })
  }

  console.log(`  ${updates.length} opportunities worked, ${conversions.length} converted`)

  await batch('opportunityAction', actions)
  await batch('communication', communications)
  await batch('conversion', conversions)

  // Status updates go one at a time — each row gets different values, so there
  // is no bulk form for this.
  for (let i = 0; i < updates.length; i += 200) {
    await prisma.$transaction(
      updates.slice(i, i + 200).map((u) => prisma.opportunity.update({ where: { id: u.id }, data: u.data }))
    )
  }

  await seedCampaigns()

  const summary = await prisma.opportunity.groupBy({ by: ['status'], _count: true })
  console.log('\nPipeline by status:')
  for (const s of summary.sort((a, b) => b._count - a._count)) {
    console.log(`  ${s.status.padEnd(24)} ${s._count}`)
  }
  const revenue = await prisma.conversion.aggregate({ _sum: { revenue: true }, _count: true })
  console.log(
    `\nRealised: ${revenue._count} conversions, SAR ${Math.round(revenue._sum.revenue ?? 0).toLocaleString()}`
  )
}

/** Two worked campaigns so the campaign module opens with real funnels. */
async function seedCampaigns() {
  const creator = await prisma.user.findFirst({ where: { email: 'gd.riyadh@opportuna.health' } })
  const hospital = await prisma.hospital.findFirst({ where: { code: 'RYD' } })
  if (!creator || !hospital) return

  const specs = [
    {
      name: 'Diabetes Follow-up — Riyadh Central',
      description:
        'Patients over 40 with an elevated HbA1c and no follow-up in six months, invited back for endocrinology review.',
      criteria: { minAge: 40, category: 'LAB', panel: 'Diabetes', noFollowUpMonths: 6 },
      channels: ['SMS', 'PHONE'],
      categories: ['LAB'],
      status: 'RUNNING',
      startedDaysAgo: 46,
      template:
        'Dear {{patient}}, your recent laboratory results are ready for review with your doctor. ' +
        'Please call {{hospital}} on 920000000 to arrange an appointment.',
    },
    {
      name: 'Chronic Care Reactivation — Q3',
      description:
        'Chronic-disease patients inactive for more than nine months, offered a health review appointment.',
      criteria: { category: 'REACTIVATION', inactiveMonths: 9, chronicOnly: true },
      channels: ['SMS', 'WHATSAPP'],
      categories: ['REACTIVATION'],
      status: 'COMPLETED',
      startedDaysAgo: 120,
      template:
        'Dear {{patient}}, it has been some time since your last visit. ' +
        'Your care team at {{hospital}} would like to arrange a review. Reply YES to be contacted.',
    },
  ]

  for (const spec of specs) {
    const startsAt = new Date(Date.now() - spec.startedDaysAgo * DAY)
    const campaign = await prisma.campaign.create({
      data: {
        name: spec.name,
        hospitalId: hospital.id,
        description: spec.description,
        criteria: JSON.stringify(spec.criteria),
        channels: JSON.stringify(spec.channels),
        status: spec.status,
        startsAt,
        endsAt: spec.status === 'COMPLETED' ? new Date(startsAt.getTime() + 60 * DAY) : null,
        createdById: creator.id,
        messageTemplate: spec.template,
        approvedById: creator.id,
        approvedAt: new Date(startsAt.getTime() - 2 * DAY),
      },
    })

    const members = await prisma.opportunity.findMany({
      where: { hospitalId: hospital.id, category: { in: spec.categories }, patientId: { not: null } },
      select: { id: true, patientId: true, potentialValue: true },
      take: 180,
    })

    // Funnel attrition: contacted -> responded -> booked -> visited -> converted.
    const rows = members.map((m, i) => {
      const r = rnd()
      let status = 'ELIGIBLE'
      let revenue = 0
      let respondedAt: Date | null = null
      if (r < 0.78) status = 'CONTACTED'
      if (r < 0.44) {
        status = 'RESPONDED'
        respondedAt = new Date(startsAt.getTime() + int(1, 21) * DAY)
      }
      if (r < 0.3) status = 'BOOKED'
      if (r < 0.21) status = 'VISITED'
      if (r < 0.14) {
        status = 'CONVERTED'
        revenue = Math.round(m.potentialValue * (0.7 + rnd() * 0.5))
      }
      if (r > 0.96) status = 'OPTED_OUT'
      return {
        campaignId: campaign.id,
        patientId: m.patientId as string,
        opportunityId: m.id,
        addedAt: new Date(startsAt.getTime() + Math.floor(i / 20) * DAY),
        status,
        respondedAt,
        revenue,
      }
    })

    // A patient can hold several opportunities in a category, but only joins a
    // campaign once — the unique constraint enforces it, so dedupe here.
    const seen = new Set<string>()
    const unique = rows.filter((r) => (seen.has(r.patientId) ? false : (seen.add(r.patientId), true)))
    await batch('campaignMember', unique)
    console.log(`  campaign "${spec.name}": ${unique.length} members`)
  }
}

async function batch(model: string, rows: any[], size = 300) {
  if (rows.length === 0) return
  const client = prisma as any
  for (let i = 0; i < rows.length; i += size) {
    await client[model].createMany({ data: rows.slice(i, i + size) })
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
