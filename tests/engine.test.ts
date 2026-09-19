import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DETECTORS } from '../src/lib/detection/detectors'
import { RULE_CATALOGUE, RULE_BY_KEY } from '../src/lib/detection/rules'
import type { DetectionContext, PatientSnapshot } from '../src/lib/detection/context'
import type { RuleParams, RuleRuntime } from '../src/lib/detection/types'

/**
 * Detection engine tests.
 *
 * Detectors are pure functions over a snapshot, which is what makes this
 * possible: each rule is exercised against a hand-built patient whose history
 * is arranged to sit either side of the threshold. The assertions that matter
 * most are the negative ones — a rule that fires when it should not is worse
 * than one that misses, because it puts a patient in a queue for no reason.
 */

const DAY = 86_400_000
const NOW = new Date('2026-09-18T00:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY)

function runtimeFor(key: string, overrides: RuleParams = {}): RuleRuntime {
  const def = RULE_BY_KEY[key]
  assert.ok(def, `unknown rule ${key}`)
  return {
    id: `rule-${key}`,
    key,
    category: def.category,
    name: def.name,
    params: { ...def.defaultParams, ...overrides },
    clinicalUrgency: def.clinicalUrgency,
    slaDays: def.slaDays,
    defaultOwnerRole: def.defaultOwnerRole,
    recommendedAction: def.recommendedAction,
  }
}

function patient(overrides: Partial<PatientSnapshot> = {}): PatientSnapshot {
  return {
    id: 'p1', mrn: 'RYD-000001', firstName: 'Test', lastName: 'Patient',
    dateOfBirth: daysAgo(55 * 365), gender: 'F', hospitalId: 'h1',
    primaryPhysicianId: 'phys1', insuranceStatus: 'INSURED', payerId: 'pay1',
    payerResubmissionWindowDays: 60, contactable: true, consentMarketing: true,
    preferredChannel: 'SMS', phone: '+966500000000', distanceKm: 10,
    registeredAt: daysAgo(900), lastEncounterAt: daysAgo(60), isDeceased: false,
    vipFlag: false,
    encounters: [], appointments: [], labs: [], diagnoses: [], surgeries: [],
    prescriptions: [], pharmacyTxns: [], claims: [], referrals: [],
    engagement: 70, priorEncounters: 3, lifetimeValue: 5000, age: 55,
    ...overrides,
  }
}

function context(patients: PatientSnapshot[]): DetectionContext {
  return {
    asOf: NOW,
    patients,
    patientById: new Map(patients.map((p) => [p.id, p])),
    hospitalNames: new Map([['h1', 'Test Hospital']]),
    specialtyNames: new Map([['s1', 'Cardiology']]),
    specialtyLines: new Map([['s1', 'Cardiac Sciences']]),
    departmentNames: new Map([['d1', 'Outpatient']]),
    physicianNames: new Map([['phys1', 'Dr. Test']]),
    physicianDepartment: new Map([['phys1', 'd1']]),
    physicianSpecialty: new Map([['phys1', 's1']]),
    serviceLines: [],
    availability: new Map([['h1:s1', 50]]),
  }
}

function encounter(daysBack: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `enc-${daysBack}`, hospitalId: 'h1', departmentId: 'd1', specialtyId: 's1',
    physicianId: 'phys1', type: 'OUTPATIENT', startedAt: daysAgo(daysBack),
    status: 'COMPLETED', followUpRecommended: false, followUpDays: null,
    grossCharge: 500, noteSummary: null,
    ...overrides,
  }
}

function lab(daysBack: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `lab-${daysBack}`, loincCode: '4548-4', testName: 'Haemoglobin A1c',
    panel: 'Diabetes', value: 9.2, unit: '%', refLow: 4, refHigh: 5.7,
    flag: 'HIGH', resultedAt: daysAgo(daysBack), orderedAt: daysAgo(daysBack + 1),
    isPending: false, repeatIntervalDays: 90, encounterId: 'enc-60',
    ...overrides,
  }
}

describe('rule catalogue integrity', () => {
  test('every catalogued rule has a registered detector', () => {
    for (const rule of RULE_CATALOGUE) {
      assert.ok(DETECTORS[rule.key], `no detector for ${rule.key}`)
    }
  })

  test('every registered detector has a catalogue entry', () => {
    for (const key of Object.keys(DETECTORS)) {
      assert.ok(RULE_BY_KEY[key], `detector ${key} is not in the catalogue`)
    }
  })

  test('every parameter is documented', () => {
    for (const rule of RULE_CATALOGUE) {
      for (const param of Object.keys(rule.defaultParams)) {
        assert.ok(
          rule.paramDocs[param],
          `${rule.key}.${param} has no documentation — it would render as a bare field in the rule editor`
        )
      }
    }
  })

  test('rule keys are unique', () => {
    const keys = RULE_CATALOGUE.map((r) => r.key)
    assert.equal(keys.length, new Set(keys).size)
  })

  test('every rule has an SLA and a recommended action', () => {
    for (const rule of RULE_CATALOGUE) {
      assert.ok(rule.slaDays > 0, `${rule.key} has no SLA`)
      assert.ok(rule.recommendedAction.length > 10, `${rule.key} has no usable recommended action`)
    }
  })
})

describe('LAB_ABNORMAL_NO_FOLLOWUP', () => {
  const rule = runtimeFor('LAB_ABNORMAL_NO_FOLLOWUP')

  test('fires on an abnormal result with no encounter since', () => {
    const p = patient({ encounters: [encounter(60)], labs: [lab(59)] })
    const results = DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule)
    assert.equal(results.length, 1)
    assert.match(results[0].detectionReason, /Haemoglobin A1c/)
    assert.ok(results[0].evidence.labResultId)
  })

  test('does not fire when the patient came back', () => {
    const p = patient({ encounters: [encounter(60), encounter(20)], labs: [lab(59)] })
    assert.equal(DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule).length, 0)
  })

  test('does not fire inside the review window', () => {
    const p = patient({ encounters: [encounter(10)], labs: [lab(9)] })
    assert.equal(DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule).length, 0)
  })

  test('does not fire on a normal result', () => {
    const p = patient({ encounters: [encounter(60)], labs: [lab(59, { flag: 'NORMAL', value: 5.1 })] })
    assert.equal(DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule).length, 0)
  })

  test('raises one opportunity per test, not one per result in the same series', () => {
    const p = patient({
      encounters: [encounter(200)],
      labs: [lab(190), lab(150), lab(120)],
    })
    const results = DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule)
    assert.equal(results.length, 1, 'one clinical thread must produce one opportunity')
  })

  test('applies a CRITICAL floor to a critical result', () => {
    const p = patient({
      encounters: [encounter(60)],
      labs: [lab(59, { flag: 'CRITICAL_HIGH', value: 14 })],
    })
    const results = DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule)
    assert.equal(results[0].minimumPriority, 'CRITICAL')
  })

  test('honours a reconfigured window', () => {
    const p = patient({ encounters: [encounter(20)], labs: [lab(19)] })
    const strict = runtimeFor('LAB_ABNORMAL_NO_FOLLOWUP', { followUpWindowDays: 7 })
    assert.equal(DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), strict).length, 1)
    const relaxed = runtimeFor('LAB_ABNORMAL_NO_FOLLOWUP', { followUpWindowDays: 60 })
    assert.equal(DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), relaxed).length, 0)
  })

  test('skips patients who opted out of contact', () => {
    const p = patient({ contactable: false, encounters: [encounter(60)], labs: [lab(59)] })
    assert.equal(DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule).length, 0)
  })

  test('skips deceased patients', () => {
    const p = patient({ isDeceased: true, encounters: [encounter(60)], labs: [lab(59)] })
    assert.equal(DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule).length, 0)
  })
})

describe('LAB_RECURRING_LAPSED', () => {
  const rule = runtimeFor('LAB_RECURRING_LAPSED')

  test('fires for a chronic patient with an established repeat history', () => {
    const p = patient({
      encounters: [encounter(300)],
      diagnoses: [{ id: 'dx1', icd10: 'E11.9', description: 'Type 2 diabetes', isChronic: true, diagnosedAt: daysAgo(400), encounterId: 'enc-300' }],
      labs: [lab(400), lab(300)],
    })
    assert.equal(DETECTORS.LAB_RECURRING_LAPSED(context([p]), rule).length, 1)
  })

  test('does not fire on a single incidental result', () => {
    // One past result is an episode, not a monitoring cycle.
    const p = patient({
      encounters: [encounter(300)],
      diagnoses: [{ id: 'dx1', icd10: 'E11.9', description: 'Type 2 diabetes', isChronic: true, diagnosedAt: daysAgo(400), encounterId: 'enc-300' }],
      labs: [lab(300)],
    })
    assert.equal(DETECTORS.LAB_RECURRING_LAPSED(context([p]), rule).length, 0)
  })

  test('does not fire without clinical context for the monitoring', () => {
    const p = patient({ encounters: [encounter(300)], labs: [lab(400), lab(300)] })
    assert.equal(DETECTORS.LAB_RECURRING_LAPSED(context([p]), rule).length, 0)
  })

  test('hands very long lapses to the reactivation rules instead', () => {
    const p = patient({
      encounters: [encounter(1200)],
      diagnoses: [{ id: 'dx1', icd10: 'E11.9', description: 'Type 2 diabetes', isChronic: true, diagnosedAt: daysAgo(1300), encounterId: 'enc-1200' }],
      labs: [lab(1300), lab(1200)],
    })
    assert.equal(
      DETECTORS.LAB_RECURRING_LAPSED(context([p]), rule).length,
      0,
      'a patient gone for years is a reactivation case, not a lab recall'
    )
  })
})

describe('SURG_RECOMMENDED_NOT_SCHEDULED', () => {
  const rule = runtimeFor('SURG_RECOMMENDED_NOT_SCHEDULED')

  const surgery = (daysBack: number, overrides: Record<string, unknown> = {}) => ({
    id: 'surg1', hospitalId: 'h1', physicianId: 'phys1', cptCode: '27447',
    description: 'Total knee arthroplasty', status: 'RECOMMENDED',
    recommendedAt: daysAgo(daysBack), scheduledFor: null, performedAt: null,
    workupComplete: false, estimatedValue: 48000, urgency: 'ELECTIVE',
    cancelReason: null,
    ...overrides,
  })

  test('fires past the decision window', () => {
    const p = patient({ encounters: [encounter(90)], surgeries: [surgery(90)] })
    const results = DETECTORS.SURG_RECOMMENDED_NOT_SCHEDULED(context([p]), rule)
    assert.equal(results.length, 1)
    assert.equal(results[0].potentialValue, 48000)
  })

  test('does not fire inside the decision window', () => {
    const p = patient({ encounters: [encounter(10)], surgeries: [surgery(10)] })
    assert.equal(DETECTORS.SURG_RECOMMENDED_NOT_SCHEDULED(context([p]), rule).length, 0)
  })

  test('does not fire once a date is booked', () => {
    const p = patient({
      encounters: [encounter(90)],
      surgeries: [surgery(90, { scheduledFor: daysAgo(-10) })],
    })
    assert.equal(DETECTORS.SURG_RECOMMENDED_NOT_SCHEDULED(context([p]), rule).length, 0)
  })

  test('escalates an urgent procedure', () => {
    const p = patient({ encounters: [encounter(90)], surgeries: [surgery(90, { urgency: 'URGENT' })] })
    const results = DETECTORS.SURG_RECOMMENDED_NOT_SCHEDULED(context([p]), rule)
    assert.equal(results[0].minimumPriority, 'HIGH')
  })
})

describe('MED_REFILL_OVERDUE and MED_REFILL_ABANDONED', () => {
  const overdueRule = runtimeFor('MED_REFILL_OVERDUE')
  const abandonedRule = runtimeFor('MED_REFILL_ABANDONED')

  const prescription = (overrides: Record<string, unknown> = {}) => ({
    id: 'rx1', physicianId: 'phys1', medicationId: 'med1', medicationName: 'Metformin',
    isChronic: true, requiresMonitoring: false, monitoringLoinc: null, isHighRisk: false,
    unitPrice: 0.45, dosage: '1 tablet twice daily', daysSupply: 30,
    refillsAuthorized: 6, refillsUsed: 3, prescribedAt: daysAgo(200),
    courseEndsAt: null, status: 'ACTIVE',
    ...overrides,
  })

  const dispense = (daysBack: number) => ({
    id: `ph-${daysBack}`, medicationId: 'med1', medicationName: 'Metformin',
    prescriptionId: 'rx1', dispensedAt: daysAgo(daysBack), daysSupply: 30,
    amount: 13.5, isRefill: true,
  })

  test('overdue fires when the supply has run out past the grace period', () => {
    const p = patient({
      encounters: [encounter(40)],
      prescriptions: [prescription()],
      pharmacyTxns: [dispense(55)],
    })
    assert.equal(DETECTORS.MED_REFILL_OVERDUE(context([p]), overdueRule).length, 1)
  })

  test('overdue does not fire while supply remains', () => {
    const p = patient({
      encounters: [encounter(40)],
      prescriptions: [prescription()],
      pharmacyTxns: [dispense(10)],
    })
    assert.equal(DETECTORS.MED_REFILL_OVERDUE(context([p]), overdueRule).length, 0)
  })

  test('overdue defers to abandonment past the 90-day mark', () => {
    // The two rules must not both claim the same patient and medication.
    const p = patient({
      encounters: [encounter(120)],
      prescriptions: [prescription()],
      pharmacyTxns: [dispense(150), dispense(120), dispense(90)].concat([dispense(120)]).slice(0, 3),
    })
    const overdue = DETECTORS.MED_REFILL_OVERDUE(context([p]), overdueRule)
    assert.equal(overdue.length, 0, 'a 90-day gap belongs to the abandonment rule')
  })

  test('abandonment fires on a broken cadence', () => {
    const p = patient({
      encounters: [encounter(200)],
      prescriptions: [prescription()],
      pharmacyTxns: [dispense(280), dispense(250), dispense(220), dispense(190)],
    })
    const results = DETECTORS.MED_REFILL_ABANDONED(context([p]), abandonedRule)
    assert.equal(results.length, 1)
    assert.ok(
      Number(results[0].evidence.medianIntervalDays) === 30,
      `expected a 30-day cadence, got ${results[0].evidence.medianIntervalDays}`
    )
  })

  test('abandonment needs an established cadence first', () => {
    const p = patient({
      encounters: [encounter(200)],
      prescriptions: [prescription()],
      pharmacyTxns: [dispense(190)],
    })
    assert.equal(DETECTORS.MED_REFILL_ABANDONED(context([p]), abandonedRule).length, 0)
  })
})

describe('INS_REJECTION_RECOVERABLE', () => {
  const rule = runtimeFor('INS_REJECTION_RECOVERABLE')

  const claim = (overrides: Record<string, unknown> = {}, rejectionOverrides: Record<string, unknown> = {}) => ({
    id: 'clm1', claimNumber: 'RYD-CLM-0000001', hospitalId: 'h1', payerId: 'pay1',
    payerName: 'Bupa Arabia', resubmissionWindowDays: 60, serviceDate: daysAgo(40),
    submittedAt: daysAgo(38), status: 'REJECTED', billedAmount: 2400,
    approvedAmount: 0, paidAmount: 0, serviceCode: '99214',
    serviceDescription: 'Outpatient consultation', departmentName: 'Outpatient',
    resubmissionCount: 0,
    rejections: [
      {
        id: 'rej1', reasonCode: 'CODING', reasonText: 'Procedure code inconsistent with diagnosis',
        rejectedAmount: 2400, rejectedAt: daysAgo(30), isAppealable: true,
        recommendedPathway: 'CORRECT_CODING', historicalRecoveryRate: 0.72,
        responsibleDepartment: 'Health Information Management',
        ...rejectionOverrides,
      },
    ],
    ...overrides,
  })

  test('fires inside the payer window with a defined pathway', () => {
    const p = patient({ claims: [claim()] })
    const results = DETECTORS.INS_REJECTION_RECOVERABLE(context([p]), rule)
    assert.equal(results.length, 1)
    // Recoverable value is the rejected amount weighted by the recovery rate,
    // not the whole rejected amount.
    assert.ok(results[0].potentialValue < 2400)
    assert.equal(Math.round(results[0].potentialValue), Math.round(2400 * 0.72))
    assert.equal(results[0].evidence.responsibleDepartment, 'Health Information Management')
  })

  test('does not fire once the window has closed', () => {
    const p = patient({ claims: [claim({}, { rejectedAt: daysAgo(90) })] })
    assert.equal(DETECTORS.INS_REJECTION_RECOVERABLE(context([p]), rule).length, 0)
  })

  test('does not fire on a non-appealable rejection', () => {
    const p = patient({ claims: [claim({}, { isAppealable: false })] })
    assert.equal(DETECTORS.INS_REJECTION_RECOVERABLE(context([p]), rule).length, 0)
  })

  test('escalates when the window is nearly closed', () => {
    const p = patient({ claims: [claim({}, { rejectedAt: daysAgo(55) })] })
    const results = DETECTORS.INS_REJECTION_RECOVERABLE(context([p]), rule)
    assert.equal(results[0].minimumPriority, 'HIGH')
  })

  test('respects the minimum amount threshold', () => {
    const p = patient({ claims: [claim({ billedAmount: 50 }, { rejectedAmount: 50 })] })
    assert.equal(DETECTORS.INS_REJECTION_RECOVERABLE(context([p]), rule).length, 0)
  })
})

describe('INS_PATIENT_PATHWAY', () => {
  const rule = runtimeFor('INS_PATIENT_PATHWAY')

  test('only fires once the payer route is genuinely closed', () => {
    const appealable = patient({
      claims: [
        {
          id: 'c1', claimNumber: 'N1', hospitalId: 'h1', payerId: 'pay1', payerName: 'Bupa',
          resubmissionWindowDays: 60, serviceDate: daysAgo(40), submittedAt: daysAgo(38),
          status: 'REJECTED', billedAmount: 3000, approvedAmount: 0, paidAmount: 0,
          serviceCode: '99214', serviceDescription: 'Consultation', departmentName: 'OPD',
          resubmissionCount: 0,
          rejections: [{
            id: 'r1', reasonCode: 'CODING', reasonText: 'Coding error', rejectedAmount: 3000,
            rejectedAt: daysAgo(30), isAppealable: true, recommendedPathway: 'CORRECT_CODING',
            historicalRecoveryRate: 0.7, responsibleDepartment: 'HIM',
          }],
        },
      ],
    })
    assert.equal(
      DETECTORS.INS_PATIENT_PATHWAY(context([appealable]), rule).length,
      0,
      'the insurer must be exhausted before the patient is asked to pay'
    )

    const closed = patient({
      claims: [
        {
          ...appealable.claims[0],
          rejections: [{
            ...appealable.claims[0].rejections[0],
            reasonCode: 'SERVICE_NOT_COVERED', isAppealable: false,
            recommendedPathway: 'PATIENT_RESPONSIBILITY',
          }],
        },
      ],
    })
    const results = DETECTORS.INS_PATIENT_PATHWAY(context([closed]), rule)
    assert.equal(results.length, 1)
    assert.match(
      String(results[0].evidence.complianceNote),
      /eligibility/i,
      'the self-pay pathway must carry its compliance caveat'
    )
  })
})

describe('APPT_FOLLOWUP_INTERVAL_EXCEEDED', () => {
  const rule = runtimeFor('APPT_FOLLOWUP_INTERVAL_EXCEEDED')

  test('fires when a documented interval has passed with no return', () => {
    const p = patient({
      encounters: [encounter(120, { followUpRecommended: true, followUpDays: 60 })],
    })
    const results = DETECTORS.APPT_FOLLOWUP_INTERVAL_EXCEEDED(context([p]), rule)
    assert.equal(results.length, 1)
    assert.equal(results[0].evidence.documentedFollowUpDays, 60)
  })

  test('does not fire inside the interval plus grace', () => {
    const p = patient({
      encounters: [encounter(60, { followUpRecommended: true, followUpDays: 90 })],
    })
    assert.equal(DETECTORS.APPT_FOLLOWUP_INTERVAL_EXCEEDED(context([p]), rule).length, 0)
  })

  test('does not fire when the patient returned', () => {
    const p = patient({
      encounters: [
        encounter(120, { followUpRecommended: true, followUpDays: 60 }),
        encounter(30),
      ],
    })
    assert.equal(DETECTORS.APPT_FOLLOWUP_INTERVAL_EXCEEDED(context([p]), rule).length, 0)
  })
})

describe('dedupe keys', () => {
  test('are stable across runs for the same evidence', () => {
    const p = patient({ encounters: [encounter(60)], labs: [lab(59)] })
    const rule = runtimeFor('LAB_ABNORMAL_NO_FOLLOWUP')
    const first = DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule)
    const second = DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), rule)
    assert.equal(first[0].dedupeKey, second[0].dedupeKey)
    assert.ok(first[0].dedupeKey.startsWith('LAB_ABNORMAL_NO_FOLLOWUP:'))
  })

  test('differ between rules for the same source record', () => {
    const p = patient({
      encounters: [encounter(60)],
      labs: [lab(59, { flag: 'CRITICAL_HIGH', value: 14 })],
    })
    const abnormal = DETECTORS.LAB_ABNORMAL_NO_FOLLOWUP(context([p]), runtimeFor('LAB_ABNORMAL_NO_FOLLOWUP'))
    const critical = DETECTORS.LAB_CRITICAL_UNACTIONED(context([p]), runtimeFor('LAB_CRITICAL_UNACTIONED'))
    assert.notEqual(abnormal[0].dedupeKey, critical[0].dedupeKey)
  })
})

describe('candidate completeness', () => {
  test('every candidate carries a reason, an action and evidence', () => {
    const p = patient({
      encounters: [encounter(120, { followUpRecommended: true, followUpDays: 60 })],
      labs: [lab(119)],
      surgeries: [{
        id: 'surg1', hospitalId: 'h1', physicianId: 'phys1', cptCode: '27447',
        description: 'Total knee arthroplasty', status: 'RECOMMENDED',
        recommendedAt: daysAgo(120), scheduledFor: null, performedAt: null,
        workupComplete: false, estimatedValue: 48000, urgency: 'ELECTIVE', cancelReason: null,
      }],
    })
    const ctx = context([p])

    for (const key of ['LAB_ABNORMAL_NO_FOLLOWUP', 'APPT_FOLLOWUP_INTERVAL_EXCEEDED', 'SURG_RECOMMENDED_NOT_SCHEDULED']) {
      for (const candidate of DETECTORS[key](ctx, runtimeFor(key))) {
        assert.ok(candidate.detectionReason.length > 40, `${key}: reason too short to be useful`)
        assert.ok(candidate.recommendedAction.length > 10, `${key}: no recommended action`)
        assert.ok(Object.keys(candidate.evidence).length > 0, `${key}: no evidence recorded`)
        assert.ok(candidate.hospitalId, `${key}: no hospital, so it cannot be scoped`)
        assert.ok(
          candidate.confidence > 0 && candidate.confidence <= 1,
          `${key}: confidence out of range`
        )
      }
    }
  })
})
