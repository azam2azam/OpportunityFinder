/**
 * Synthetic VIDA extract generator.
 *
 * This stands in for the CDC/ETL feed described in the architecture: it writes
 * the same tables the real integration would land, so every downstream layer
 * (semantic model, detection, scoring, Ask Data) runs against production-shaped
 * data without touching a live hospital system.
 *
 * Two properties are deliberate:
 *
 *   Reproducible — a seeded PRNG, not Math.random, so a given SEED always
 *   produces the same population. Detection counts are then stable enough to
 *   assert on in tests.
 *
 *   Rule-covering — patients are assigned clinical "scenarios" that plant the
 *   exact patterns the detectors look for. Purely random histories leave some
 *   rules with zero matches, which makes an empty screen ambiguous: no data, or
 *   a broken rule? Planted cohorts remove that ambiguity.
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'
import { ROLES } from '../src/lib/rbac'
import { RULE_CATALOGUE } from '../src/lib/detection/rules'
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from '../src/lib/scoring'
import {
  HOSPITALS, SPECIALTIES, DEPARTMENTS, SPECIALTY_DEPARTMENT, PAYERS,
  FIRST_NAMES_M, FIRST_NAMES_F, LAST_NAMES, PHYSICIAN_TITLES, DISTRICTS,
  LAB_TESTS, MEDICATIONS, DIAGNOSES, SURGERIES, CLAIM_SERVICES,
  REJECTION_PLAYBOOK, CHIEF_COMPLAINTS, CANCEL_REASONS, EXTERNAL_PROVIDERS,
  DEMO_USERS, DEMO_PASSWORD, ALERT_RULES,
} from './seed-data'

const prisma = new PrismaClient()

const DAY = 86_400_000
const NOW = new Date()
const PATIENT_COUNT = Number(process.env.SEED_PATIENTS ?? 3000)
const SEED = Number(process.env.SEED ?? 20260918)

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────
let _state = SEED >>> 0
function rnd(): number {
  _state |= 0
  _state = (_state + 0x6d2b79f5) | 0
  let t = Math.imul(_state ^ (_state >>> 15), 1 | _state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]
const chance = (p: number) => rnd() < p
const gauss = (mean: number, sd: number) => {
  // Box-Muller; clamped by callers where a negative value would be nonsense.
  const u = Math.max(1e-9, rnd())
  const v = rnd()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY)
const round2 = (n: number) => Math.round(n * 100) / 100

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = rnd() * total
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

// Sequential ids let the generator wire relations without database round trips.
const counters: Record<string, number> = {}
const id = (prefix: string) => {
  counters[prefix] = (counters[prefix] ?? 0) + 1
  return `${prefix}${String(counters[prefix]).padStart(7, '0')}`
}

/**
 * Clinical scenarios planted on patients so every detector has a cohort.
 * `weight` is relative frequency; `inactiveDays` shapes how far back the
 * patient's last encounter sits, which is what most rules key off.
 */
const SCENARIOS = [
  { key: 'ACTIVE', weight: 24, inactiveDays: () => int(3, 60) },
  { key: 'LAB_ABNORMAL_STALE', weight: 7, inactiveDays: () => int(45, 150) },
  { key: 'LAB_CRITICAL', weight: 2, inactiveDays: () => int(12, 70) },
  { key: 'LAB_PENDING', weight: 3, inactiveDays: () => int(20, 90) },
  { key: 'LAB_LAPSED', weight: 5, inactiveDays: () => int(150, 400) },
  { key: 'LAB_NORMAL_NO_RETURN', weight: 4, inactiveDays: () => int(30, 120) },
  { key: 'SURG_RECOMMENDED', weight: 4, inactiveDays: () => int(40, 160) },
  { key: 'SURG_WORKUP', weight: 3, inactiveDays: () => int(50, 170) },
  { key: 'SURG_CANCELLED', weight: 2, inactiveDays: () => int(30, 140) },
  { key: 'SURG_CONSULT_LOST', weight: 2, inactiveDays: () => int(100, 300) },
  { key: 'MED_OVERDUE', weight: 6, inactiveDays: () => int(20, 80) },
  { key: 'MED_ABANDONED', weight: 5, inactiveDays: () => int(95, 260) },
  { key: 'MED_NO_REVIEW', weight: 4, inactiveDays: () => int(190, 420) },
  { key: 'MED_MONITORING', weight: 3, inactiveDays: () => int(30, 200) },
  { key: 'MED_INCOMPLETE', weight: 3, inactiveDays: () => int(30, 120) },
  { key: 'REACT_CHRONIC', weight: 5, inactiveDays: () => int(280, 620) },
  { key: 'REACT_HIGHVALUE', weight: 3, inactiveDays: () => int(370, 700) },
  { key: 'REACT_SPECIALIST', weight: 4, inactiveDays: () => int(200, 500) },
  { key: 'REACT_POSTSURG', weight: 3, inactiveDays: () => int(130, 400) },
  { key: 'APPT_NOSHOW', weight: 5, inactiveDays: () => int(20, 120) },
  { key: 'APPT_CANCELS', weight: 4, inactiveDays: () => int(25, 150) },
  { key: 'APPT_FOLLOWUP', weight: 6, inactiveDays: () => int(40, 200) },
  { key: 'APPT_UNRECONCILED', weight: 2, inactiveDays: () => int(10, 60) },
  { key: 'REF_NOTBOOKED', weight: 4, inactiveDays: () => int(25, 130) },
  { key: 'REF_EXPIRED', weight: 3, inactiveDays: () => int(90, 300) },
  { key: 'REF_LEAKED', weight: 3, inactiveDays: () => int(40, 200) },
]

async function main() {
  const t0 = Date.now()
  console.log(`Seeding Opportuna — ${PATIENT_COUNT} patients, seed ${SEED}`)

  await clearAll()

  // ── roles & users ─────────────────────────────────────────────────────
  const roleIds = new Map<string, string>()
  for (const role of ROLES) {
    const rid = id('role')
    roleIds.set(role.key, rid)
    await prisma.role.create({
      data: {
        id: rid,
        key: role.key,
        name: role.name,
        scopeLevel: role.scopeLevel,
        description: role.description,
        permissions: JSON.stringify(role.permissions),
      },
    })
  }

  // ── organisation ──────────────────────────────────────────────────────
  const hospitalIds = new Map<string, string>()
  for (const h of HOSPITALS) {
    const hid = id('hosp')
    hospitalIds.set(h.code, hid)
    await prisma.hospital.create({ data: { id: hid, ...h } })
  }

  const specialtyIds = new Map<string, string>()
  for (const s of SPECIALTIES) {
    const sid = id('spec')
    specialtyIds.set(s.code, sid)
    await prisma.specialty.create({ data: { id: sid, ...s } })
  }

  // Department rows are per hospital, so the same code maps to a different id
  // in each hospital — keyed `${hospitalCode}:${deptCode}`.
  const departmentIds = new Map<string, string>()
  for (const h of HOSPITALS) {
    for (const d of DEPARTMENTS) {
      const did = id('dept')
      departmentIds.set(`${h.code}:${d.code}`, did)
      await prisma.department.create({
        data: {
          id: did,
          hospitalId: hospitalIds.get(h.code)!,
          code: d.code,
          name: d.name,
          costCentre: `${h.code}-${d.costCentre}`,
        },
      })
    }
  }

  // Claims carry the department as a name, not an id: the RCM extract is a
  // flat billing feed, and the recovery workflow routes by department label.
  const deptNameById = new Map<string, string>()
  for (const h of HOSPITALS) {
    for (const d of DEPARTMENTS) {
      deptNameById.set(departmentIds.get(`${h.code}:${d.code}`)!, d.name)
    }
  }

  const payerIds = new Map<string, string>()
  for (const p of PAYERS) {
    const pid = id('payer')
    payerIds.set(p.code, pid)
    await prisma.payer.create({ data: { id: pid, ...p } })
  }

  const medicationIds = new Map<string, string>()
  for (const m of MEDICATIONS) {
    const mid = id('med')
    medicationIds.set(m.code, mid)
    await prisma.medication.create({
      data: {
        id: mid,
        code: m.code,
        name: m.name,
        form: m.form,
        strength: m.strength,
        atcClass: m.atc,
        isChronic: m.chronic,
        requiresMonitoring: m.monitoring,
        monitoringLoinc: m.monitoringLoinc,
        isHighRisk: m.highRisk,
        unitPrice: m.price,
      },
    })
  }

  // ── physicians ────────────────────────────────────────────────────────
  interface Phys {
    id: string
    hospitalCode: string
    specialtyCode: string
    departmentId: string
    name: string
  }
  const physicians: Phys[] = []
  for (const h of HOSPITALS) {
    // Larger hospitals carry more physicians per specialty.
    const perSpecialty = h.beds > 300 ? 3 : h.beds > 200 ? 2 : 1
    for (const s of SPECIALTIES) {
      for (let i = 0; i < perSpecialty; i++) {
        const pid = id('phys')
        const gender = chance(0.62) ? 'M' : 'F'
        const name = `${pick(PHYSICIAN_TITLES)} ${pick(gender === 'M' ? FIRST_NAMES_M : FIRST_NAMES_F)} ${pick(LAST_NAMES)}`
        const departmentId = departmentIds.get(`${h.code}:${SPECIALTY_DEPARTMENT[s.code]}`)!
        physicians.push({ id: pid, hospitalCode: h.code, specialtyCode: s.code, departmentId, name })
        await prisma.physician.create({
          data: {
            id: pid,
            code: `${h.code}-${s.code}-${i + 1}`,
            name,
            hospitalId: hospitalIds.get(h.code)!,
            departmentId,
            specialtyId: specialtyIds.get(s.code)!,
            weeklySlots: int(24, 56),
          },
        })
      }
    }
  }
  const physiciansByHospSpec = new Map<string, Phys[]>()
  for (const p of physicians) {
    const k = `${p.hospitalCode}:${p.specialtyCode}`
    const arr = physiciansByHospSpec.get(k)
    if (arr) arr.push(p)
    else physiciansByHospSpec.set(k, [p])
  }

  // ── demo users ────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const userIds = new Map<string, string>()
  for (const u of DEMO_USERS) {
    const uid = id('user')
    userIds.set(u.email, uid)
    await prisma.user.create({
      data: {
        id: uid,
        email: u.email,
        name: u.name,
        title: u.title,
        passwordHash,
        roleId: roleIds.get(u.role)!,
        primaryHospitalId: u.hospital ? hospitalIds.get(u.hospital)! : null,
      },
    })
    if (u.hospital) {
      await prisma.userHospitalScope.create({
        data: { id: id('uhs'), userId: uid, hospitalId: hospitalIds.get(u.hospital)! },
      })
    }
  }
  // The Executive Director also covers Madinah — exercises multi-hospital scope.
  await prisma.userHospitalScope.create({
    data: {
      id: id('uhs'),
      userId: userIds.get('ed.riyadh@opportuna.health')!,
      hospitalId: hospitalIds.get('MED')!,
    },
  })

  // ── population ────────────────────────────────────────────────────────
  console.log('  generating patient population...')

  const patients: any[] = []
  const encounters: any[] = []
  const appointments: any[] = []
  const diagnoses: any[] = []
  const procedures: any[] = []
  const surgeries: any[] = []
  const labResults: any[] = []
  const prescriptions: any[] = []
  const pharmacyTxns: any[] = []
  const claims: any[] = []
  const rejections: any[] = []
  const referrals: any[] = []

  // Hospital share of the population, roughly proportional to bed count.
  const hospitalWeights = HOSPITALS.map((h) => ({ code: h.code, weight: h.beds }))

  for (let i = 0; i < PATIENT_COUNT; i++) {
    const hospitalCode = weightedPick(hospitalWeights).code
    const hospital = HOSPITALS.find((h) => h.code === hospitalCode)!
    const hospitalId = hospitalIds.get(hospitalCode)!
    const scenario = weightedPick(SCENARIOS)
    const inactiveDays = scenario.inactiveDays()

    const gender = chance(0.48) ? 'M' : 'F'
    const firstName = pick(gender === 'M' ? FIRST_NAMES_M : FIRST_NAMES_F)
    const lastName = pick(LAST_NAMES)
    const age = Math.max(1, Math.min(94, Math.round(gauss(46, 19))))
    const dateOfBirth = new Date(NOW.getTime() - age * 365.25 * DAY - int(0, 364) * DAY)
    const patientId = id('pat')

    // Patients further from the hospital attend less reliably — this feeds the
    // proximity scoring factor and makes geographic analysis meaningful.
    const distanceKm = Math.max(1, round2(Math.abs(gauss(14, 18))))
    const registeredAt = daysAgo(int(inactiveDays + 120, 2200))
    const lastEncounterAt = daysAgo(inactiveDays)

    const insuranceStatus = chance(0.83) ? 'INSURED' : chance(0.6) ? 'SELF_PAY' : 'EXPIRED'
    const payerCode = insuranceStatus === 'INSURED' ? pick(PAYERS).code : null
    const contactable = chance(0.93)

    patients.push({
      id: patientId,
      mrn: `${hospitalCode}-${String(100000 + i).slice(-6)}`,
      sourceSystem: 'VIDA',
      sourceId: `VIDA-PAT-${1000000 + i}`,
      firstName,
      lastName,
      dateOfBirth,
      gender,
      nationalIdMasked: `1${'*'.repeat(7)}${int(100, 999)}`,
      phone: contactable ? `+9665${int(10000000, 99999999)}` : null,
      email: chance(0.55) ? `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z]/g, '')}@example.sa` : null,
      city: hospital.city,
      district: pick(DISTRICTS[hospital.city] ?? ['Central']),
      latitude: round2(hospital.latitude + gauss(0, 0.12)),
      longitude: round2(hospital.longitude + gauss(0, 0.12)),
      distanceKm,
      preferredChannel: pick(['SMS', 'PHONE', 'WHATSAPP', 'EMAIL']),
      contactable,
      consentMarketing: contactable && chance(0.86),
      language: chance(0.8) ? 'ar' : 'en',
      hospitalId,
      payerId: payerCode ? payerIds.get(payerCode)! : null,
      insuranceStatus,
      policyNumber: payerCode ? `${payerCode}-${int(1000000, 9999999)}` : null,
      registeredAt,
      lastEncounterAt,
      isDeceased: false,
      vipFlag: chance(0.03),
      // carried for generation only, stripped before insert
      _scenario: scenario.key,
      _hospitalCode: hospitalCode,
      _age: age,
      _inactiveDays: inactiveDays,
    })
  }

  console.log('  generating clinical histories...')

  for (const p of patients) {
    const hospitalCode: string = p._hospitalCode
    const hospitalId: string = p.hospitalId
    const scenario: string = p._scenario
    const age: number = p._age
    const inactiveDays: number = p._inactiveDays

    // A primary chronic condition anchors the patient's care pattern; older
    // patients are far likelier to have one.
    const chronicChance = age > 60 ? 0.72 : age > 45 ? 0.5 : age > 30 ? 0.24 : 0.08
    const chronicDx = chance(chronicChance) ? pick(DIAGNOSES.filter((d) => d.chronic)) : null
    const anchorSpecialty = chronicDx?.specialty ?? pick(SPECIALTIES).code
    const physiciansHere =
      physiciansByHospSpec.get(`${hospitalCode}:${anchorSpecialty}`) ??
      physiciansByHospSpec.get(`${hospitalCode}:FMED`)!
    const primaryPhysician = pick(physiciansHere)
    p.primaryPhysicianId = primaryPhysician.id

    // Encounter count scales with chronicity and age.
    const spanDays = Math.max(90, Math.floor((NOW.getTime() - p.registeredAt.getTime()) / DAY) - inactiveDays)
    const baseVisits = chronicDx ? int(4, 14) : int(1, 6)
    const visitCount = Math.max(1, Math.min(26, baseVisits))

    const encounterDates: Date[] = []
    for (let v = 0; v < visitCount; v++) {
      const offset = Math.floor((spanDays / visitCount) * v + int(0, Math.floor(spanDays / visitCount)))
      encounterDates.push(new Date(p.registeredAt.getTime() + offset * DAY))
    }
    encounterDates.sort((a, b) => a.getTime() - b.getTime())
    // Guarantee the final encounter lands exactly on lastEncounterAt so the
    // inactivity window the scenario asked for is exact.
    encounterDates[encounterDates.length - 1] = p.lastEncounterAt

    const patientEncounters: any[] = []
    for (let v = 0; v < encounterDates.length; v++) {
      const startedAt = encounterDates[v]
      const isLast = v === encounterDates.length - 1
      const specialtyCode =
        chronicDx && chance(0.68) ? anchorSpecialty : pick(SPECIALTIES).code
      const pool =
        physiciansByHospSpec.get(`${hospitalCode}:${specialtyCode}`) ?? physiciansHere
      const phys = pick(pool)
      const type = chance(0.78) ? 'OUTPATIENT' : chance(0.6) ? 'EMERGENCY' : chance(0.5) ? 'DAYCASE' : 'INPATIENT'
      const grossCharge = round2(
        type === 'INPATIENT' ? gauss(8500, 3200) : type === 'EMERGENCY' ? gauss(1600, 700) : gauss(520, 240)
      )

      // A follow-up instruction on the last encounter is what
      // APPT_FOLLOWUP_INTERVAL_EXCEEDED keys off.
      const followUpRecommended =
        isLast && scenario === 'APPT_FOLLOWUP' ? true : chance(0.3)
      const followUpDays = followUpRecommended
        ? scenario === 'APPT_FOLLOWUP' && isLast
          ? int(30, 90)
          : pick([30, 60, 90, 120, 180])
        : null

      const encounterId = id('enc')
      const enc = {
        id: encounterId,
        sourceSystem: 'VIDA',
        sourceId: `VIDA-ENC-${encounterId}`,
        patientId: p.id,
        hospitalId,
        departmentId: departmentIds.get(`${hospitalCode}:${SPECIALTY_DEPARTMENT[specialtyCode]}`)!,
        specialtyId: specialtyIds.get(specialtyCode)!,
        physicianId: phys.id,
        type,
        startedAt,
        endedAt: new Date(startedAt.getTime() + int(20, 240) * 60000),
        status: 'COMPLETED',
        chiefComplaint: pick(CHIEF_COMPLAINTS),
        noteSummary: followUpRecommended
          ? `Reviewed. Plan: continue current management, review in ${followUpDays} days.`
          : 'Reviewed. Continue current management.',
        followUpRecommended,
        followUpDays,
        dischargeDisposition: type === 'INPATIENT' ? pick(['HOME', 'HOME', 'TRANSFER']) : null,
        grossCharge: Math.max(80, grossCharge),
      }
      encounters.push(enc)
      patientEncounters.push({ ...enc, _specialtyCode: specialtyCode, _physician: phys })

      // Diagnosis on the encounter
      if (chronicDx && chance(0.6)) {
        diagnoses.push({
          id: id('dx'),
          patientId: p.id,
          encounterId,
          icd10: chronicDx.icd10,
          description: chronicDx.description,
          rank: 'PRIMARY',
          isChronic: true,
          diagnosedAt: startedAt,
        })
      } else if (chance(0.45)) {
        const dx = pick(DIAGNOSES)
        diagnoses.push({
          id: id('dx'),
          patientId: p.id,
          encounterId,
          icd10: dx.icd10,
          description: dx.description,
          rank: chance(0.75) ? 'PRIMARY' : 'SECONDARY',
          isChronic: dx.chronic,
          diagnosedAt: startedAt,
        })
      }

      if (chance(0.22)) {
        const svc = pick(CLAIM_SERVICES)
        procedures.push({
          id: id('proc'),
          patientId: p.id,
          encounterId,
          cptCode: svc.code,
          description: svc.description,
          performedAt: startedAt,
          charge: svc.amount,
        })
      }

      // Routine labs on most encounters.
      if (chance(0.62)) {
        const panelTests = chronicDx
          ? LAB_TESTS.filter((t) => t.repeatInterval !== null)
          : LAB_TESTS
        const n = int(1, 4)
        for (let k = 0; k < n; k++) {
          const test = pick(panelTests)
          const resultedAt = new Date(startedAt.getTime() + int(0, 2) * DAY)
          labResults.push(makeLab(p.id, encounterId, test, resultedAt, 'auto'))
        }
      }

      // Appointments: most encounters have a matching completed booking.
      if (chance(0.7)) {
        appointments.push({
          id: id('appt'),
          sourceSystem: 'VIDA',
          sourceId: `VIDA-APT-${id('src')}`,
          patientId: p.id,
          hospitalId,
          specialtyId: specialtyIds.get(specialtyCode)!,
          physicianId: phys.id,
          scheduledFor: startedAt,
          createdAt: new Date(startedAt.getTime() - int(3, 45) * DAY),
          status: 'COMPLETED',
          isFollowUp: v > 0,
          channel: pick(['PORTAL', 'PHONE', 'WALK_IN', 'WHATSAPP']),
        })
      }

      // Claims on a share of encounters.
      if (p.payerId && chance(0.62)) {
        makeClaim(p, enc, hospitalCode, deptNameById.get(enc.departmentId) ?? 'Outpatient Department', claims, rejections)
      }
    }

    const lastEnc = patientEncounters[patientEncounters.length - 1]

    // ── prescriptions & pharmacy ────────────────────────────────────────
    if (chronicDx && chance(0.82)) {
      const medCount = int(1, 3)
      const chronicMeds = MEDICATIONS.filter((m) => m.chronic)
      const chosen = new Set<string>()
      for (let m = 0; m < medCount; m++) chosen.add(pick(chronicMeds).code)

      for (const code of chosen) {
        const med = MEDICATIONS.find((x) => x.code === code)!
        const daysSupply = pick([30, 30, 60, 90])
        const prescribedAt = new Date(
          p.registeredAt.getTime() + int(0, Math.max(1, spanDays / 2)) * DAY
        )
        const rxId = id('rx')
        const refillsAuthorized = int(3, 12)

        // How the refill history ends is what distinguishes an overdue refill
        // from an abandoned course from a normal patient.
        let lastDispenseDaysAgo: number
        if (scenario === 'MED_OVERDUE') lastDispenseDaysAgo = daysSupply + int(12, 60)
        else if (scenario === 'MED_ABANDONED') lastDispenseDaysAgo = int(100, 300)
        else if (scenario === 'MED_NO_REVIEW') lastDispenseDaysAgo = int(15, 70)
        else lastDispenseDaysAgo = int(2, daysSupply)

        const refillCount =
          scenario === 'MED_ABANDONED' ? int(4, 10) : int(1, Math.max(2, refillsAuthorized))
        const refillsUsed =
          scenario === 'MED_INCOMPLETE' ? Math.max(1, Math.floor(refillsAuthorized / 3)) : Math.min(refillsAuthorized, refillCount)

        prescriptions.push({
          id: rxId,
          patientId: p.id,
          encounterId: lastEnc.id,
          physicianId: lastEnc._physician.id,
          medicationId: medicationIds.get(code)!,
          dosage: `1 ${med.form.toLowerCase()} ${pick(['once daily', 'twice daily', 'three times daily'])}`,
          daysSupply,
          refillsAuthorized,
          refillsUsed,
          prescribedAt,
          courseEndsAt:
            scenario === 'MED_INCOMPLETE'
              ? daysAgo(int(20, 90))
              : chance(0.25)
                ? new Date(prescribedAt.getTime() + refillsAuthorized * daysSupply * DAY)
                : null,
          status: 'ACTIVE',
        })

        for (let r = refillCount - 1; r >= 0; r--) {
          const dispensedAt = daysAgo(lastDispenseDaysAgo + r * daysSupply)
          if (dispensedAt < p.registeredAt) continue
          pharmacyTxns.push({
            id: id('phtx'),
            patientId: p.id,
            prescriptionId: rxId,
            medicationId: medicationIds.get(code)!,
            dispensedAt,
            quantity: daysSupply,
            daysSupply,
            amount: round2(med.price * daysSupply),
            isRefill: r < refillCount - 1,
          })
        }
      }
    }

    // A monitored medication with no monitoring lab, for MED_MONITORING_DUE.
    if (scenario === 'MED_MONITORING') {
      const med = pick(MEDICATIONS.filter((m) => m.monitoring && m.monitoringLoinc))
      prescriptions.push({
        id: id('rx'),
        patientId: p.id,
        encounterId: lastEnc.id,
        physicianId: lastEnc._physician.id,
        medicationId: medicationIds.get(med.code)!,
        dosage: `1 ${med.form.toLowerCase()} once daily`,
        daysSupply: 30,
        refillsAuthorized: 11,
        refillsUsed: int(4, 10),
        prescribedAt: daysAgo(int(200, 420)),
        courseEndsAt: null,
        status: 'ACTIVE',
      })
    }

    // ── scenario-specific plants ────────────────────────────────────────
    applyScenario({
      scenario, p, lastEnc, hospitalCode, hospitalId, inactiveDays,
      specialtyIds, departmentIds, physiciansByHospSpec, physiciansHere,
      labResults, appointments, surgeries, referrals,
    })
  }

  // Strip generation-only fields before insert.
  for (const p of patients) {
    delete p._scenario
    delete p._hospitalCode
    delete p._age
    delete p._inactiveDays
  }

  console.log(
    `  writing ${patients.length} patients, ${encounters.length} encounters, ${labResults.length} labs, ` +
      `${claims.length} claims, ${pharmacyTxns.length} pharmacy transactions...`
  )

  await batchInsert('patient', patients)
  await batchInsert('encounter', encounters.map(stripPrivate))
  await batchInsert('diagnosis', diagnoses)
  await batchInsert('procedure', procedures)
  await batchInsert('appointment', appointments)
  await batchInsert('labResult', labResults)
  await batchInsert('surgery', surgeries)
  await batchInsert('prescription', prescriptions)
  await batchInsert('pharmacyTransaction', pharmacyTxns)
  await batchInsert('insuranceClaim', claims)
  await batchInsert('insuranceRejection', rejections)
  await batchInsert('referral', referrals)

  // ── service-line metrics (12 trailing months) ─────────────────────────
  console.log('  aggregating service-line metrics...')
  await seedServiceLines(hospitalIds, specialtyIds, encounters, referrals, appointments)

  // ── configuration ─────────────────────────────────────────────────────
  console.log('  writing rules, scoring model and alerts...')

  for (const def of RULE_CATALOGUE) {
    await prisma.opportunityRule.create({
      data: {
        id: id('rule'),
        key: def.key,
        name: def.name,
        category: def.category,
        description: def.description,
        params: JSON.stringify(def.defaultParams),
        clinicalUrgency: def.clinicalUrgency,
        slaDays: def.slaDays,
        defaultOwnerRole: def.defaultOwnerRole,
        recommendedAction: def.recommendedAction,
      },
    })
  }

  const modelId = id('smodel')
  await prisma.scoringModel.create({
    data: {
      id: modelId,
      name: 'Group Standard Model v1',
      isActive: true,
      notes:
        'Balanced model weighting clinical urgency highest, then financial value and conversion probability. ' +
        'Tuned for a mixed acute/ambulatory group; hospitals may clone and retune.',
      thresholds: JSON.stringify(DEFAULT_THRESHOLDS),
      updatedBy: 'system',
    },
  })
  for (const [factor, weight] of Object.entries(DEFAULT_WEIGHTS)) {
    await prisma.scoringWeight.create({
      data: { id: id('sw'), modelId, factor, weight },
    })
  }
  // A second, inactive model so the scoring editor has something to compare to.
  const altId = id('smodel')
  await prisma.scoringModel.create({
    data: {
      id: altId,
      name: 'Revenue-Weighted Model (draft)',
      isActive: false,
      notes: 'Draft model that prioritises financial recovery over clinical urgency. Not in use.',
      thresholds: JSON.stringify({ CRITICAL: 82, HIGH: 64, MEDIUM: 44 }),
    },
  })
  const altWeights = { ...DEFAULT_WEIGHTS, clinicalUrgency: 18, financialValue: 34, conversionProbability: 20 }
  for (const [factor, weight] of Object.entries(altWeights)) {
    await prisma.scoringWeight.create({ data: { id: id('sw'), modelId: altId, factor, weight } })
  }

  for (const a of ALERT_RULES) {
    await prisma.alertRule.create({ data: { id: id('arule'), ...a } })
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\nSeed complete in ${elapsed}s`)
  console.log(`  ${patients.length} patients across ${HOSPITALS.length} hospitals`)
  console.log(`  ${encounters.length} encounters, ${labResults.length} lab results`)
  console.log(`  ${claims.length} claims (${rejections.length} rejections)`)
  console.log(`  ${surgeries.length} surgical records, ${referrals.length} referrals`)
  console.log(`  ${RULE_CATALOGUE.length} opportunity rules, ${DEMO_USERS.length} demo users`)
  console.log(`\n  Sign in with any demo account, password: ${DEMO_PASSWORD}`)
  console.log('  Run `npm run detect` to populate the opportunity pipeline.')
}

// ── generators ──────────────────────────────────────────────────────────

function stripPrivate(row: any) {
  const copy = { ...row }
  for (const k of Object.keys(copy)) if (k.startsWith('_')) delete copy[k]
  return copy
}

/**
 * Builds one lab result. `mode` picks the distribution: 'auto' is the routine
 * mix, 'abnormal' forces an out-of-range value, 'critical' forces a panic
 * value, 'pending' leaves it unresulted.
 */
function makeLab(
  patientId: string,
  encounterId: string | null,
  test: (typeof LAB_TESTS)[number],
  resultedAt: Date,
  mode: 'auto' | 'abnormal' | 'critical' | 'pending'
) {
  const low = test.refLow ?? 0
  const high = test.refHigh ?? 100
  const span = high - low || 1

  let value: number
  let flag: string

  if (mode === 'pending') {
    return {
      id: id('lab'),
      sourceSystem: 'VIDA_LIS',
      patientId,
      encounterId,
      loincCode: test.loinc,
      testName: test.name,
      panel: test.panel,
      value: null,
      textValue: null,
      unit: test.unit,
      refLow: test.refLow,
      refHigh: test.refHigh,
      flag: 'PENDING',
      resultedAt,
      orderedAt: resultedAt,
      isPending: true,
      repeatIntervalDays: test.repeatInterval,
    }
  }

  if (mode === 'critical') {
    const criticalHigh = (test as any).criticalHigh as number | null
    const criticalLow = (test as any).criticalLow as number | null
    if (criticalHigh != null) {
      value = round2(criticalHigh * (1 + rnd() * 0.35))
      flag = 'CRITICAL_HIGH'
    } else if (criticalLow != null) {
      value = round2(criticalLow * (0.5 + rnd() * 0.4))
      flag = 'CRITICAL_LOW'
    } else {
      value = round2(high * (1.9 + rnd() * 0.8))
      flag = 'CRITICAL_HIGH'
    }
  } else if (mode === 'abnormal' || chance(0.26)) {
    if (chance(0.68)) {
      value = round2(high + span * (0.12 + rnd() * 0.85))
      flag = 'HIGH'
    } else {
      value = round2(Math.max(0, low - span * (0.12 + rnd() * 0.5)))
      flag = 'LOW'
    }
  } else {
    value = round2(low + span * (0.15 + rnd() * 0.7))
    flag = 'NORMAL'
  }

  return {
    id: id('lab'),
    sourceSystem: 'VIDA_LIS',
    patientId,
    encounterId,
    loincCode: test.loinc,
    testName: test.name,
    panel: test.panel,
    value,
    textValue: null,
    unit: test.unit,
    refLow: test.refLow,
    refHigh: test.refHigh,
    flag,
    resultedAt,
    orderedAt: new Date(resultedAt.getTime() - int(0, 2) * DAY),
    isPending: false,
    repeatIntervalDays: test.repeatInterval,
  }
}

function makeClaim(
  p: any,
  enc: any,
  hospitalCode: string,
  departmentName: string,
  claims: any[],
  rejections: any[]
) {
  const svc = pick(CLAIM_SERVICES)
  const billed = round2(svc.amount * (0.85 + rnd() * 0.4))
  const claimId = id('clm')
  const submittedAt = new Date(enc.startedAt.getTime() + int(1, 12) * DAY)

  // Status mix reflects a mid-performing revenue cycle: roughly a fifth of
  // claims rejected, which is what makes the recovery module worth having.
  const roll = rnd()
  let status: string
  if (roll < 0.53) status = 'PAID'
  else if (roll < 0.62) status = 'PARTIALLY_PAID'
  else if (roll < 0.81) status = 'REJECTED'
  else if (roll < 0.87) status = 'RESUBMITTED'
  else if (roll < 0.95) status = chance(0.5) ? 'PENDING' : 'SUBMITTED'
  else status = 'WRITTEN_OFF'

  const approved = status === 'REJECTED' ? 0 : round2(billed * (0.82 + rnd() * 0.18))
  const paid =
    status === 'PAID'
      ? approved
      : status === 'PARTIALLY_PAID'
        ? round2(approved * (0.55 + rnd() * 0.33))
        : 0

  claims.push({
    id: claimId,
    sourceSystem: 'VIDA_RCM',
    claimNumber: `${hospitalCode}-CLM-${claimId.slice(-7)}`,
    patientId: p.id,
    hospitalId: p.hospitalId,
    encounterId: enc.id,
    payerId: p.payerId,
    serviceDate: enc.startedAt,
    submittedAt: ['PENDING', 'SUBMITTED'].includes(status) ? submittedAt : submittedAt,
    status,
    billedAmount: billed,
    approvedAmount: approved,
    paidAmount: paid,
    serviceCode: svc.code,
    serviceDescription: svc.description,
    departmentName,
    resubmissionCount: status === 'RESUBMITTED' ? int(1, 2) : 0,
  })

  if (status === 'REJECTED') {
    const reason = weightedPick(REJECTION_PLAYBOOK)
    // Rejections are dated after submission but biased recent, so a meaningful
    // share still sits inside the payer's resubmission window and is workable.
    const rejectedAt = new Date(
      Math.min(NOW.getTime() - int(1, 5) * DAY, submittedAt.getTime() + int(5, 40) * DAY)
    )
    rejections.push({
      id: id('rej'),
      claimId,
      reasonCode: reason.code,
      reasonText: reason.text,
      rejectedAmount: billed,
      rejectedAt,
      isAppealable: reason.appealable,
      recommendedPathway: reason.pathway,
      historicalRecoveryRate: round2(reason.recoveryRate * (0.85 + rnd() * 0.3)),
      responsibleDepartment: reason.department,
    })
  }
}

interface ScenarioArgs {
  scenario: string
  p: any
  lastEnc: any
  hospitalCode: string
  hospitalId: string
  inactiveDays: number
  specialtyIds: Map<string, string>
  departmentIds: Map<string, string>
  physiciansByHospSpec: Map<string, any[]>
  physiciansHere: any[]
  labResults: any[]
  appointments: any[]
  surgeries: any[]
  referrals: any[]
}

/**
 * Plants the artefact that makes a scenario's rule fire.
 *
 * Everything is positioned relative to the patient's last encounter, so the
 * "no encounter since" condition every clinical rule tests holds by
 * construction rather than by luck.
 */
function applyScenario(a: ScenarioArgs) {
  const { scenario, p, lastEnc, hospitalCode, hospitalId, inactiveDays } = a
  const lastAt: Date = lastEnc.startedAt
  const afterLast = (d: number) => new Date(lastAt.getTime() + d * DAY)

  switch (scenario) {
    case 'LAB_ABNORMAL_STALE': {
      const test = pick(LAB_TESTS)
      a.labResults.push(makeLab(p.id, lastEnc.id, test, afterLast(1), 'abnormal'))
      break
    }
    case 'LAB_CRITICAL': {
      const test = pick(LAB_TESTS.filter((t) => (t as any).criticalHigh || (t as any).criticalLow))
      a.labResults.push(makeLab(p.id, lastEnc.id, test, afterLast(1), 'critical'))
      break
    }
    case 'LAB_PENDING': {
      const test = pick(LAB_TESTS)
      a.labResults.push(makeLab(p.id, lastEnc.id, test, afterLast(0), 'pending'))
      break
    }
    case 'LAB_LAPSED': {
      // A monitoring test whose last result is far older than its interval.
      const test = pick(LAB_TESTS.filter((t) => t.repeatInterval !== null))
      a.labResults.push(makeLab(p.id, lastEnc.id, test, lastAt, chance(0.5) ? 'abnormal' : 'auto'))
      break
    }
    case 'LAB_NORMAL_NO_RETURN': {
      const tests = [pick(LAB_TESTS), pick(LAB_TESTS)]
      for (const t of tests) {
        const lab = makeLab(p.id, lastEnc.id, t, afterLast(1), 'auto')
        lab.flag = 'NORMAL'
        lab.value = round2(((t.refLow ?? 0) + (t.refHigh ?? 10)) / 2)
        a.labResults.push(lab)
      }
      break
    }
    case 'SURG_RECOMMENDED':
    case 'SURG_WORKUP':
    case 'SURG_CANCELLED':
    case 'SURG_CONSULT_LOST': {
      const proc = pick(SURGERIES)
      const pool =
        a.physiciansByHospSpec.get(`${hospitalCode}:${proc.specialty}`) ?? a.physiciansHere
      const surgeon = pick(pool)
      const status =
        scenario === 'SURG_RECOMMENDED'
          ? 'RECOMMENDED'
          : scenario === 'SURG_WORKUP'
            ? 'WORKUP_DONE'
            : scenario === 'SURG_CANCELLED'
              ? 'CANCELLED'
              : 'CONSULT_DONE'
      a.surgeries.push({
        id: id('surg'),
        patientId: p.id,
        hospitalId,
        physicianId: surgeon.id,
        cptCode: proc.cpt,
        description: proc.description,
        status,
        recommendedAt: lastAt,
        scheduledFor: scenario === 'SURG_CANCELLED' ? afterLast(14) : null,
        performedAt: null,
        cancelReason: scenario === 'SURG_CANCELLED' ? pick(CANCEL_REASONS) : null,
        workupComplete: scenario === 'SURG_WORKUP',
        estimatedValue: round2(proc.value * (0.85 + rnd() * 0.3)),
        urgency: chance(proc.urgencyMix) ? 'URGENT' : 'ELECTIVE',
      })
      break
    }
    case 'REACT_POSTSURG': {
      const proc = pick(SURGERIES)
      const pool =
        a.physiciansByHospSpec.get(`${hospitalCode}:${proc.specialty}`) ?? a.physiciansHere
      a.surgeries.push({
        id: id('surg'),
        patientId: p.id,
        hospitalId,
        physicianId: pick(pool).id,
        cptCode: proc.cpt,
        description: proc.description,
        status: 'PERFORMED',
        recommendedAt: new Date(lastAt.getTime() - int(20, 60) * DAY),
        scheduledFor: lastAt,
        performedAt: lastAt,
        cancelReason: null,
        workupComplete: true,
        estimatedValue: round2(proc.value * (0.85 + rnd() * 0.3)),
        urgency: 'ELECTIVE',
      })
      break
    }
    case 'APPT_NOSHOW': {
      a.appointments.push(
        makeAppointment(p, hospitalId, lastEnc, afterLast(int(3, 20)), 'NO_SHOW')
      )
      break
    }
    case 'APPT_CANCELS': {
      const n = int(2, 4)
      for (let i = 0; i < n; i++) {
        const appt = makeAppointment(
          p, hospitalId, lastEnc, afterLast(int(2, 40) + i * 25), 'CANCELLED_PATIENT'
        )
        appt.cancelReason = pick(CANCEL_REASONS)
        a.appointments.push(appt)
      }
      break
    }
    case 'APPT_UNRECONCILED': {
      // Booked, date passed, never reconciled — sits in the past deliberately.
      a.appointments.push(
        makeAppointment(p, hospitalId, lastEnc, daysAgo(int(9, 45)), 'BOOKED')
      )
      break
    }
    case 'REF_NOTBOOKED':
    case 'REF_EXPIRED':
    case 'REF_LEAKED': {
      const toSpecialty = pick(SPECIALTIES)
      const issuedAt = afterLast(int(0, 5))
      const status =
        scenario === 'REF_NOTBOOKED' ? 'ISSUED' : scenario === 'REF_EXPIRED' ? 'EXPIRED' : 'LEAKED'
      a.referrals.push({
        id: id('ref'),
        patientId: p.id,
        hospitalId,
        fromPhysicianId: lastEnc._physician.id,
        toSpecialtyId: a.specialtyIds.get(toSpecialty.code)!,
        direction: scenario === 'REF_LEAKED' ? 'EXTERNAL_OUT' : 'INTERNAL',
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 90 * DAY),
        status,
        encounterId: lastEnc.id,
        reason: pick(CHIEF_COMPLAINTS),
        estimatedValue: round2(gauss(1400, 900) + 400),
        externalProvider: scenario === 'REF_LEAKED' ? pick(EXTERNAL_PROVIDERS) : null,
      })
      break
    }
    default:
      break
  }

  // Background noise: referrals, appointments and surgeries that resolved
  // normally, so the pipeline is not made entirely of problems.
  if (chance(0.18)) {
    const toSpecialty = pick(SPECIALTIES)
    const issuedAt = daysAgo(int(inactiveDays + 10, inactiveDays + 400))
    a.referrals.push({
      id: id('ref'),
      patientId: p.id,
      hospitalId,
      fromPhysicianId: lastEnc._physician.id,
      toSpecialtyId: a.specialtyIds.get(toSpecialty.code)!,
      direction: 'INTERNAL',
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 90 * DAY),
      status: 'COMPLETED',
      encounterId: lastEnc.id,
      reason: pick(CHIEF_COMPLAINTS),
      estimatedValue: round2(gauss(1200, 700) + 300),
      externalProvider: null,
    })
  }
  if (chance(0.08)) {
    const proc = pick(SURGERIES)
    const pool = a.physiciansByHospSpec.get(`${hospitalCode}:${proc.specialty}`) ?? a.physiciansHere
    const performedAt = daysAgo(int(inactiveDays + 30, inactiveDays + 500))
    a.surgeries.push({
      id: id('surg'),
      patientId: p.id,
      hospitalId,
      physicianId: pick(pool).id,
      cptCode: proc.cpt,
      description: proc.description,
      status: 'PERFORMED',
      recommendedAt: new Date(performedAt.getTime() - 30 * DAY),
      scheduledFor: performedAt,
      performedAt,
      cancelReason: null,
      workupComplete: true,
      estimatedValue: round2(proc.value * (0.85 + rnd() * 0.3)),
      urgency: 'ELECTIVE',
    })
  }
}

function makeAppointment(
  p: any,
  hospitalId: string,
  lastEnc: any,
  scheduledFor: Date,
  status: string
) {
  return {
    id: id('appt'),
    sourceSystem: 'VIDA',
    sourceId: `VIDA-APT-${id('src')}`,
    patientId: p.id,
    hospitalId,
    specialtyId: lastEnc.specialtyId,
    physicianId: lastEnc.physicianId,
    scheduledFor,
    createdAt: new Date(scheduledFor.getTime() - int(5, 40) * DAY),
    status,
    cancelReason: null as string | null,
    isFollowUp: true,
    channel: pick(['PORTAL', 'PHONE', 'WHATSAPP']),
  }
}

/**
 * Derives 12 months of service-line metrics from the generated activity, then
 * deliberately depresses a few lines so the aggregate rules have something to
 * find. Capacity is modelled rather than generated: it is contracted slots, not
 * an observed fact, so it has no natural source in the transaction data.
 */
async function seedServiceLines(
  hospitalIds: Map<string, string>,
  specialtyIds: Map<string, string>,
  encounters: any[],
  referrals: any[],
  appointments: any[]
) {
  const months: string[] = []
  for (let m = 11; m >= 0; m--) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() - m, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

  interface Agg {
    encounters: number
    revenue: number
    cancellations: number
    referralsOut: number
    referralsRetained: number
  }
  const agg = new Map<string, Agg>()
  const keyOf = (h: string, s: string, m: string) => `${h}|${s}|${m}`
  const ensure = (k: string) => {
    let v = agg.get(k)
    if (!v) {
      v = { encounters: 0, revenue: 0, cancellations: 0, referralsOut: 0, referralsRetained: 0 }
      agg.set(k, v)
    }
    return v
  }

  for (const e of encounters) {
    const m = monthOf(e.startedAt)
    if (!months.includes(m)) continue
    const v = ensure(keyOf(e.hospitalId, e.specialtyId, m))
    v.encounters++
    v.revenue += e.grossCharge
  }
  for (const a of appointments) {
    const m = monthOf(a.scheduledFor)
    if (!months.includes(m)) continue
    if (!a.status.startsWith('CANCELLED') && a.status !== 'NO_SHOW') continue
    const v = ensure(keyOf(a.hospitalId, a.specialtyId, m))
    v.cancellations++
  }
  for (const r of referrals) {
    const m = monthOf(r.issuedAt)
    if (!months.includes(m)) continue
    const v = ensure(keyOf(r.hospitalId, r.toSpecialtyId, m))
    if (r.direction === 'EXTERNAL_OUT' || r.status === 'LEAKED') v.referralsOut++
    else v.referralsRetained++
  }

  // Lines chosen to be under-utilised / leaky, so the service-line rules have
  // deterministic targets rather than depending on where random noise landed.
  const depressedUtilisation = new Set(['DERM', 'OPHT', 'PULM'])
  const leakyLines = new Set(['GAST', 'NEUR', 'ONCO'])
  const cancellationHeavy = new Set(['ORTH', 'OBGY'])

  const rows: any[] = []
  for (const hId of hospitalIds.values()) {
    for (const s of SPECIALTIES) {
      const sId = specialtyIds.get(s.code)!
      for (const m of months) {
        const v = agg.get(keyOf(hId, sId, m)) ?? {
          encounters: 0, revenue: 0, cancellations: 0, referralsOut: 0, referralsRetained: 0,
        }
        // Contracted capacity, scaled so a healthy line lands near 75-85%.
        const baseCapacity = Math.max(40, Math.round(v.encounters / 0.78) + int(10, 60))
        const capacitySlots = depressedUtilisation.has(s.code)
          ? Math.round(baseCapacity * 1.9)
          : baseCapacity
        const bookedSlots = Math.min(capacitySlots, v.encounters + int(0, 12))

        let referralsOut = v.referralsOut
        let referralsRetained = v.referralsRetained
        if (leakyLines.has(s.code)) {
          referralsOut += int(6, 16)
          referralsRetained += int(0, 4)
        } else {
          referralsRetained += int(2, 9)
          referralsOut += int(0, 3)
        }

        // The rule measures cancellations / (encounters + cancellations). A
        // purely multiplicative boost keeps the rate believable at every
        // volume — an additive term swamps low-volume months and produces
        // nonsense like a 90% cancellation rate on three encounters.
        const cancellations = cancellationHeavy.has(s.code)
          ? v.cancellations + Math.round(v.encounters * 0.35)
          : v.cancellations

        rows.push({
          id: id('slm'),
          hospitalId: hId,
          specialtyId: sId,
          periodMonth: m,
          encounters: v.encounters,
          newPatients: Math.round(v.encounters * (0.18 + rnd() * 0.15)),
          revenue: round2(v.revenue),
          capacitySlots,
          bookedSlots,
          cancellations,
          referralsOut,
          referralsRetained,
        })
      }
    }
  }
  await batchInsert('serviceLineMetric', rows)
}

// ── persistence helpers ─────────────────────────────────────────────────

/**
 * SQLite caps variables per statement, so large tables are written in chunks.
 * 400 rows keeps every table (the widest has ~30 columns) under the limit.
 */
async function batchInsert(model: string, rows: any[], size = 400) {
  if (rows.length === 0) return
  const client = prisma as any
  for (let i = 0; i < rows.length; i += size) {
    await client[model].createMany({ data: rows.slice(i, i + size) })
  }
}

async function clearAll() {
  // Children before parents — SQLite enforces the foreign keys Prisma declares.
  // Grouped by dependency tier rather than by subject area: the identity tables
  // must go before `hospital`, because UserHospitalScope points at it.
  const order = [
    // Opportunity workflow — depends on users, rules, scoring and every
    // clinical table, so it is torn down first.
    'conversion', 'opportunityAction', 'campaignMember', 'communication',
    'opportunity', 'campaign',
    // Identity and governance.
    'alert', 'alertRule', 'detectionRun', 'nlQuery', 'auditEvent', 'session',
    'userHospitalScope', 'user', 'role',
    // Clinical and financial transactions.
    'insuranceRejection', 'insuranceClaim', 'referral', 'pharmacyTransaction',
    'prescription', 'labResult', 'procedure', 'diagnosis', 'surgery',
    'appointment', 'encounter', 'serviceLineMetric', 'patient',
    // Reference data.
    'physician', 'department', 'specialty', 'hospital', 'medication', 'payer',
    'scoringWeight', 'scoringModel', 'opportunityRule',
  ]
  const client = prisma as any
  for (const model of order) {
    await client[model].deleteMany({})
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
