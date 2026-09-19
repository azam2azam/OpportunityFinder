import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLES, ROLE_BY_KEY, can, canAccessHospital, hospitalFilter, visibleCategories,
  maskName, maskPhone, maskEmail, projectPatient, type Principal,
} from '../src/lib/rbac'

/**
 * Access control tests.
 *
 * The properties here are the ones that, if broken, would leak patient data
 * across hospitals or show identifiers to roles that should never see them.
 */

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1', email: 'user@test', name: 'Test User', title: 'Tester',
    roleKey: 'GENERAL_DIRECTOR', roleName: 'General Director', scopeLevel: 'HOSPITAL',
    permissions: ROLE_BY_KEY.GENERAL_DIRECTOR.permissions,
    primaryHospitalId: 'hosp1', hospitalIds: ['hosp1'], departmentScope: null,
    ...overrides,
  }
}

describe('hospital segregation', () => {
  test('a group principal is unrestricted', () => {
    const p = principal({ scopeLevel: 'GROUP', hospitalIds: [] })
    assert.deepEqual(hospitalFilter(p), {})
    assert.equal(canAccessHospital(p, 'anything'), true)
  })

  test('a hospital principal is restricted to their own hospitals', () => {
    const p = principal({ hospitalIds: ['hosp1', 'hosp2'] })
    assert.deepEqual(hospitalFilter(p), { hospitalId: { in: ['hosp1', 'hosp2'] } })
    assert.equal(canAccessHospital(p, 'hosp1'), true)
    assert.equal(canAccessHospital(p, 'hosp3'), false)
  })

  test('a principal with no scope sees nothing, not everything', () => {
    // Failing closed is the whole point: an empty `in` list matches no rows,
    // whereas an omitted filter would match every hospital in the group.
    const p = principal({ hospitalIds: [] })
    assert.deepEqual(hospitalFilter(p), { hospitalId: { in: [] } })
    assert.equal(canAccessHospital(p, 'hosp1'), false)
  })
})

describe('permissions', () => {
  test('null principals hold no permissions', () => {
    assert.equal(can(null, 'opportunity.view'), false)
  })

  test('the revenue-cycle role cannot read clinical opportunities', () => {
    const p = principal({
      roleKey: 'RCM_SPECIALIST',
      permissions: ROLE_BY_KEY.RCM_SPECIALIST.permissions,
    })
    assert.equal(can(p, 'opportunity.view.financial'), true)
    assert.equal(can(p, 'opportunity.view.clinical'), false)
  })

  test('the auditor is read-only', () => {
    const p = principal({ roleKey: 'AUDITOR', permissions: ROLE_BY_KEY.AUDITOR.permissions })
    assert.equal(can(p, 'audit.view'), true)
    assert.equal(can(p, 'opportunity.act'), false)
    assert.equal(can(p, 'opportunity.close'), false)
    assert.equal(can(p, 'rules.edit'), false)
  })

  test('the platform administrator configures but never sees patient identity', () => {
    const p = principal({ roleKey: 'PLATFORM_ADMIN', permissions: ROLE_BY_KEY.PLATFORM_ADMIN.permissions })
    assert.equal(can(p, 'rules.edit'), true)
    assert.equal(can(p, 'scoring.edit'), true)
    assert.equal(can(p, 'patient.view.phi'), false)
  })

  test('the data analyst sees SQL but never patient identity', () => {
    const p = principal({ roleKey: 'DATA_ANALYST', permissions: ROLE_BY_KEY.DATA_ANALYST.permissions })
    assert.equal(can(p, 'askdata.viewsql'), true)
    assert.equal(can(p, 'patient.view.phi'), false)
  })

  test('only group roles hold the group dashboard', () => {
    for (const role of ROLES) {
      if (role.permissions.includes('dashboard.group')) {
        assert.notEqual(
          role.scopeLevel,
          'DEPARTMENT',
          `${role.key} has the group dashboard but only departmental scope`
        )
      }
    }
  })

  test('every role grants at least one permission', () => {
    for (const role of ROLES) {
      assert.ok(role.permissions.length > 0, `${role.key} grants nothing`)
    }
  })

  test('closing an opportunity is never granted without acting on one', () => {
    for (const role of ROLES) {
      if (role.permissions.includes('opportunity.close')) {
        assert.ok(
          role.permissions.includes('opportunity.act'),
          `${role.key} can close opportunities but not act on them`
        )
      }
    }
  })
})

describe('visibleCategories', () => {
  test('the revenue-cycle role sees financial categories only', () => {
    const p = principal({ roleKey: 'RCM_SPECIALIST', permissions: ROLE_BY_KEY.RCM_SPECIALIST.permissions })
    const categories = visibleCategories(p)
    assert.ok(categories.includes('INSURANCE'))
    assert.ok(!categories.includes('LAB'))
    assert.ok(!categories.includes('SURGERY'))
  })

  test('the CMO sees clinical categories but not insurance', () => {
    const p = principal({ roleKey: 'GROUP_CMO', permissions: ROLE_BY_KEY.GROUP_CMO.permissions })
    const categories = visibleCategories(p)
    assert.ok(categories.includes('LAB'))
    assert.ok(categories.includes('SURGERY'))
    assert.ok(categories.includes('MEDICATION'))
    assert.ok(!categories.includes('INSURANCE'))
  })

  test('a director sees everything', () => {
    const p = principal()
    const categories = visibleCategories(p)
    for (const c of ['LAB', 'SURGERY', 'MEDICATION', 'INSURANCE', 'REACTIVATION', 'APPOINTMENT', 'REFERRAL', 'SERVICE_LINE']) {
      assert.ok(categories.includes(c), `director could not see ${c}`)
    }
  })

  test('returns no duplicates', () => {
    const categories = visibleCategories(principal())
    assert.equal(categories.length, new Set(categories).size)
  })
})

describe('PHI masking', () => {
  test('masks a name to initials', () => {
    const masked = maskName('Fatima Al-Harbi')
    assert.ok(!masked.includes('Fatima'))
    assert.ok(!masked.includes('Harbi'))
    assert.ok(masked.startsWith('F'))
  })

  test('masks a phone but keeps the last three digits for verification', () => {
    const masked = maskPhone('+966512345678')
    assert.ok(masked?.endsWith('678'))
    assert.ok(!masked?.includes('512345'))
  })

  test('masks an email local part but keeps the domain', () => {
    const masked = maskEmail('fatima.alharbi@example.sa')
    assert.ok(masked?.endsWith('@example.sa'))
    assert.ok(!masked?.includes('fatima'))
  })

  test('handles null contact details', () => {
    assert.equal(maskPhone(null), null)
    assert.equal(maskEmail(null), null)
  })

  test('projectPatient returns identity to a PHI-holding role', () => {
    const p = principal()
    const projected = projectPatient(p, {
      firstName: 'Fatima', lastName: 'Al-Harbi', mrn: 'RYD-100001',
      phone: '+966512345678', email: 'f@example.sa', nationalIdMasked: '1*******123',
    })
    assert.equal(projected.displayName, 'Fatima Al-Harbi')
    assert.equal(projected.mrn, 'RYD-100001')
    assert.equal(projected.phone, '+966512345678')
  })

  test('projectPatient masks everything for a role without PHI rights', () => {
    const p = principal({ roleKey: 'DATA_ANALYST', permissions: ROLE_BY_KEY.DATA_ANALYST.permissions })
    const projected = projectPatient(p, {
      firstName: 'Fatima', lastName: 'Al-Harbi', mrn: 'RYD-100001',
      phone: '+966512345678', email: 'f@example.sa', nationalIdMasked: '1*******123',
    })
    assert.ok(!projected.displayName.includes('Fatima'))
    assert.ok(!projected.firstName.includes('Fatima'))
    assert.ok(!projected.lastName.includes('Harbi'))
    // The MRN is a direct lookup key into VIDA, so it is truncated too.
    assert.ok(projected.mrn.length < 'RYD-100001'.length + 4)
    assert.ok(projected.mrn.includes('*'))
    assert.equal(projected.nationalIdMasked, '**********')
    assert.ok(!projected.phone?.includes('512345'))
  })
})
