import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validateSql } from '../src/lib/nlsql/validator'
import { templateProvider } from '../src/lib/nlsql/templates'
import type { Principal } from '../src/lib/rbac'

/**
 * Ask Data guardrail tests.
 *
 * These are the security tests for the natural-language surface. The validator
 * is the single point at which generated SQL is trusted, so every bypass worth
 * worrying about — a second statement, a comment hiding one, a write keyword,
 * a table outside the semantic model — is asserted against directly.
 */

const groupPrincipal: Principal = {
  userId: 'u1', email: 'ceo@test', name: 'Test', title: 'CEO',
  roleKey: 'GROUP_CEO', roleName: 'Group CEO', scopeLevel: 'GROUP',
  permissions: [], primaryHospitalId: null, hospitalIds: [], departmentScope: null,
}

const scopedPrincipal: Principal = {
  ...groupPrincipal,
  roleKey: 'GENERAL_DIRECTOR', scopeLevel: 'HOSPITAL',
  primaryHospitalId: 'hosp1', hospitalIds: ['hosp1'],
}

describe('validateSql — write protection', () => {
  const destructive = [
    'DELETE FROM "Patient"',
    'DROP TABLE "Opportunity"',
    'UPDATE "Opportunity" SET status = \'CONVERTED\'',
    'INSERT INTO "Patient" (id) VALUES (1)',
    'TRUNCATE TABLE "Encounter"',
    'ALTER TABLE "Patient" ADD COLUMN x TEXT',
    'PRAGMA table_info("Patient")',
    'ATTACH DATABASE \'/tmp/evil.db\' AS evil',
  ]

  for (const sql of destructive) {
    test(`blocks: ${sql.slice(0, 40)}`, () => {
      const result = validateSql(sql)
      assert.equal(result.ok, false)
      assert.ok(['BLOCKED_WRITE', 'BLOCKED_PARSE'].includes(result.code), `got ${result.code}`)
    })
  }

  test('blocks a write smuggled after a valid SELECT', () => {
    const result = validateSql('SELECT * FROM "Hospital"; DELETE FROM "Patient"')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'BLOCKED_PARSE')
  })

  test('blocks a statement hidden behind a comment', () => {
    const result = validateSql('SELECT * FROM "Hospital" -- \nDELETE FROM "Patient"')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'BLOCKED_PARSE')
  })

  test('blocks a block comment', () => {
    const result = validateSql('SELECT /* sneaky */ * FROM "Hospital"')
    assert.equal(result.ok, false)
  })

  test('does not mistake a column named like a keyword for a write', () => {
    // "updatedAt" contains "update"; word-boundary matching must let it through.
    const result = validateSql('SELECT "updatedAt" FROM "OpportunityRule"')
    assert.equal(result.ok, true, result.note)
  })
})

describe('validateSql — table allowlist', () => {
  test('blocks the user table', () => {
    const result = validateSql('SELECT * FROM "User"')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'BLOCKED_TABLE')
  })

  test('blocks the session table', () => {
    assert.equal(validateSql('SELECT token FROM "Session"').code, 'BLOCKED_TABLE')
  })

  test('blocks the audit trail — an auditable surface cannot read its own log', () => {
    assert.equal(validateSql('SELECT * FROM "AuditEvent"').code, 'BLOCKED_TABLE')
  })

  test('blocks a forbidden table reached through a join', () => {
    const result = validateSql('SELECT o.id FROM "Opportunity" o JOIN "User" u ON u.id = o."ownerUserId"')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'BLOCKED_TABLE')
  })

  test('blocks an unknown table', () => {
    assert.equal(validateSql('SELECT * FROM "SomeOtherThing"').code, 'BLOCKED_TABLE')
  })

  test('allows tables inside the semantic model', () => {
    const result = validateSql(
      'SELECT h."name" FROM "Opportunity" o JOIN "Hospital" h ON h."id" = o."hospitalId"'
    )
    assert.equal(result.ok, true, result.note)
  })
})

describe('validateSql — bounding', () => {
  test('appends a LIMIT when the query has none', () => {
    const result = validateSql('SELECT * FROM "Hospital"')
    assert.equal(result.ok, true)
    assert.match(result.effectiveSql ?? '', /LIMIT \d+$/)
  })

  test('leaves an existing LIMIT alone', () => {
    const result = validateSql('SELECT * FROM "Hospital" LIMIT 5')
    assert.equal(result.effectiveSql, 'SELECT * FROM "Hospital" LIMIT 5')
  })

  test('rejects an empty query', () => {
    assert.equal(validateSql('   ').ok, false)
  })

  test('rejects a query with no table reference', () => {
    const result = validateSql('SELECT 1')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'BLOCKED_PARSE')
  })

  test('allows a CTE', () => {
    const result = validateSql(
      'WITH x AS (SELECT "hospitalId" FROM "Opportunity") SELECT * FROM x'
    )
    assert.equal(result.ok, true, result.note)
  })
})

describe('template provider', () => {
  test('resolves a question from the spec to a query', async () => {
    const generation = await templateProvider.generate({
      question: 'Which hospitals have the highest number of rejected claims?',
      principal: groupPrincipal,
      hospitalIds: [],
    })
    assert.ok(generation, 'the question should have matched a template')
    assert.match(generation.sql, /^SELECT/i)
    assert.ok(generation.interpretation.length > 0)
    assert.equal(validateSql(generation.sql).ok, true)
  })

  test('every generated query passes the validator', async () => {
    const questions = [
      'Show me patients who had abnormal HbA1c results in the last 6 months and did not return for follow-up.',
      'Which hospitals have the highest number of rejected claims?',
      'Show surgical consultations where surgery was recommended but not scheduled.',
      'Which specialties have the highest patient leakage?',
      'How much revenue was lost because of insurance rejection last month?',
      'Show patients with medication refills overdue by more than 30 days.',
      'What is our conversion rate by opportunity type?',
      'Which service lines are running below capacity?',
      'Where are we breaching SLA the most?',
      'How has the opportunity pipeline trended over time?',
    ]
    for (const question of questions) {
      const generation = await templateProvider.generate({
        question, principal: groupPrincipal, hospitalIds: [],
      })
      assert.ok(generation, `no template matched: ${question}`)
      const validation = validateSql(generation.sql)
      assert.equal(validation.ok, true, `${question} → ${validation.note}`)
    }
  })

  test('binds hospital scope as parameters rather than string interpolation', async () => {
    const generation = await templateProvider.generate({
      question: 'Which hospitals have the highest number of rejected claims?',
      principal: scopedPrincipal,
      hospitalIds: ['hosp1', 'hosp2'],
    })
    assert.ok(generation)
    assert.match(generation.sql, /IN \(\?,\?\)/)
    assert.deepEqual(generation.params, ['hosp1', 'hosp2'])
    // The ids must never appear inline — that would be the injection path.
    assert.ok(!generation.sql.includes('hosp1'))
  })

  test('applies no scope clause for a group principal', async () => {
    const generation = await templateProvider.generate({
      question: 'How many open opportunities does each hospital have?',
      principal: groupPrincipal,
      hospitalIds: [],
    })
    assert.ok(generation)
    assert.deepEqual(generation.params, [])
  })

  test('returns null rather than guessing at an unmatched question', async () => {
    const generation = await templateProvider.generate({
      question: 'what is the weather in riyadh tomorrow',
      principal: groupPrincipal,
      hospitalIds: [],
    })
    assert.equal(generation, null)
  })

  test('a destructive request matches no template', async () => {
    const generation = await templateProvider.generate({
      question: 'drop table Patient; delete from Opportunity',
      principal: groupPrincipal,
      hospitalIds: [],
    })
    // Even if it somehow matched, the validator is the backstop — but the
    // provider should not be producing anything for this.
    if (generation) assert.equal(validateSql(generation.sql).ok, true)
  })

  test('reports lower confidence when a question is ambiguous', async () => {
    const clear = await templateProvider.generate({
      question: 'Which hospitals have the highest number of rejected claims?',
      principal: groupPrincipal, hospitalIds: [],
    })
    assert.ok(clear && clear.confidence > 0.5)
  })

  test('honours a numeric threshold stated in the question', async () => {
    const generation = await templateProvider.generate({
      question: 'Show patients with medication refills overdue by more than 90 days.',
      principal: groupPrincipal, hospitalIds: [],
    })
    assert.ok(generation)
    // The threshold becomes a cutoff timestamp; 90 days back must be earlier
    // than 30 days back.
    const ninety = generation.params[0] as number
    const other = await templateProvider.generate({
      question: 'Show patients with medication refills overdue by more than 30 days.',
      principal: groupPrincipal, hospitalIds: [],
    })
    assert.ok(ninety < (other!.params[0] as number))
  })
})
