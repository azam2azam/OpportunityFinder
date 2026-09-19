import type { RuleDefinition } from './types'

/**
 * The rule catalogue.
 *
 * Every threshold a clinician or administrator might argue about lives in
 * `defaultParams` and is editable from Opportunity Rules at runtime. The
 * detector functions read those params; they contain no literals of their own.
 * `paramDocs` is what the rule editor renders next to each field, so a
 * parameter without documentation should not be added.
 */
export const RULE_CATALOGUE: RuleDefinition[] = [
  // ── LABORATORY ────────────────────────────────────────────────────────
  {
    key: 'LAB_ABNORMAL_NO_FOLLOWUP',
    name: 'Abnormal result without follow-up',
    category: 'LAB',
    description:
      'A laboratory result outside the reference range was filed and the patient has had no clinical encounter since, past the review window.',
    defaultParams: {
      followUpWindowDays: 30,
      lookbackDays: 365,
      flags: ['HIGH', 'LOW', 'CRITICAL_HIGH', 'CRITICAL_LOW'],
      minPotentialValue: 280,
    },
    paramDocs: {
      followUpWindowDays: 'Days after the result within which a follow-up encounter is expected.',
      lookbackDays: 'How far back to scan for abnormal results.',
      flags: 'Result flags treated as abnormal.',
      minPotentialValue: 'Estimated value of the follow-up consultation (SAR).',
    },
    clinicalUrgency: 72,
    slaDays: 5,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Contact the patient and schedule a follow-up consultation with the ordering physician.',
  },
  {
    key: 'LAB_CRITICAL_UNACTIONED',
    name: 'Critical result not acted on',
    category: 'LAB',
    description:
      'A critically abnormal result has no clinical encounter recorded after it within the safety window. Escalated to the clinical team regardless of financial value.',
    defaultParams: {
      safetyWindowDays: 7,
      lookbackDays: 180,
      minPotentialValue: 400,
    },
    paramDocs: {
      safetyWindowDays: 'Days after a critical result within which clinical contact must be evidenced.',
      lookbackDays: 'How far back to scan for critical results.',
      minPotentialValue: 'Estimated value of the urgent review (SAR).',
    },
    clinicalUrgency: 96,
    slaDays: 1,
    defaultOwnerRole: 'DEPARTMENT_MANAGER',
    recommendedAction:
      'Escalate to the ordering physician for urgent clinical review, then contact the patient.',
  },
  {
    key: 'LAB_PENDING_ORDER',
    name: 'Ordered investigation never resulted',
    category: 'LAB',
    description:
      'A laboratory order was placed but no result has been filed, past the expected turnaround. The patient may not have attended the collection.',
    defaultParams: { pendingDays: 14, lookbackDays: 180, minPotentialValue: 180 },
    paramDocs: {
      pendingDays: 'Days after ordering before a missing result is treated as an opportunity.',
      lookbackDays: 'How far back to scan for pending orders.',
      minPotentialValue: 'Estimated value of the outstanding investigation (SAR).',
    },
    clinicalUrgency: 58,
    slaDays: 5,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Contact the patient to complete the outstanding laboratory investigation.',
  },
  {
    key: 'LAB_RECURRING_LAPSED',
    name: 'Recurring monitoring test lapsed',
    category: 'LAB',
    description:
      'A test with an established repeat interval (for example HbA1c every 90 days) is overdue against that interval, and the patient has stopped attending.',
    defaultParams: {
      graceDays: 30,
      lookbackDays: 730,
      maxLapseDays: 540,
      requireChronicContext: true,
      minPriorResults: 2,
      minPotentialValue: 220,
    },
    paramDocs: {
      graceDays: 'Days past the clinical repeat interval before the test counts as lapsed.',
      lookbackDays: 'How far back to look for the last result in the series.',
      maxLapseDays:
        'Beyond this lapse the patient is a reactivation case, not a monitoring one; handled by the reactivation rules instead.',
      requireChronicContext:
        'Only raise where a chronic diagnosis or active long-term prescription makes the monitoring clinically indicated. Without this, one-off tests from an old episode generate recalls nobody intends.',
      minPriorResults:
        'Results needed in the panel before it counts as recurring monitoring. A single past result is an episode, not a cycle.',
      minPotentialValue: 'Estimated value of the repeat test plus review (SAR).',
    },
    clinicalUrgency: 66,
    slaDays: 7,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Invite the patient for the overdue monitoring test and physician review.',
  },
  {
    key: 'LAB_NO_PHYSICIAN_RETURN',
    name: 'Laboratory completed, patient never returned',
    category: 'LAB',
    description:
      'The patient completed laboratory work but never returned to the physician to have it reviewed, so the episode of care is unfinished.',
    defaultParams: { returnWindowDays: 21, lookbackDays: 270, minPotentialValue: 260 },
    paramDocs: {
      returnWindowDays: 'Days after the result within which the review consultation is expected.',
      lookbackDays: 'How far back to scan.',
      minPotentialValue: 'Estimated value of the review consultation (SAR).',
    },
    clinicalUrgency: 54,
    slaDays: 7,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Call the patient to book the results-review consultation.',
  },

  // ── SURGERY ───────────────────────────────────────────────────────────
  {
    key: 'SURG_RECOMMENDED_NOT_SCHEDULED',
    name: 'Surgery recommended but not scheduled',
    category: 'SURGERY',
    description:
      'A surgical procedure was recommended at consultation and no procedure has been booked within the decision window.',
    defaultParams: { decisionWindowDays: 30, lookbackDays: 365 },
    paramDocs: {
      decisionWindowDays: 'Days allowed between recommendation and booking before flagging.',
      lookbackDays: 'How far back to scan for recommendations.',
    },
    clinicalUrgency: 74,
    slaDays: 5,
    defaultOwnerRole: 'DEPARTMENT_MANAGER',
    recommendedAction:
      'Contact the patient to confirm the surgical decision and book a theatre date.',
  },
  {
    key: 'SURG_WORKUP_DONE_NOT_PERFORMED',
    name: 'Pre-operative workup complete, surgery not performed',
    category: 'SURGERY',
    description:
      'Pre-operative assessment was completed — a cost already incurred — but the procedure was never performed. Workup results expire, so delay wastes the investment.',
    defaultParams: { staleDays: 45, workupValidityDays: 90, lookbackDays: 365 },
    paramDocs: {
      staleDays: 'Days after workup completion before flagging.',
      workupValidityDays: 'Days a pre-operative workup stays clinically valid; urgency rises near expiry.',
      lookbackDays: 'How far back to scan.',
    },
    clinicalUrgency: 80,
    slaDays: 3,
    defaultOwnerRole: 'DEPARTMENT_MANAGER',
    recommendedAction:
      'Book the procedure before the pre-operative workup expires and has to be repeated.',
  },
  {
    key: 'SURG_CANCELLED_NOT_REBOOKED',
    name: 'Cancelled surgery never rebooked',
    category: 'SURGERY',
    description:
      'A scheduled procedure was cancelled and no replacement booking exists for the same patient.',
    defaultParams: { rebookWindowDays: 21, lookbackDays: 365 },
    paramDocs: {
      rebookWindowDays: 'Days after cancellation within which a rebooking is expected.',
      lookbackDays: 'How far back to scan for cancellations.',
    },
    clinicalUrgency: 70,
    slaDays: 4,
    defaultOwnerRole: 'DEPARTMENT_MANAGER',
    recommendedAction: 'Contact the patient to understand the cancellation and offer a new date.',
  },
  {
    key: 'SURG_CONSULT_PATIENT_INACTIVE',
    name: 'Surgical consultation then patient went inactive',
    category: 'SURGERY',
    description:
      'The patient attended a surgical consultation and has had no contact with the group since, suggesting the case was lost rather than declined.',
    defaultParams: { inactiveDays: 90, lookbackDays: 540 },
    paramDocs: {
      inactiveDays: 'Days of no encounter after the consultation before flagging.',
      lookbackDays: 'How far back to scan for consultations.',
    },
    clinicalUrgency: 62,
    slaDays: 7,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction:
      'Re-engage the patient; confirm whether the procedure was performed elsewhere or deferred.',
  },

  // ── MEDICATION ────────────────────────────────────────────────────────
  {
    key: 'MED_REFILL_OVERDUE',
    name: 'Medication refill overdue',
    category: 'MEDICATION',
    description:
      'A chronic medication supply has run out based on the last dispense and its days-supply, and no refill has been collected.',
    defaultParams: { graceDays: 10, lookbackDays: 365, chronicOnly: true },
    paramDocs: {
      graceDays: 'Days after the supply runs out before flagging.',
      lookbackDays: 'How far back to scan pharmacy transactions.',
      chronicOnly: 'Restrict to medications flagged as chronic therapy.',
    },
    clinicalUrgency: 68,
    slaDays: 5,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Pharmacy follow-up call; arrange the refill and check adherence.',
  },
  {
    key: 'MED_REFILL_ABANDONED',
    name: 'Refill pattern abandoned',
    category: 'MEDICATION',
    description:
      'The patient refilled on a regular cadence and then stopped entirely, which indicates an interrupted course rather than a late refill.',
    defaultParams: { abandonmentDays: 90, minPriorRefills: 3, lookbackDays: 540 },
    paramDocs: {
      abandonmentDays: 'Days since the last dispense before the pattern counts as abandoned.',
      minPriorRefills: 'Prior refills needed to establish a cadence.',
      lookbackDays: 'How far back to scan pharmacy transactions.',
    },
    clinicalUrgency: 76,
    slaDays: 4,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction:
      'Contact the patient about the treatment interruption and arrange physician review.',
  },
  {
    key: 'MED_CHRONIC_NO_REVIEW',
    name: 'Chronic therapy without physician review',
    category: 'MEDICATION',
    description:
      'The patient is on long-term therapy but has had no physician encounter within the review interval, so the prescription is continuing unsupervised.',
    defaultParams: { reviewIntervalDays: 180, lookbackDays: 540, minPotentialValue: 300 },
    paramDocs: {
      reviewIntervalDays: 'Maximum days between physician reviews for chronic therapy.',
      lookbackDays: 'How far back to scan prescriptions.',
      minPotentialValue: 'Estimated value of the review consultation (SAR).',
    },
    clinicalUrgency: 70,
    slaDays: 7,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Schedule a medication review consultation with the prescribing physician.',
  },
  {
    key: 'MED_MONITORING_DUE',
    name: 'Monitored medication without required test',
    category: 'MEDICATION',
    description:
      'A medication requiring periodic laboratory monitoring has no corresponding test within the monitoring interval. This is a medication-safety gap.',
    defaultParams: {
      monitoringIntervalDays: 120,
      graceDays: 21,
      requireRecentDispenseDays: 180,
      minPotentialValue: 240,
    },
    paramDocs: {
      monitoringIntervalDays: 'Required interval between monitoring tests.',
      graceDays: 'Days past the interval before flagging.',
      requireRecentDispenseDays:
        'Only raise where the medication was actually dispensed within this window. A prescription left open in VIDA is not evidence the patient is still taking it.',
      minPotentialValue: 'Estimated value of the monitoring test (SAR).',
    },
    clinicalUrgency: 88,
    slaDays: 2,
    defaultOwnerRole: 'DEPARTMENT_MANAGER',
    recommendedAction:
      'Arrange the required monitoring test and flag to the prescribing physician.',
  },
  {
    key: 'MED_COURSE_INCOMPLETE',
    name: 'Medication course left incomplete',
    category: 'MEDICATION',
    description:
      'Authorised refills remain unused past the planned end of the course, so the prescribed treatment was not completed.',
    defaultParams: { graceDays: 14, lookbackDays: 365, minPotentialValue: 160 },
    paramDocs: {
      graceDays: 'Days past the course end date before flagging.',
      lookbackDays: 'How far back to scan prescriptions.',
      minPotentialValue: 'Estimated value of the remaining course (SAR).',
    },
    clinicalUrgency: 60,
    slaDays: 7,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Pharmacy follow-up to complete the prescribed course.',
  },

  // ── INSURANCE RECOVERY ────────────────────────────────────────────────
  {
    key: 'INS_REJECTION_RECOVERABLE',
    name: 'Recoverable claim rejection',
    category: 'INSURANCE',
    description:
      'A rejected claim is still inside the payer resubmission window and its rejection reason has a defined correction pathway.',
    defaultParams: {
      minRejectedAmount: 200,
      minRecoveryRate: 0.15,
      pathways: ['RESUBMIT', 'CORRECT_CODING', 'OBTAIN_DOCUMENTATION', 'APPEAL'],
    },
    paramDocs: {
      minRejectedAmount: 'Minimum rejected amount worth working (SAR).',
      minRecoveryRate: 'Minimum historical recovery rate for the reason/payer pair.',
      pathways: 'Recovery pathways treated as actionable.',
    },
    clinicalUrgency: 10,
    slaDays: 5,
    defaultOwnerRole: 'RCM_SPECIALIST',
    recommendedAction: 'Correct and resubmit the claim before the payer window closes.',
  },
  {
    key: 'INS_REPEAT_REJECTION',
    name: 'Repeat rejection pattern',
    category: 'INSURANCE',
    description:
      'The same service code has been rejected repeatedly for the same reason, which points at a process defect rather than a one-off claim error.',
    defaultParams: { minOccurrences: 3, windowDays: 120, minTotalAmount: 1500 },
    paramDocs: {
      minOccurrences: 'Rejections of the same service/reason needed to flag a pattern.',
      windowDays: 'Window over which occurrences are counted.',
      minTotalAmount: 'Minimum combined rejected amount (SAR).',
    },
    clinicalUrgency: 5,
    slaDays: 10,
    defaultOwnerRole: 'RCM_SPECIALIST',
    recommendedAction:
      'Root-cause the rejection pattern with the responsible department and fix the submission process.',
  },
  {
    key: 'INS_UNDERPAID_CLAIM',
    name: 'Claim underpaid against contract',
    category: 'INSURANCE',
    description: 'The payer approved the claim but paid materially less than the approved amount.',
    defaultParams: { minVariance: 150, minVariancePct: 0.05, lookbackDays: 180 },
    paramDocs: {
      minVariance: 'Minimum absolute shortfall worth pursuing (SAR).',
      minVariancePct: 'Minimum shortfall as a fraction of the approved amount.',
      lookbackDays: 'How far back to scan settled claims.',
    },
    clinicalUrgency: 5,
    slaDays: 10,
    defaultOwnerRole: 'RCM_SPECIALIST',
    recommendedAction: 'Reconcile against the contract schedule and raise a payment variance query.',
  },
  {
    key: 'INS_PENDING_STALE',
    name: 'Claim pending beyond expected adjudication',
    category: 'INSURANCE',
    description:
      'A submitted claim has had no adjudication response well past the expected turnaround and is at risk of aging out of the filing window.',
    defaultParams: { staleDays: 45, minBilledAmount: 300 },
    paramDocs: {
      staleDays: 'Days without adjudication before chasing the payer.',
      minBilledAmount: 'Minimum billed amount worth chasing (SAR).',
    },
    clinicalUrgency: 5,
    slaDays: 7,
    defaultOwnerRole: 'RCM_SPECIALIST',
    recommendedAction: 'Chase the payer for adjudication and record the response.',
  },
  {
    key: 'INS_PATIENT_PATHWAY',
    name: 'Rejection needing a patient financial pathway',
    category: 'INSURANCE',
    description:
      'The claim cannot be recovered from the payer — the service is not covered or the appeal window has closed — so the patient needs financial counselling and, where clinically and legally appropriate, a self-pay option.',
    defaultParams: { minRejectedAmount: 300, requireContactable: true },
    paramDocs: {
      minRejectedAmount: 'Minimum rejected amount before involving the patient (SAR).',
      requireContactable: 'Only raise where the patient has consented to contact.',
    },
    clinicalUrgency: 20,
    slaDays: 7,
    defaultOwnerRole: 'RCM_SPECIALIST',
    recommendedAction:
      'Offer financial counselling and discuss the available payment options with the patient.',
  },

  // ── PATIENT REACTIVATION ──────────────────────────────────────────────
  {
    key: 'REACT_LAPSED_CHRONIC',
    name: 'Chronic-disease patient lapsed',
    category: 'REACTIVATION',
    description:
      'A patient with an active chronic diagnosis has had no encounter for longer than the expected care interval.',
    defaultParams: { inactiveDays: 270, minPotentialValue: 900 },
    paramDocs: {
      inactiveDays: 'Days without any encounter before a chronic patient counts as lapsed.',
      minPotentialValue: 'Estimated annual value of resumed chronic care (SAR).',
    },
    clinicalUrgency: 72,
    slaDays: 10,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Invite the patient back for chronic disease review.',
  },
  {
    key: 'REACT_HIGH_VALUE_LAPSED',
    name: 'High-value patient lapsed',
    category: 'REACTIVATION',
    description:
      'A patient with substantial historical billing has not attended for an extended period.',
    defaultParams: { inactiveDays: 365, minLifetimeValue: 12000 },
    paramDocs: {
      inactiveDays: 'Days without any encounter before flagging.',
      minLifetimeValue: 'Minimum historical gross charges to qualify (SAR).',
    },
    clinicalUrgency: 34,
    slaDays: 14,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Personal outreach; offer a health review appointment.',
  },
  {
    key: 'REACT_SPECIALIST_PATTERN',
    name: 'Established specialist pattern broken',
    category: 'REACTIVATION',
    description:
      'The patient attended one specialty on a regular cadence and has now gone well past their own typical interval.',
    defaultParams: { minVisits: 3, intervalMultiplier: 2.0, minPotentialValue: 700 },
    paramDocs: {
      minVisits: 'Visits to one specialty needed to establish a cadence.',
      intervalMultiplier: 'Multiple of the patient’s own median interval before flagging.',
      minPotentialValue: 'Estimated value of resumed specialist care (SAR).',
    },
    clinicalUrgency: 58,
    slaDays: 10,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Re-engage the patient with their established specialty team.',
  },
  {
    key: 'REACT_POST_SURGICAL',
    name: 'Post-surgical patient lost to follow-up',
    category: 'REACTIVATION',
    description:
      'A patient who underwent surgery has had no encounter since, so post-operative follow-up is unevidenced.',
    defaultParams: { inactiveDays: 120, lookbackDays: 730, minPotentialValue: 500 },
    paramDocs: {
      inactiveDays: 'Days after the procedure with no encounter before flagging.',
      lookbackDays: 'How far back to scan for procedures.',
      minPotentialValue: 'Estimated value of post-operative review (SAR).',
    },
    clinicalUrgency: 78,
    slaDays: 5,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Contact the patient for post-operative review.',
  },

  // ── APPOINTMENTS & TREATMENT GAPS ─────────────────────────────────────
  {
    key: 'APPT_NO_SHOW_NOT_REBOOKED',
    name: 'No-show never rebooked',
    category: 'APPOINTMENT',
    description:
      'The patient failed to attend a booked appointment and no replacement appointment has been made.',
    defaultParams: { rebookWindowDays: 14, lookbackDays: 180, minPotentialValue: 250 },
    paramDocs: {
      rebookWindowDays: 'Days after the missed appointment within which a rebooking is expected.',
      lookbackDays: 'How far back to scan appointments.',
      minPotentialValue: 'Estimated value of the missed appointment (SAR).',
    },
    clinicalUrgency: 52,
    slaDays: 5,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Call the patient and rebook the missed appointment.',
  },
  {
    key: 'APPT_REPEAT_CANCELLATION',
    name: 'Repeated cancellations',
    category: 'APPOINTMENT',
    description:
      'The patient has cancelled repeatedly without completing a visit, which usually signals an access barrier rather than disinterest.',
    defaultParams: { minCancellations: 2, windowDays: 180, minPotentialValue: 250 },
    paramDocs: {
      minCancellations: 'Cancellations needed within the window to flag.',
      windowDays: 'Window over which cancellations are counted.',
      minPotentialValue: 'Estimated value of the deferred care (SAR).',
    },
    clinicalUrgency: 56,
    slaDays: 7,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction:
      'Call the patient to identify the barrier to attendance and offer a suitable slot.',
  },
  {
    key: 'APPT_FOLLOWUP_INTERVAL_EXCEEDED',
    name: 'Physician follow-up interval exceeded',
    category: 'APPOINTMENT',
    description:
      'The physician documented a follow-up interval at the encounter and the patient has not returned within it.',
    defaultParams: { graceDays: 14, lookbackDays: 400, minPotentialValue: 280 },
    paramDocs: {
      graceDays: 'Days past the documented interval before flagging.',
      lookbackDays: 'How far back to scan encounters.',
      minPotentialValue: 'Estimated value of the follow-up consultation (SAR).',
    },
    clinicalUrgency: 70,
    slaDays: 5,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Book the physician-recommended follow-up appointment.',
  },
  {
    key: 'APPT_BOOKED_NEVER_COMPLETED',
    name: 'Appointment booked but never completed',
    category: 'APPOINTMENT',
    description:
      'An appointment date has passed while the booking is still open — neither completed nor formally cancelled.',
    defaultParams: { staleDays: 7, lookbackDays: 120, minPotentialValue: 250 },
    paramDocs: {
      staleDays: 'Days past the appointment date before flagging an unresolved booking.',
      lookbackDays: 'How far back to scan appointments.',
      minPotentialValue: 'Estimated value of the appointment (SAR).',
    },
    clinicalUrgency: 44,
    slaDays: 3,
    defaultOwnerRole: 'DEPARTMENT_MANAGER',
    recommendedAction: 'Reconcile the appointment outcome and rebook if the patient did not attend.',
  },

  // ── REFERRALS ─────────────────────────────────────────────────────────
  {
    key: 'REF_ISSUED_NOT_BOOKED',
    name: 'Referral issued but never booked',
    category: 'REFERRAL',
    description: 'A referral was issued and the patient has not booked the onward appointment.',
    defaultParams: { bookingWindowDays: 21, lookbackDays: 270 },
    paramDocs: {
      bookingWindowDays: 'Days after issue within which a booking is expected.',
      lookbackDays: 'How far back to scan referrals.',
    },
    clinicalUrgency: 60,
    slaDays: 5,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Contact the patient and book the referred specialty appointment.',
  },
  {
    key: 'REF_EXPIRED_UNFULFILLED',
    name: 'Referral expired unfulfilled',
    category: 'REFERRAL',
    description:
      'A referral reached its expiry date without an appointment, so the onward care never happened.',
    defaultParams: { lookbackDays: 365 },
    paramDocs: { lookbackDays: 'How far back to scan expired referrals.' },
    clinicalUrgency: 64,
    slaDays: 7,
    defaultOwnerRole: 'CARE_NAVIGATOR',
    recommendedAction: 'Re-issue the referral and book the appointment with the patient on the call.',
  },
  {
    key: 'REF_LEAKAGE',
    name: 'Referral fulfilled outside the group',
    category: 'REFERRAL',
    description:
      'A referral was completed by an external provider for a service the group offers at this hospital — retainable volume that left.',
    defaultParams: { lookbackDays: 270, minEstimatedValue: 400 },
    paramDocs: {
      lookbackDays: 'How far back to scan leaked referrals.',
      minEstimatedValue: 'Minimum value of the leaked service worth pursuing (SAR).',
    },
    clinicalUrgency: 30,
    slaDays: 14,
    defaultOwnerRole: 'DEPARTMENT_MANAGER',
    recommendedAction:
      'Review why the referral left the group and address the access or awareness gap.',
  },

  // ── SERVICE-LINE GROWTH (aggregate, not patient-level) ────────────────
  {
    key: 'SL_CAPACITY_UNDERUTILISED',
    name: 'Service line running below capacity',
    category: 'SERVICE_LINE',
    description:
      'A specialty is booking well below its contracted clinic capacity while demand exists elsewhere in the group.',
    defaultParams: { maxUtilisation: 0.62, minCapacitySlots: 120, months: 3 },
    paramDocs: {
      maxUtilisation: 'Booked/capacity ratio below which the line is flagged.',
      minCapacitySlots: 'Minimum capacity for the signal to be meaningful.',
      months: 'Trailing months aggregated.',
    },
    clinicalUrgency: 5,
    slaDays: 21,
    defaultOwnerRole: 'EXECUTIVE_DIRECTOR',
    recommendedAction:
      'Redirect demand into the underused clinic capacity and review scheduling templates.',
  },
  {
    key: 'SL_REFERRAL_LEAKAGE',
    name: 'Service-line referral leakage',
    category: 'SERVICE_LINE',
    description:
      'A high share of this specialty’s referrals is being fulfilled outside the group, indicating diagnostic or procedural leakage.',
    defaultParams: { maxRetentionRate: 0.7, minReferrals: 25, months: 3 },
    paramDocs: {
      maxRetentionRate: 'Retained/total referral ratio below which leakage is flagged.',
      minReferrals: 'Minimum referral volume for the signal to be meaningful.',
      months: 'Trailing months aggregated.',
    },
    clinicalUrgency: 5,
    slaDays: 21,
    defaultOwnerRole: 'EXECUTIVE_DIRECTOR',
    recommendedAction:
      'Investigate the leakage pathway and put an in-group booking route in place.',
  },
  {
    key: 'SL_HIGH_CANCELLATION',
    name: 'Service line with excessive cancellations',
    category: 'SERVICE_LINE',
    description:
      'Cancellations in this specialty exceed the acceptable rate, consuming capacity that could serve waiting patients.',
    defaultParams: { maxCancellationRate: 0.18, minEncounters: 30, months: 3 },
    paramDocs: {
      maxCancellationRate: 'Cancellation rate above which the line is flagged.',
      minEncounters:
        'Minimum encounter volume for the signal to be meaningful. Scale-dependent — raise it for high-volume groups, where a low floor makes small clinics look volatile.',
      months: 'Trailing months aggregated.',
    },
    clinicalUrgency: 5,
    slaDays: 21,
    defaultOwnerRole: 'EXECUTIVE_DIRECTOR',
    recommendedAction:
      'Review cancellation drivers with the department and tighten confirmation workflow.',
  },
]

export const RULE_BY_KEY: Record<string, RuleDefinition> = Object.fromEntries(
  RULE_CATALOGUE.map((r) => [r.key, r])
)
