/**
 * The semantic layer's controlled vocabulary.
 *
 * Enum-like columns are stored as plain strings so the schema ports cleanly to
 * Snowflake/Postgres, which means the validity contract lives here instead of
 * in the database. Everything that writes one of these columns goes through
 * these constants, and everything that renders one goes through the label maps.
 */

export const OPPORTUNITY_CATEGORIES = [
  'LAB',
  'SURGERY',
  'MEDICATION',
  'INSURANCE',
  'REACTIVATION',
  'APPOINTMENT',
  'REFERRAL',
  'SERVICE_LINE',
] as const
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<OpportunityCategory, string> = {
  LAB: 'Laboratory',
  SURGERY: 'Surgical',
  MEDICATION: 'Medication',
  INSURANCE: 'Insurance recovery',
  REACTIVATION: 'Patient reactivation',
  APPOINTMENT: 'Appointment & follow-up',
  REFERRAL: 'Referral',
  SERVICE_LINE: 'Service-line growth',
}

/**
 * Opportunity lifecycle, section 20. The order is significant: `statusRank`
 * uses the index for funnel placement and for "did this move forward?" checks,
 * so terminal states sit at the end and must not be reordered casually.
 */
export const OPPORTUNITY_STATUSES = [
  'DETECTED',
  'REVIEWED',
  'ASSIGNED',
  'CONTACTED',
  'APPOINTMENT_SCHEDULED',
  'PATIENT_RETURNED',
  'TREATMENT_COMPLETED',
  'CONVERTED',
  'CLOSED',
  'REJECTED',
  'NOT_APPLICABLE',
] as const
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]

export const STATUS_LABEL: Record<OpportunityStatus, string> = {
  DETECTED: 'Detected',
  REVIEWED: 'Reviewed',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  APPOINTMENT_SCHEDULED: 'Appointment scheduled',
  PATIENT_RETURNED: 'Patient returned',
  TREATMENT_COMPLETED: 'Treatment completed',
  CONVERTED: 'Converted',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  NOT_APPLICABLE: 'Not applicable',
}

/** Statuses that stop SLA and aging clocks. */
export const TERMINAL_STATUSES: OpportunityStatus[] = [
  'CONVERTED',
  'CLOSED',
  'REJECTED',
  'NOT_APPLICABLE',
]

/** The eight funnel stages rendered in section 6, in order. */
export const FUNNEL_STAGES = [
  'DETECTED',
  'REVIEWED',
  'ASSIGNED',
  'CONTACTED',
  'APPOINTMENT_SCHEDULED',
  'PATIENT_RETURNED',
  'TREATMENT_COMPLETED',
  'CONVERTED',
] as const

export function statusRank(status: string): number {
  const i = (OPPORTUNITY_STATUSES as readonly string[]).indexOf(status)
  return i === -1 ? 0 : i
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as string[]).includes(status)
}

/**
 * A status is "open work" when it is neither terminal nor already converted.
 * Used by every work-queue and active-opportunity count in the app.
 */
export function isOpen(status: string): boolean {
  return !isTerminal(status)
}

export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

export const ACTION_TYPES = [
  'REVIEW',
  'ASSIGN',
  'CALL',
  'SMS',
  'EMAIL',
  'WHATSAPP',
  'SCHEDULE_APPOINTMENT',
  'PHYSICIAN_REVIEW',
  'RESUBMIT_CLAIM',
  'CORRECT_CODING',
  'OBTAIN_DOCUMENTATION',
  'FINANCIAL_COUNSELLING',
  'PHARMACY_FOLLOWUP',
  'STATUS_CHANGE',
  'NOTE',
  'CLOSE',
] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export const ACTION_LABEL: Record<ActionType, string> = {
  REVIEW: 'Reviewed',
  ASSIGN: 'Assigned',
  CALL: 'Phone call',
  SMS: 'SMS sent',
  EMAIL: 'Email sent',
  WHATSAPP: 'WhatsApp message',
  SCHEDULE_APPOINTMENT: 'Appointment scheduled',
  PHYSICIAN_REVIEW: 'Physician review',
  RESUBMIT_CLAIM: 'Claim resubmitted',
  CORRECT_CODING: 'Coding corrected',
  OBTAIN_DOCUMENTATION: 'Documentation obtained',
  FINANCIAL_COUNSELLING: 'Financial counselling',
  PHARMACY_FOLLOWUP: 'Pharmacy follow-up',
  STATUS_CHANGE: 'Status changed',
  NOTE: 'Note added',
  CLOSE: 'Closed',
}

/** Which action types a user may log without also moving the status. */
export const REJECTION_REASONS = [
  'CODING',
  'ELIGIBILITY',
  'MISSING_DOCUMENTATION',
  'MEDICAL_NECESSITY',
  'PRIOR_AUTH',
  'SERVICE_NOT_COVERED',
  'DUPLICATE',
  'TIMELY_FILING',
  'UNDERPAID',
  'BUNDLING',
] as const
export type RejectionReason = (typeof REJECTION_REASONS)[number]

export const REJECTION_LABEL: Record<RejectionReason, string> = {
  CODING: 'Coding error',
  ELIGIBILITY: 'Eligibility not verified',
  MISSING_DOCUMENTATION: 'Missing documentation',
  MEDICAL_NECESSITY: 'Medical necessity not established',
  PRIOR_AUTH: 'Prior authorisation absent',
  SERVICE_NOT_COVERED: 'Service not covered',
  DUPLICATE: 'Duplicate claim',
  TIMELY_FILING: 'Timely filing exceeded',
  UNDERPAID: 'Underpaid against contract',
  BUNDLING: 'Bundling / unbundling dispute',
}

export const RECOVERY_PATHWAYS = [
  'RESUBMIT',
  'CORRECT_CODING',
  'OBTAIN_DOCUMENTATION',
  'APPEAL',
  'PATIENT_RESPONSIBILITY',
  'FINANCIAL_COUNSELLING',
  'WRITE_OFF',
] as const
export type RecoveryPathway = (typeof RECOVERY_PATHWAYS)[number]

export const PATHWAY_LABEL: Record<RecoveryPathway, string> = {
  RESUBMIT: 'Resubmit claim',
  CORRECT_CODING: 'Correct coding and resubmit',
  OBTAIN_DOCUMENTATION: 'Obtain documentation and resubmit',
  APPEAL: 'Formal appeal',
  PATIENT_RESPONSIBILITY: 'Transfer to patient responsibility',
  FINANCIAL_COUNSELLING: 'Financial counselling',
  WRITE_OFF: 'Write off',
}

export const CHANNELS = ['PHONE', 'SMS', 'EMAIL', 'WHATSAPP', 'PORTAL'] as const
export type Channel = (typeof CHANNELS)[number]

export const SCORING_FACTORS = [
  'clinicalUrgency',
  'conversionProbability',
  'financialValue',
  'timeSensitivity',
  'patientEngagement',
  'historicalUtilisation',
  'serviceAvailability',
  'insuranceStatus',
  'proximity',
] as const
export type ScoringFactor = (typeof SCORING_FACTORS)[number]

export const FACTOR_LABEL: Record<ScoringFactor, string> = {
  clinicalUrgency: 'Clinical urgency',
  conversionProbability: 'Conversion probability',
  financialValue: 'Financial value',
  timeSensitivity: 'Time sensitivity',
  patientEngagement: 'Patient engagement',
  historicalUtilisation: 'Historical utilisation',
  serviceAvailability: 'Service availability',
  insuranceStatus: 'Insurance status',
  proximity: 'Patient proximity',
}

export const CAMPAIGN_MEMBER_STATUSES = [
  'ELIGIBLE',
  'CONTACTED',
  'RESPONDED',
  'BOOKED',
  'VISITED',
  'CONVERTED',
  'OPTED_OUT',
] as const

export const AUDIT_CATEGORIES = [
  'AUTH',
  'PHI_ACCESS',
  'OPPORTUNITY',
  'RULE_CHANGE',
  'SCORING_CHANGE',
  'CAMPAIGN',
  'EXPORT',
  'NL_QUERY',
  'SQL_EXECUTION',
  'ADMIN',
  'SECURITY',
] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]
