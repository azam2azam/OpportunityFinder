/**
 * Ingestion domain contracts.
 *
 * One entry per feed the platform accepts. Each declares the platform fields a
 * row can carry, which of them are required, how each is typed, and how
 * references to other entities are resolved from business keys rather than
 * internal ids — a source system sends `hospital_code = RYD`, never a cuid.
 *
 * This is the single definition the whole ingestion path reads: the validator
 * checks against it, the loader writes through it, the field-mapping screen
 * renders it, and the CSV template endpoint generates headers from it. Adding a
 * domain means adding an entry here and nothing else.
 */

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime' | 'enum'

export interface TargetField {
  name: string
  type: FieldType
  required: boolean
  /** Valid values for `enum` fields. */
  values?: readonly string[]
  /** Resolve this business key to a foreign key on the named entity. */
  reference?: {
    entity: 'Hospital' | 'Specialty' | 'Department' | 'Physician' | 'Patient' | 'Payer' | 'Medication' | 'Encounter'
    /** The column on the referenced entity that the source value matches. */
    lookupBy: string
    /** The platform column the resolved id is written to. */
    foreignKey: string
  }
  description: string
  example: string
  /** Numeric bounds, checked as a validity rule rather than silently clamped. */
  min?: number
  max?: number
}

export interface DomainSpec {
  key: string
  label: string
  /** Prisma model the rows land in. */
  targetEntity: string
  description: string
  /**
   * Business key used to decide insert vs update. A row whose key matches an
   * existing record updates it; ingestion is idempotent by construction, so a
   * file replayed after a failure does not duplicate.
   */
  naturalKey: string[]
  fields: TargetField[]
  /** What an integrator most often gets wrong on this feed. */
  operatorNotes: string[]
}

const GENDER = ['M', 'F'] as const
const ENCOUNTER_TYPE = ['OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'DAYCASE', 'TELEHEALTH'] as const
const APPOINTMENT_STATUS = [
  'BOOKED', 'COMPLETED', 'NO_SHOW', 'CANCELLED_PATIENT', 'CANCELLED_HOSPITAL', 'RESCHEDULED',
] as const
const LAB_FLAG = ['NORMAL', 'HIGH', 'LOW', 'CRITICAL_HIGH', 'CRITICAL_LOW', 'PENDING'] as const
const CLAIM_STATUS = [
  'SUBMITTED', 'PENDING', 'PAID', 'PARTIALLY_PAID', 'REJECTED', 'RESUBMITTED', 'WRITTEN_OFF', 'APPEALED',
] as const
const SURGERY_STATUS = [
  'RECOMMENDED', 'CONSULT_DONE', 'WORKUP_DONE', 'SCHEDULED', 'PERFORMED', 'CANCELLED', 'DEFERRED',
] as const
const REFERRAL_STATUS = ['ISSUED', 'BOOKED', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'LEAKED'] as const
const INSURANCE_STATUS = ['INSURED', 'SELF_PAY', 'EXPIRED', 'UNKNOWN'] as const
const CHANNEL = ['SMS', 'PHONE', 'WHATSAPP', 'EMAIL', 'PORTAL', 'WALK_IN'] as const

const hospitalRef: TargetField = {
  name: 'hospital_code',
  type: 'string',
  required: true,
  reference: { entity: 'Hospital', lookupBy: 'code', foreignKey: 'hospitalId' },
  description: 'Hospital business code. Must already exist in the platform.',
  example: 'RYD',
}

const specialtyRef: TargetField = {
  name: 'specialty_code',
  type: 'string',
  required: true,
  reference: { entity: 'Specialty', lookupBy: 'code', foreignKey: 'specialtyId' },
  description: 'Specialty code from the group reference list.',
  example: 'CARD',
}

const physicianRef: TargetField = {
  name: 'physician_code',
  type: 'string',
  required: true,
  reference: { entity: 'Physician', lookupBy: 'code', foreignKey: 'physicianId' },
  description: 'Physician code. Unknown codes reject the row rather than creating a placeholder.',
  example: 'RYD-CARD-1',
}

const patientRef: TargetField = {
  name: 'patient_mrn',
  type: 'string',
  required: true,
  reference: { entity: 'Patient', lookupBy: 'mrn', foreignKey: 'patientId' },
  description: 'Medical record number. The patient must be ingested before their clinical data.',
  example: 'RYD-100001',
}

export const DOMAINS: DomainSpec[] = [
  {
    key: 'PATIENT',
    label: 'Patient registration',
    targetEntity: 'Patient',
    description:
      'Demographics, contact details, consent and payer. The root feed — every clinical domain references a patient by MRN, so this must load first.',
    naturalKey: ['mrn'],
    operatorNotes: [
      'Load this before any clinical feed. A clinical row whose MRN is unknown is rejected, not queued.',
      'consent_marketing defaults to false when absent. Absence of consent is treated as refusal, so a missing column silently excludes patients from all outreach.',
      'Do not send the national ID in clear. Send it pre-masked; the platform stores only the masked form.',
    ],
    fields: [
      { name: 'mrn', type: 'string', required: true, description: 'Medical record number. The natural key.', example: 'RYD-100001' },
      { name: 'source_id', type: 'string', required: true, description: 'Primary key in the source system, retained for traceability.', example: 'VIDA-PAT-1000001' },
      { name: 'first_name', type: 'string', required: true, description: 'Given name.', example: 'Fatima' },
      { name: 'last_name', type: 'string', required: true, description: 'Family name.', example: 'Al-Harbi' },
      { name: 'date_of_birth', type: 'date', required: true, description: 'ISO date. Used for age-based rules.', example: '1971-04-12' },
      { name: 'gender', type: 'enum', required: true, values: GENDER, description: 'M or F.', example: 'F' },
      { name: 'national_id_masked', type: 'string', required: false, description: 'Pre-masked national identifier. Never send the full value.', example: '1*******123' },
      { name: 'phone', type: 'string', required: false, description: 'E.164 mobile number. Absent means unreachable by phone or SMS.', example: '+966512345678' },
      { name: 'email', type: 'string', required: false, description: 'Email address.', example: 'f.alharbi@example.sa' },
      { name: 'city', type: 'string', required: true, description: 'City of residence.', example: 'Riyadh' },
      { name: 'district', type: 'string', required: false, description: 'District or neighbourhood.', example: 'Al Olaya' },
      { name: 'latitude', type: 'number', required: false, min: -90, max: 90, description: 'Residence latitude, for geographic analysis.', example: '24.7136' },
      { name: 'longitude', type: 'number', required: false, min: -180, max: 180, description: 'Residence longitude.', example: '46.6753' },
      { name: 'distance_km', type: 'number', required: false, min: 0, max: 5000, description: 'Distance to the registering hospital. Feeds the proximity scoring factor; derived from coordinates when absent.', example: '12.4' },
      { name: 'preferred_channel', type: 'enum', required: false, values: CHANNEL, description: 'How the patient prefers to be contacted.', example: 'SMS' },
      { name: 'contactable', type: 'boolean', required: false, description: 'False excludes the patient from every outreach rule. Defaults to true.', example: 'true' },
      { name: 'consent_marketing', type: 'boolean', required: false, description: 'Consent to non-clinical outreach. Defaults to FALSE when absent.', example: 'true' },
      { name: 'language', type: 'string', required: false, description: 'Preferred language code.', example: 'ar' },
      hospitalRef,
      { name: 'primary_physician_code', type: 'string', required: false, reference: { entity: 'Physician', lookupBy: 'code', foreignKey: 'primaryPhysicianId' }, description: 'Usual treating physician.', example: 'RYD-FMED-1' },
      { name: 'payer_code', type: 'string', required: false, reference: { entity: 'Payer', lookupBy: 'code', foreignKey: 'payerId' }, description: 'Insurance payer code.', example: 'BUPA' },
      { name: 'insurance_status', type: 'enum', required: false, values: INSURANCE_STATUS, description: 'Cover status on the extract date.', example: 'INSURED' },
      { name: 'policy_number', type: 'string', required: false, description: 'Policy identifier.', example: 'BUPA-1234567' },
      { name: 'registered_at', type: 'datetime', required: true, description: 'First registration timestamp.', example: '2021-03-04T09:12:00Z' },
      { name: 'last_encounter_at', type: 'datetime', required: false, description: 'Most recent encounter. Recomputed from the encounter feed when that loads.', example: '2026-06-18T10:30:00Z' },
      { name: 'is_deceased', type: 'boolean', required: false, description: 'Excludes the patient from every rule. Defaults to false.', example: 'false' },
      { name: 'vip_flag', type: 'boolean', required: false, description: 'Flags the record for personal handling.', example: 'false' },
    ],
  },
  {
    key: 'ENCOUNTER',
    label: 'Clinical encounters',
    targetEntity: 'Encounter',
    description:
      'Outpatient, inpatient, emergency and day-case activity. Carries the physician follow-up instruction, which is the single most valuable field in the whole feed.',
    naturalKey: ['sourceId'],
    operatorNotes: [
      'follow_up_recommended and follow_up_days drive an entire detection rule. If your HIS holds the follow-up instruction only as free text in the clinical note, extract it upstream — the rule cannot infer it.',
      'gross_charge is used for lifetime-value and reactivation scoring. Send the charge, not the collected amount.',
      'An encounter whose patient MRN is unknown is rejected. Sequence the patient feed first.',
    ],
    fields: [
      { name: 'source_id', type: 'string', required: true, description: 'Encounter key in the source system. The natural key.', example: 'VIDA-ENC-884213' },
      patientRef,
      hospitalRef,
      { name: 'department_code', type: 'string', required: true, reference: { entity: 'Department', lookupBy: 'code', foreignKey: 'departmentId' }, description: 'Department code within the hospital.', example: 'OPD' },
      specialtyRef,
      physicianRef,
      { name: 'type', type: 'enum', required: true, values: ENCOUNTER_TYPE, description: 'Encounter setting.', example: 'OUTPATIENT' },
      { name: 'started_at', type: 'datetime', required: true, description: 'Encounter start.', example: '2026-06-18T10:30:00Z' },
      { name: 'ended_at', type: 'datetime', required: false, description: 'Encounter end.', example: '2026-06-18T11:05:00Z' },
      { name: 'status', type: 'string', required: false, description: 'Encounter status. Defaults to COMPLETED.', example: 'COMPLETED' },
      { name: 'chief_complaint', type: 'string', required: false, description: 'Presenting complaint.', example: 'Routine chronic disease review' },
      { name: 'note_summary', type: 'string', required: false, description: 'Summary of the clinical note.', example: 'Reviewed. Review in 90 days.' },
      { name: 'follow_up_recommended', type: 'boolean', required: false, description: 'Whether the physician documented a follow-up. Drives the follow-up-overdue rule.', example: 'true' },
      { name: 'follow_up_days', type: 'integer', required: false, min: 1, max: 1095, description: 'Interval in days the physician specified.', example: '90' },
      { name: 'discharge_disposition', type: 'string', required: false, description: 'Where the patient went on discharge.', example: 'HOME' },
      { name: 'gross_charge', type: 'number', required: false, min: 0, description: 'Gross charge raised for the encounter.', example: '520.00' },
    ],
  },
  {
    key: 'LAB_RESULT',
    label: 'Laboratory results',
    targetEntity: 'LabResult',
    description:
      'Results and outstanding orders from the LIS. Abnormal and critical flags drive the highest-urgency clinical rules in the platform.',
    naturalKey: ['sourceId'],
    operatorNotes: [
      'Send pending orders too, with is_pending = true and no value. The "ordered but never resulted" rule depends on them and cannot infer a missing order.',
      'repeat_interval_days encodes the clinical monitoring cadence (HbA1c = 90). Without it the recurring-monitoring rule finds nothing.',
      'flag must be the laboratory\'s own interpretation. The platform does not re-derive abnormality from the reference range.',
    ],
    fields: [
      { name: 'source_id', type: 'string', required: true, description: 'Result key in the LIS. The natural key.', example: 'LIS-4412093' },
      patientRef,
      { name: 'encounter_source_id', type: 'string', required: false, reference: { entity: 'Encounter', lookupBy: 'sourceId', foreignKey: 'encounterId' }, description: 'Ordering encounter, if any.', example: 'VIDA-ENC-884213' },
      { name: 'loinc_code', type: 'string', required: true, description: 'LOINC code for the analyte.', example: '4548-4' },
      { name: 'test_name', type: 'string', required: true, description: 'Test name as reported.', example: 'Haemoglobin A1c' },
      { name: 'panel', type: 'string', required: true, description: 'Panel the test belongs to. Opportunities group by panel, not analyte.', example: 'Diabetes' },
      { name: 'value', type: 'number', required: false, description: 'Numeric result. Empty for pending orders.', example: '9.2' },
      { name: 'text_value', type: 'string', required: false, description: 'Non-numeric result.', example: 'Positive' },
      { name: 'unit', type: 'string', required: true, description: 'Unit of measure.', example: '%' },
      { name: 'ref_low', type: 'number', required: false, description: 'Lower reference bound.', example: '4.0' },
      { name: 'ref_high', type: 'number', required: false, description: 'Upper reference bound.', example: '5.7' },
      { name: 'flag', type: 'enum', required: true, values: LAB_FLAG, description: 'Laboratory interpretation. CRITICAL_* triggers the safety-escalation rule.', example: 'HIGH' },
      { name: 'ordered_at', type: 'datetime', required: true, description: 'When the test was ordered.', example: '2026-06-18T09:00:00Z' },
      { name: 'resulted_at', type: 'datetime', required: true, description: 'When the result was filed. For pending orders, send the order time.', example: '2026-06-19T14:22:00Z' },
      { name: 'is_pending', type: 'boolean', required: false, description: 'True when ordered but not resulted.', example: 'false' },
      { name: 'repeat_interval_days', type: 'integer', required: false, min: 1, max: 1095, description: 'Clinical repeat cadence for this test.', example: '90' },
    ],
  },
  {
    key: 'APPOINTMENT',
    label: 'Appointments',
    targetEntity: 'Appointment',
    description:
      'Bookings and their outcomes. No-shows, cancellations and unreconciled bookings all become opportunities.',
    naturalKey: ['sourceId'],
    operatorNotes: [
      'Send every outcome, not only completed visits. No-shows and cancellations are the point of this feed.',
      'Distinguish CANCELLED_PATIENT from CANCELLED_HOSPITAL. Repeated patient cancellation signals an access barrier; hospital cancellation is a capacity problem, and they route to different teams.',
      'A past-dated appointment still in BOOKED is treated as unreconciled and raises an opportunity. Close them out at source if that is not intended.',
    ],
    fields: [
      { name: 'source_id', type: 'string', required: true, description: 'Appointment key in the source system.', example: 'VIDA-APT-99120' },
      patientRef,
      hospitalRef,
      specialtyRef,
      physicianRef,
      { name: 'scheduled_for', type: 'datetime', required: true, description: 'Appointment slot.', example: '2026-07-02T08:30:00Z' },
      { name: 'created_at', type: 'datetime', required: true, description: 'When the booking was made.', example: '2026-06-18T11:10:00Z' },
      { name: 'status', type: 'enum', required: true, values: APPOINTMENT_STATUS, description: 'Booking outcome.', example: 'NO_SHOW' },
      { name: 'cancel_reason', type: 'string', required: false, description: 'Reason given for a cancellation.', example: 'Transport difficulty' },
      { name: 'is_follow_up', type: 'boolean', required: false, description: 'Whether this is a follow-up rather than a new booking.', example: 'true' },
      { name: 'channel', type: 'enum', required: false, values: CHANNEL, description: 'How the booking was made.', example: 'PORTAL' },
    ],
  },
  {
    key: 'CLAIM',
    label: 'Insurance claims',
    targetEntity: 'InsuranceClaim',
    description:
      'Claims and their adjudication from the revenue-cycle system. Rejections carry their own feed fields on the same row.',
    naturalKey: ['claimNumber'],
    operatorNotes: [
      'Send rejection_reason_code and rejection_amount on the same row as the claim. The platform creates the rejection record from them.',
      'rejection_recovery_rate should be your own historical recovery rate for that reason and payer. Left empty it defaults to zero, and every rejection then falls below the recoverable threshold and the module goes silent.',
      'department_name is a label, not a code — it routes recovery work to the team that generated the defect.',
    ],
    fields: [
      { name: 'claim_number', type: 'string', required: true, description: 'Claim number. The natural key.', example: 'RYD-CLM-0012345' },
      patientRef,
      hospitalRef,
      { name: 'encounter_source_id', type: 'string', required: false, reference: { entity: 'Encounter', lookupBy: 'sourceId', foreignKey: 'encounterId' }, description: 'Encounter the claim relates to.', example: 'VIDA-ENC-884213' },
      { name: 'payer_code', type: 'string', required: true, reference: { entity: 'Payer', lookupBy: 'code', foreignKey: 'payerId' }, description: 'Payer code.', example: 'BUPA' },
      { name: 'service_date', type: 'datetime', required: true, description: 'Date of service.', example: '2026-06-18T00:00:00Z' },
      { name: 'submitted_at', type: 'datetime', required: false, description: 'Submission timestamp. Drives the stalled-claim rule.', example: '2026-06-20T00:00:00Z' },
      { name: 'status', type: 'enum', required: true, values: CLAIM_STATUS, description: 'Adjudication status.', example: 'REJECTED' },
      { name: 'billed_amount', type: 'number', required: true, min: 0, description: 'Amount billed.', example: '2400.00' },
      { name: 'approved_amount', type: 'number', required: false, min: 0, description: 'Amount approved by the payer.', example: '0' },
      { name: 'paid_amount', type: 'number', required: false, min: 0, description: 'Amount remitted. A shortfall against approved raises an underpayment opportunity.', example: '0' },
      { name: 'service_code', type: 'string', required: true, description: 'Billed service or procedure code.', example: '99214' },
      { name: 'service_description', type: 'string', required: true, description: 'Service description.', example: 'Outpatient consultation, moderate complexity' },
      { name: 'department_name', type: 'string', required: true, description: 'Department that delivered the service.', example: 'Outpatient Department' },
      { name: 'resubmission_count', type: 'integer', required: false, min: 0, description: 'Times already resubmitted.', example: '0' },
      { name: 'rejection_reason_code', type: 'string', required: false, description: 'Rejection reason code. Present only on rejected claims.', example: 'CODING' },
      { name: 'rejection_reason_text', type: 'string', required: false, description: 'Payer rejection narrative.', example: 'Procedure code inconsistent with diagnosis' },
      { name: 'rejection_amount', type: 'number', required: false, min: 0, description: 'Amount rejected.', example: '2400.00' },
      { name: 'rejection_date', type: 'datetime', required: false, description: 'Rejection date. Starts the resubmission window clock.', example: '2026-06-28T00:00:00Z' },
      { name: 'rejection_appealable', type: 'boolean', required: false, description: 'Whether the payer route remains open.', example: 'true' },
      { name: 'rejection_pathway', type: 'string', required: false, description: 'Recommended recovery pathway.', example: 'CORRECT_CODING' },
      { name: 'rejection_recovery_rate', type: 'number', required: false, min: 0, max: 1, description: 'Historical recovery rate for this reason and payer, 0..1.', example: '0.72' },
      { name: 'rejection_department', type: 'string', required: false, description: 'Department responsible for the defect.', example: 'Health Information Management' },
    ],
  },
  {
    key: 'PHARMACY',
    label: 'Pharmacy dispensing',
    targetEntity: 'PharmacyTransaction',
    description:
      'Dispense events. The cadence between them is what distinguishes a late refill from an abandoned course.',
    naturalKey: ['sourceId'],
    operatorNotes: [
      'Send the full dispense history, not only the latest. The abandonment rule measures a break from the patient\'s own median interval and needs at least three prior dispenses.',
      'days_supply must reflect what was actually dispensed, not what was prescribed. The supply-exhausted date is computed from it.',
      'The medication must exist in the platform formulary. Unknown codes reject the row.',
    ],
    fields: [
      { name: 'source_id', type: 'string', required: true, description: 'Dispense key in the pharmacy system.', example: 'PHR-773311' },
      patientRef,
      { name: 'medication_code', type: 'string', required: true, reference: { entity: 'Medication', lookupBy: 'code', foreignKey: 'medicationId' }, description: 'Formulary code.', example: 'MET500' },
      { name: 'dispensed_at', type: 'datetime', required: true, description: 'Dispense timestamp.', example: '2026-06-18T12:00:00Z' },
      { name: 'quantity', type: 'integer', required: true, min: 1, description: 'Units dispensed.', example: '60' },
      { name: 'days_supply', type: 'integer', required: true, min: 1, max: 365, description: 'Days of therapy dispensed.', example: '30' },
      { name: 'amount', type: 'number', required: false, min: 0, description: 'Amount charged.', example: '13.50' },
      { name: 'is_refill', type: 'boolean', required: false, description: 'Whether this is a refill rather than a first fill.', example: 'true' },
    ],
  },
  {
    key: 'SURGERY',
    label: 'Surgical pathway',
    targetEntity: 'Surgery',
    description:
      'The recommendation → consultation → workup → booking → performance chain. Every stage that stalls becomes an opportunity.',
    naturalKey: ['sourceId'],
    operatorNotes: [
      'Send recommendations and consultations, not only performed procedures. A theatre-only feed makes the entire surgical conversion pipeline invisible.',
      'workup_complete drives a rule about pre-operative assessments expiring unused. If the flag is not held structurally, derive it upstream from the pre-op order set.',
      'estimated_value should be the expected case value. It is the largest single financial signal in the pipeline.',
    ],
    fields: [
      { name: 'source_id', type: 'string', required: true, description: 'Surgical case key.', example: 'SUR-20991' },
      patientRef,
      hospitalRef,
      physicianRef,
      { name: 'cpt_code', type: 'string', required: true, description: 'Procedure code.', example: '27447' },
      { name: 'description', type: 'string', required: true, description: 'Procedure description.', example: 'Total knee arthroplasty' },
      { name: 'status', type: 'enum', required: true, values: SURGERY_STATUS, description: 'Stage in the surgical pathway.', example: 'RECOMMENDED' },
      { name: 'recommended_at', type: 'datetime', required: true, description: 'When the procedure was recommended.', example: '2026-05-02T00:00:00Z' },
      { name: 'scheduled_for', type: 'datetime', required: false, description: 'Booked theatre date.', example: '2026-07-14T07:00:00Z' },
      { name: 'performed_at', type: 'datetime', required: false, description: 'When performed.', example: '2026-07-14T09:30:00Z' },
      { name: 'cancel_reason', type: 'string', required: false, description: 'Cancellation reason.', example: 'Patient travelling' },
      { name: 'workup_complete', type: 'boolean', required: false, description: 'Pre-operative assessment finished.', example: 'true' },
      { name: 'estimated_value', type: 'number', required: false, min: 0, description: 'Expected case value.', example: '48000' },
      { name: 'urgency', type: 'string', required: false, description: 'ELECTIVE or URGENT. Urgent cases carry a priority floor.', example: 'ELECTIVE' },
    ],
  },
  {
    key: 'REFERRAL',
    label: 'Referrals',
    targetEntity: 'Referral',
    description:
      'Internal and external referrals. Referrals fulfilled outside the group for services the group provides are retainable volume that left.',
    naturalKey: ['sourceId'],
    operatorNotes: [
      'Set direction = EXTERNAL_OUT and status = LEAKED when a referral was fulfilled outside the group. Without it, leakage is invisible and the service-line module understates the problem.',
      'expires_at drives the expired-referral rule. A referral with no expiry never expires and never raises one.',
    ],
    fields: [
      { name: 'source_id', type: 'string', required: true, description: 'Referral key.', example: 'REF-55120' },
      patientRef,
      hospitalRef,
      { name: 'from_physician_code', type: 'string', required: true, reference: { entity: 'Physician', lookupBy: 'code', foreignKey: 'fromPhysicianId' }, description: 'Referring physician.', example: 'RYD-FMED-1' },
      { name: 'to_specialty_code', type: 'string', required: true, reference: { entity: 'Specialty', lookupBy: 'code', foreignKey: 'toSpecialtyId' }, description: 'Specialty referred to.', example: 'CARD' },
      { name: 'direction', type: 'string', required: false, description: 'INTERNAL, EXTERNAL_IN or EXTERNAL_OUT.', example: 'INTERNAL' },
      { name: 'issued_at', type: 'datetime', required: true, description: 'Issue date.', example: '2026-06-18T00:00:00Z' },
      { name: 'expires_at', type: 'datetime', required: false, description: 'Expiry date.', example: '2026-09-16T00:00:00Z' },
      { name: 'status', type: 'enum', required: true, values: REFERRAL_STATUS, description: 'Referral outcome.', example: 'ISSUED' },
      { name: 'reason', type: 'string', required: true, description: 'Reason for referral.', example: 'Chest pain on exertion' },
      { name: 'estimated_value', type: 'number', required: false, min: 0, description: 'Estimated value of the onward service.', example: '1400' },
      { name: 'external_provider', type: 'string', required: false, description: 'External provider that fulfilled it, when leaked.', example: 'Gulf Advanced Labs' },
    ],
  },
  {
    key: 'DIAGNOSIS',
    label: 'Diagnoses',
    targetEntity: 'Diagnosis',
    description:
      'Coded diagnoses. The chronic flag gates the monitoring and reactivation rules — without it those rules cannot tell a one-off from ongoing care.',
    naturalKey: ['patientId', 'icd10', 'diagnosedAt'],
    operatorNotes: [
      'is_chronic gates two rule families. If your coding system does not carry it, derive it from an ICD-10 chronic-condition list upstream rather than leaving it empty.',
    ],
    fields: [
      patientRef,
      { name: 'encounter_source_id', type: 'string', required: true, reference: { entity: 'Encounter', lookupBy: 'sourceId', foreignKey: 'encounterId' }, description: 'Encounter the diagnosis was recorded at.', example: 'VIDA-ENC-884213' },
      { name: 'icd10', type: 'string', required: true, description: 'ICD-10 code.', example: 'E11.9' },
      { name: 'description', type: 'string', required: true, description: 'Diagnosis description.', example: 'Type 2 diabetes mellitus without complications' },
      { name: 'rank', type: 'string', required: false, description: 'PRIMARY or SECONDARY.', example: 'PRIMARY' },
      { name: 'is_chronic', type: 'boolean', required: false, description: 'Whether the condition is chronic.', example: 'true' },
      { name: 'diagnosed_at', type: 'datetime', required: true, description: 'When diagnosed.', example: '2026-06-18T10:45:00Z' },
    ],
  },
]

export const DOMAIN_BY_KEY: Record<string, DomainSpec> = Object.fromEntries(
  DOMAINS.map((d) => [d.key, d])
)

/** CSV header row for a domain's template download. */
export function templateHeader(domain: DomainSpec): string {
  return domain.fields.map((f) => f.name).join(',')
}

/** A single example row, so the template is runnable rather than only correct. */
export function templateExampleRow(domain: DomainSpec): string {
  return domain.fields
    .map((f) => {
      const v = f.example
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    })
    .join(',')
}
