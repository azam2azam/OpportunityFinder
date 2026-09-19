import type { PrismaClient } from '@prisma/client'
import { computeEngagement } from '../scoring'

/**
 * Loads the full snapshot a detection run operates on.
 *
 * Detectors run against memory, not the database. The cost is one bounded set
 * of reads at the start of a run instead of thousands of per-patient queries,
 * and the benefit is that every rule sees exactly the same consistent view —
 * two rules can never disagree because one of them read the table later.
 *
 * `asOf` is threaded through everything instead of calling `new Date()` inside
 * detectors: a run must be reproducible for audit, and tests need to pin the
 * clock.
 */

export interface PatientSnapshot {
  id: string
  mrn: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  gender: string
  hospitalId: string
  primaryPhysicianId: string | null
  insuranceStatus: string
  payerId: string | null
  payerResubmissionWindowDays: number
  contactable: boolean
  consentMarketing: boolean
  preferredChannel: string
  phone: string | null
  distanceKm: number
  registeredAt: Date
  lastEncounterAt: Date | null
  isDeceased: boolean
  vipFlag: boolean

  encounters: EncounterRow[]
  appointments: AppointmentRow[]
  labs: LabRow[]
  diagnoses: DiagnosisRow[]
  surgeries: SurgeryRow[]
  prescriptions: PrescriptionRow[]
  pharmacyTxns: PharmacyRow[]
  claims: ClaimRow[]
  referrals: ReferralRow[]

  /** Derived once, reused by every rule that scores this patient. */
  engagement: number
  priorEncounters: number
  lifetimeValue: number
  age: number
}

export interface EncounterRow {
  id: string
  hospitalId: string
  departmentId: string
  specialtyId: string
  physicianId: string
  type: string
  startedAt: Date
  status: string
  followUpRecommended: boolean
  followUpDays: number | null
  grossCharge: number
  noteSummary: string | null
}

export interface AppointmentRow {
  id: string
  hospitalId: string
  specialtyId: string
  physicianId: string
  scheduledFor: Date
  createdAt: Date
  status: string
  isFollowUp: boolean
  cancelReason: string | null
}

export interface LabRow {
  id: string
  loincCode: string
  testName: string
  panel: string
  value: number | null
  unit: string
  refLow: number | null
  refHigh: number | null
  flag: string
  resultedAt: Date
  orderedAt: Date
  isPending: boolean
  repeatIntervalDays: number | null
  encounterId: string | null
}

export interface DiagnosisRow {
  id: string
  icd10: string
  description: string
  isChronic: boolean
  diagnosedAt: Date
  encounterId: string
}

export interface SurgeryRow {
  id: string
  hospitalId: string
  physicianId: string
  cptCode: string
  description: string
  status: string
  recommendedAt: Date
  scheduledFor: Date | null
  performedAt: Date | null
  workupComplete: boolean
  estimatedValue: number
  urgency: string
  cancelReason: string | null
}

export interface PrescriptionRow {
  id: string
  physicianId: string
  medicationId: string
  medicationName: string
  isChronic: boolean
  requiresMonitoring: boolean
  monitoringLoinc: string | null
  isHighRisk: boolean
  unitPrice: number
  dosage: string
  daysSupply: number
  refillsAuthorized: number
  refillsUsed: number
  prescribedAt: Date
  courseEndsAt: Date | null
  status: string
}

export interface PharmacyRow {
  id: string
  medicationId: string
  medicationName: string
  prescriptionId: string | null
  dispensedAt: Date
  daysSupply: number
  amount: number
  isRefill: boolean
}

export interface ClaimRow {
  id: string
  claimNumber: string
  hospitalId: string
  payerId: string
  payerName: string
  resubmissionWindowDays: number
  serviceDate: Date
  submittedAt: Date | null
  status: string
  billedAmount: number
  approvedAmount: number
  paidAmount: number
  serviceCode: string
  serviceDescription: string
  departmentName: string
  resubmissionCount: number
  rejections: RejectionRow[]
}

export interface RejectionRow {
  id: string
  reasonCode: string
  reasonText: string
  rejectedAmount: number
  rejectedAt: Date
  isAppealable: boolean
  recommendedPathway: string | null
  historicalRecoveryRate: number
  responsibleDepartment: string
}

export interface ReferralRow {
  id: string
  hospitalId: string
  fromPhysicianId: string
  toSpecialtyId: string
  direction: string
  issuedAt: Date
  expiresAt: Date | null
  status: string
  reason: string
  estimatedValue: number
  externalProvider: string | null
}

export interface ServiceLineRow {
  hospitalId: string
  specialtyId: string
  periodMonth: string
  encounters: number
  revenue: number
  capacitySlots: number
  bookedSlots: number
  cancellations: number
  referralsOut: number
  referralsRetained: number
}

export interface DetectionContext {
  asOf: Date
  patients: PatientSnapshot[]
  patientById: Map<string, PatientSnapshot>
  hospitalNames: Map<string, string>
  specialtyNames: Map<string, string>
  specialtyLines: Map<string, string>
  departmentNames: Map<string, string>
  physicianNames: Map<string, string>
  physicianDepartment: Map<string, string>
  physicianSpecialty: Map<string, string>
  serviceLines: ServiceLineRow[]
  /**
   * Capacity headroom per hospital+specialty, 0..100. Feeds the
   * serviceAvailability scoring factor: it is pointless to prioritise work that
   * routes to a clinic with no slots.
   */
  availability: Map<string, number>
}

const key = (hospitalId: string, specialtyId: string) => `${hospitalId}:${specialtyId}`

export async function loadContext(
  prisma: PrismaClient,
  asOf: Date = new Date()
): Promise<DetectionContext> {
  const [
    patients,
    encounters,
    appointments,
    labs,
    diagnoses,
    surgeries,
    prescriptions,
    pharmacyTxns,
    claims,
    referrals,
    hospitals,
    specialties,
    departments,
    physicians,
    serviceLines,
  ] = await Promise.all([
    prisma.patient.findMany({ include: { payer: true } }),
    prisma.encounter.findMany({ orderBy: { startedAt: 'asc' } }),
    prisma.appointment.findMany({ orderBy: { scheduledFor: 'asc' } }),
    prisma.labResult.findMany({ orderBy: { resultedAt: 'asc' } }),
    prisma.diagnosis.findMany({ orderBy: { diagnosedAt: 'asc' } }),
    prisma.surgery.findMany({ orderBy: { recommendedAt: 'asc' } }),
    prisma.prescription.findMany({ include: { medication: true }, orderBy: { prescribedAt: 'asc' } }),
    prisma.pharmacyTransaction.findMany({
      include: { medication: true },
      orderBy: { dispensedAt: 'asc' },
    }),
    prisma.insuranceClaim.findMany({
      include: { rejections: true, payer: true },
      orderBy: { serviceDate: 'asc' },
    }),
    prisma.referral.findMany({ orderBy: { issuedAt: 'asc' } }),
    prisma.hospital.findMany(),
    prisma.specialty.findMany(),
    prisma.department.findMany(),
    prisma.physician.findMany(),
    prisma.serviceLineMetric.findMany(),
  ])

  // Bucket child rows by patient in one pass each, rather than filtering the
  // full array per patient (which would be quadratic at this row count).
  const bucket = <T extends { patientId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const arr = m.get(r.patientId)
      if (arr) arr.push(r)
      else m.set(r.patientId, [r])
    }
    return m
  }

  const encByPatient = bucket(encounters)
  const apptByPatient = bucket(appointments)
  const labByPatient = bucket(labs)
  const dxByPatient = bucket(diagnoses)
  const surgByPatient = bucket(surgeries)
  const rxByPatient = bucket(prescriptions)
  const phByPatient = bucket(pharmacyTxns)
  const claimByPatient = bucket(claims)
  const refByPatient = bucket(referrals)

  const snapshots: PatientSnapshot[] = patients.map((p) => {
    const enc = encByPatient.get(p.id) ?? []
    const appt = apptByPatient.get(p.id) ?? []
    const noShows = appt.filter((a) => a.status === 'NO_SHOW').length
    const twoYearsAgo = new Date(asOf.getTime() - 730 * 86_400_000)

    return {
      id: p.id,
      mrn: p.mrn,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      gender: p.gender,
      hospitalId: p.hospitalId,
      primaryPhysicianId: p.primaryPhysicianId,
      insuranceStatus: p.insuranceStatus,
      payerId: p.payerId,
      payerResubmissionWindowDays: p.payer?.resubmissionWindowDays ?? 60,
      contactable: p.contactable,
      consentMarketing: p.consentMarketing,
      preferredChannel: p.preferredChannel,
      phone: p.phone,
      distanceKm: p.distanceKm,
      registeredAt: p.registeredAt,
      lastEncounterAt: p.lastEncounterAt,
      isDeceased: p.isDeceased,
      vipFlag: p.vipFlag,

      encounters: enc,
      appointments: appt,
      labs: labByPatient.get(p.id) ?? [],
      diagnoses: dxByPatient.get(p.id) ?? [],
      surgeries: surgByPatient.get(p.id) ?? [],
      prescriptions: (rxByPatient.get(p.id) ?? []).map((r) => ({
        id: r.id,
        physicianId: r.physicianId,
        medicationId: r.medicationId,
        medicationName: r.medication.name,
        isChronic: r.medication.isChronic,
        requiresMonitoring: r.medication.requiresMonitoring,
        monitoringLoinc: r.medication.monitoringLoinc,
        isHighRisk: r.medication.isHighRisk,
        unitPrice: r.medication.unitPrice,
        dosage: r.dosage,
        daysSupply: r.daysSupply,
        refillsAuthorized: r.refillsAuthorized,
        refillsUsed: r.refillsUsed,
        prescribedAt: r.prescribedAt,
        courseEndsAt: r.courseEndsAt,
        status: r.status,
      })),
      pharmacyTxns: (phByPatient.get(p.id) ?? []).map((t) => ({
        id: t.id,
        medicationId: t.medicationId,
        medicationName: t.medication.name,
        prescriptionId: t.prescriptionId,
        dispensedAt: t.dispensedAt,
        daysSupply: t.daysSupply,
        amount: t.amount,
        isRefill: t.isRefill,
      })),
      claims: (claimByPatient.get(p.id) ?? []).map((c) => ({
        id: c.id,
        claimNumber: c.claimNumber,
        hospitalId: c.hospitalId,
        payerId: c.payerId,
        payerName: c.payer.name,
        resubmissionWindowDays: c.payer.resubmissionWindowDays,
        serviceDate: c.serviceDate,
        submittedAt: c.submittedAt,
        status: c.status,
        billedAmount: c.billedAmount,
        approvedAmount: c.approvedAmount,
        paidAmount: c.paidAmount,
        serviceCode: c.serviceCode,
        serviceDescription: c.serviceDescription,
        departmentName: c.departmentName,
        resubmissionCount: c.resubmissionCount,
        rejections: c.rejections,
      })),
      referrals: refByPatient.get(p.id) ?? [],

      engagement: computeEngagement({
        contactable: p.contactable,
        consentMarketing: p.consentMarketing,
        hasPhone: Boolean(p.phone),
        totalAppointments: appt.length,
        noShows,
      }),
      priorEncounters: enc.filter((e) => e.startedAt >= twoYearsAgo).length,
      lifetimeValue: enc.reduce((s, e) => s + e.grossCharge, 0),
      age: Math.floor((asOf.getTime() - p.dateOfBirth.getTime()) / (365.25 * 86_400_000)),
    }
  })

  const availability = new Map<string, number>()
  // Use the most recent month present per hospital+specialty; older months
  // describe capacity that has since been re-templated.
  const latestByKey = new Map<string, ServiceLineRow>()
  for (const m of serviceLines) {
    const k = key(m.hospitalId, m.specialtyId)
    const existing = latestByKey.get(k)
    if (!existing || m.periodMonth > existing.periodMonth) latestByKey.set(k, m)
  }
  for (const [k, m] of latestByKey) {
    const headroom =
      m.capacitySlots > 0 ? 1 - Math.min(1, m.bookedSlots / m.capacitySlots) : 0.35
    availability.set(k, Math.round(headroom * 100))
  }

  return {
    asOf,
    patients: snapshots,
    patientById: new Map(snapshots.map((s) => [s.id, s])),
    hospitalNames: new Map(hospitals.map((h) => [h.id, h.name])),
    specialtyNames: new Map(specialties.map((s) => [s.id, s.name])),
    specialtyLines: new Map(specialties.map((s) => [s.id, s.line])),
    departmentNames: new Map(departments.map((d) => [d.id, d.name])),
    physicianNames: new Map(physicians.map((p) => [p.id, p.name])),
    physicianDepartment: new Map(physicians.map((p) => [p.id, p.departmentId])),
    physicianSpecialty: new Map(physicians.map((p) => [p.id, p.specialtyId])),
    serviceLines,
    availability,
  }
}

/**
 * Capacity headroom for the clinic an opportunity would route to. Defaults to a
 * neutral 50 when the specialty is unknown, so a missing metric neither
 * inflates nor suppresses the opportunity.
 */
export function availabilityFor(
  ctx: DetectionContext,
  hospitalId: string,
  specialtyId?: string | null
): number {
  if (!specialtyId) return 50
  return ctx.availability.get(key(hospitalId, specialtyId)) ?? 50
}
