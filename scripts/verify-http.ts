/**
 * End-to-end verification over HTTP against the running dev server.
 *
 * The browser automation available in this environment does not reliably drive
 * a Next dev server, so verification is done by signing in as each persona and
 * fetching every route, asserting on status codes and rendered markup. That
 * catches the failures that matter — a page that throws, a permission check
 * that lets the wrong role in, PHI rendered to someone who should see a mask —
 * without depending on a browser.
 *
 * Usage: npm run verify:http  (with the dev server already running)
 */

// Imported so the documentation assertions compare against the real catalogues
// rather than against numbers typed into this file, which would drift too.
import { NAVIGATION } from '../src/lib/navigation'
import { RULE_CATALOGUE } from '../src/lib/detection/rules'
import { DOMAINS } from '../src/lib/ingestion/domains'
import { ROLES } from '../src/lib/rbac'

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3300'
const PASSWORD = 'Demo!Pass123'

interface Check {
  name: string
  ok: boolean
  detail?: string
}

const results: Check[] = []
let currentGroup = ''

function group(name: string) {
  currentGroup = name
  console.log(`\n${name}`)
}

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name: `${currentGroup} › ${name}`, ok, detail })
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
  console.log(`  ${mark} ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`)
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/opportuna_session=([^;]+)/)
  if (!match) throw new Error(`no session cookie returned for ${email}`)
  return `opportuna_session=${match[1]}`
}

async function get(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie },
    redirect: 'manual',
  })
  const body = res.status === 200 ? await res.text() : ''
  return { status: res.status, body, location: res.headers.get('location') }
}

/** Strips tags so text assertions are not fooled by attribute values. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
}

async function main() {
  console.log(`Verifying Opportuna at ${BASE}\n${'─'.repeat(60)}`)

  // ── authentication ────────────────────────────────────────────────────
  group('Authentication')

  const anon = await get('/', '')
  check(
    'anonymous request to the dashboard redirects to sign-in',
    anon.status === 307 || anon.status === 302,
    `got ${anon.status}`
  )
  check('redirect target is /login', (anon.location ?? '').includes('/login'), anon.location ?? 'none')

  const badLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ceo@opportuna.health', password: 'wrong-password' }),
  })
  check('wrong password is rejected', badLogin.status === 401, `got ${badLogin.status}`)
  const badBody = await badLogin.json().catch(() => ({}) as { error?: string })
  check(
    'failure message does not reveal whether the account exists',
    (badBody.error ?? '').toLowerCase().includes('invalid email or password'),
    badBody.error
  )

  const unknownUser = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@opportuna.health', password: PASSWORD }),
  })
  const unknownBody = await unknownUser.json().catch(() => ({}) as { error?: string })
  check(
    'unknown account returns the identical message',
    unknownUser.status === 401 && unknownBody.error === badBody.error,
    `${unknownUser.status} / ${unknownBody.error}`
  )

  const ceo = await login('ceo@opportuna.health')
  check('group CEO can sign in', ceo.length > 0)

  // ── routes render for the group executive ─────────────────────────────
  group('Page rendering (Group CEO)')

  const ceoRoutes = [
    '/', '/opportunities', '/patients', '/revenue', '/clinical', '/service-lines',
    '/insurance', '/reactivation', '/follow-up', '/campaigns', '/analytics',
    '/ask', '/hospitals', '/departments', '/physicians', '/rules',
  ]
  for (const route of ceoRoutes) {
    const res = await get(route, ceo)
    check(`GET ${route}`, res.status === 200, `status ${res.status}`)
  }

  const dashboard = await get('/', ceo)
  const dashText = visibleText(dashboard.body)
  check(
    'dashboard shows the executive question',
    dashText.includes('Where are our biggest opportunities today'),
    'question heading missing'
  )
  check(
    'dashboard renders KPI tiles',
    dashText.includes('Total active opportunities') && dashText.includes('Conversion rate'),
    'KPI labels missing'
  )
  check(
    'dashboard renders the conversion funnel',
    dashText.includes('Opportunity conversion funnel'),
    'funnel section missing'
  )
  check(
    'dashboard shows a non-zero opportunity count',
    /Total active opportunities\s+[1-9]/.test(dashText),
    'pipeline appears empty — has detection been run?'
  )

  // ── role-based access control ─────────────────────────────────────────
  group('Role-based access control')

  const rcm = await login('rcm@opportuna.health')
  const rcmClinical = await get('/clinical', rcm)
  check(
    'revenue-cycle specialist is denied the clinical module',
    rcmClinical.status === 403 || rcmClinical.status === 307,
    `status ${rcmClinical.status}`
  )
  const rcmInsurance = await get('/insurance', rcm)
  check('revenue-cycle specialist can open insurance recovery', rcmInsurance.status === 200, `status ${rcmInsurance.status}`)

  const analyst = await login('analyst@opportuna.health')
  const analystAudit = await get('/audit', analyst)
  check(
    'data analyst is denied the audit trail',
    analystAudit.status === 403 || analystAudit.status === 307,
    `status ${analystAudit.status}`
  )
  const auditor = await login('auditor@opportuna.health')
  const auditorAudit = await get('/audit', auditor)
  check('compliance auditor can open the audit trail', auditorAudit.status === 200, `status ${auditorAudit.status}`)

  const navigator = await login('navigator@opportuna.health')
  const navAdmin = await get('/admin', navigator)
  check(
    'care navigator is denied administration',
    navAdmin.status === 403 || navAdmin.status === 307,
    `status ${navAdmin.status}`
  )

  // ── hospital data segregation ─────────────────────────────────────────
  group('Hospital data segregation')

  const gdJeddah = await login('gd.jeddah@opportuna.health')
  const jeddahList = await get('/opportunities?lifecycle=open', gdJeddah)
  const jeddahText = visibleText(jeddahList.body)
  check('Jeddah director sees their own hospital', jeddahText.includes('Jeddah'), 'no Jeddah rows rendered')
  check(
    'Jeddah director sees no Riyadh Central rows',
    !jeddahText.includes('Riyadh Central Hospital'),
    'another hospital leaked into the scoped list'
  )

  // ── PHI masking ───────────────────────────────────────────────────────
  group('PHI minimisation')

  const analystList = await get('/opportunities?lifecycle=open', analyst)
  const analystText = visibleText(analystList.body)
  check(
    'analyst without PHI rights sees masked names',
    analystText.includes('***'),
    'no masked identifiers found in the analyst view'
  )

  const gdRiyadh = await login('gd.riyadh@opportuna.health')
  const gdList = await get('/opportunities?lifecycle=open', gdRiyadh)
  const gdText = visibleText(gdList.body)
  check(
    'director with PHI rights sees unmasked names',
    /Al-(Harbi|Qahtani|Otaibi|Ghamdi|Zahrani|Shehri|Dossari|Mutairi|Subaie|Anazi|Rashidi|Amri|Balawi|Juhani|Sulami|Maliki|Faraj|Nasser|Hakim|Saleh)/.test(gdText),
    'expected at least one full patient name'
  )

  // ── opportunity detail ────────────────────────────────────────────────
  group('Opportunity detail and explainability')

  const refMatch = gdList.body.match(/\/opportunities\/([a-z0-9]{20,})/)
  if (!refMatch) {
    check('found an opportunity to open', false, 'no opportunity link in the list page')
  } else {
    const detail = await get(`/opportunities/${refMatch[1]}`, gdRiyadh)
    check(`GET /opportunities/${refMatch[1].slice(0, 8)}…`, detail.status === 200, `status ${detail.status}`)
    const detailText = visibleText(detail.body)
    check('detail explains why it was detected', detailText.includes('Why this was detected'), 'detection rationale missing')
    check('detail shows the score breakdown', detailText.includes('Score breakdown'), 'score breakdown missing')
    check('detail shows the recommended action', detailText.includes('Recommended action'), 'recommended action missing')
    check('detail shows the patient timeline', detailText.includes('Patient timeline'), 'timeline missing')
    check(
      'detail names the contributing factors',
      detailText.includes('Clinical urgency') && detailText.includes('Conversion probability'),
      'scoring factors not listed'
    )
  }

  // ── Ask Data ──────────────────────────────────────────────────────────
  group('Ask Data (natural language to SQL)')

  const askPage = await get('/ask', ceo)
  check('GET /ask', askPage.status === 200, `status ${askPage.status}`)

  const askOk = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: ceo },
    body: JSON.stringify({ question: 'Which hospitals have the highest number of rejected claims?' }),
  })
  const askData = await askOk.json()
  check('a supported question returns rows', askOk.status === 200 && askData.rowCount > 0, JSON.stringify(askData).slice(0, 200))
  check('the answer carries an explanation', Boolean(askData.explanation), 'no explanation returned')
  check('the answer suggests a visualisation', Boolean(askData.visualization), 'no visualisation returned')

  const askSqlHidden = askData.sql == null
  check('CEO does not receive the generated SQL', askSqlHidden, 'SQL exposed to a non-technical role')

  const analystAsk = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: analyst },
    body: JSON.stringify({ question: 'Which hospitals have the highest number of rejected claims?' }),
  })
  const analystAskData = await analystAsk.json()
  check('analyst with SQL rights does receive the SQL', typeof analystAskData.sql === 'string', 'SQL withheld from an authorised role')

  const askInjection = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: analyst },
    body: JSON.stringify({ question: 'drop table Patient; delete from Opportunity' }),
  })
  const injectionData = await askInjection.json()
  check(
    'a destructive request is blocked, not executed',
    injectionData.validation !== 'PASSED',
    `validation was ${injectionData.validation}`
  )

  // ── workflow actions ──────────────────────────────────────────────────
  group('Opportunity workflow')

  if (refMatch) {
    const before = await get(`/opportunities/${refMatch[1]}`, gdRiyadh)
    const wasOpen = before.status === 200

    const act = await fetch(`${BASE}/api/opportunities/${refMatch[1]}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: gdRiyadh },
      body: JSON.stringify({ type: 'NOTE', note: 'Verification note from the automated check.' }),
    })
    check('an authorised user can log an action', wasOpen && act.status === 200, `status ${act.status}`)

    const denied = await fetch(`${BASE}/api/opportunities/${refMatch[1]}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: auditor },
      body: JSON.stringify({ type: 'NOTE', note: 'Auditor should not be able to write.' }),
    })
    check('a read-only role cannot log an action', denied.status === 403, `status ${denied.status}`)
  }

  // ── data ingestion ────────────────────────────────────────────────────
  group('Data ingestion and integration')

  const admin = await login('admin@opportuna.health')

  for (const route of [
    '/integration', '/integration/sources', '/integration/pipelines',
    '/integration/mapping', '/integration/upload', '/integration/quality',
  ]) {
    const res = await get(route, admin)
    check(`GET ${route}`, res.status === 200, `status ${res.status}`)
  }

  const overview = await get('/integration', admin)
  const overviewText = visibleText(overview.body)
  check(
    'overview renders the architecture diagram',
    overview.body.includes('Integration architecture'),
    'diagram aria-label missing'
  )
  check(
    'overview names what depends on each feed',
    overviewText.includes('What depends on each feed'),
    'dependency table missing'
  )

  const mapping = await get('/integration/mapping?domain=CLAIM', admin)
  const mappingText = visibleText(mapping.body)
  check(
    'field mapping lists the claim feed contract',
    mappingText.includes('rejection_reason_code') && mappingText.includes('claim_number'),
    'expected claim feed columns'
  )

  const template = await fetch(`${BASE}/api/integration/template/PATIENT`, { headers: { cookie: admin } })
  const templateBody = await template.text()
  check('CSV template downloads', template.status === 200, `status ${template.status}`)
  check(
    'template header matches the feed contract',
    templateBody.startsWith('mrn,source_id,first_name,last_name,date_of_birth,gender'),
    templateBody.slice(0, 80)
  )
  check(
    'template includes a worked example row',
    templateBody.split('\r\n').length >= 2,
    'header only — an integrator has to guess the formats'
  )

  // The ingestion path, end to end, against the manual patient pipeline.
  const pipelineRes = await get('/integration/upload?domain=PATIENT', admin)
  // The RSC payload escapes its quotes (pipelineId\":\"...), so the pattern has
  // to tolerate both the escaped and plain forms. The first match is the
  // patient feed — the options are rendered in domain order.
  const pipelineMatch = pipelineRes.body.match(/pipelineId\\?":\\?"([a-z0-9]{20,})\\?"/)
  if (!pipelineMatch) {
    check('found the manual patient pipeline', false, 'no pipelineId in the upload page')
  } else {
    const pipelineId = pipelineMatch[1]
    const header =
      'mrn,source_id,first_name,last_name,date_of_birth,gender,city,hospital_code,registered_at'
    const good = `VERIFY-0001,VERIFY-EXT-1,Verify,Patient,1980-01-01,F,Riyadh,RYD,2024-01-01T00:00:00Z`
    const badDate = `VERIFY-0002,VERIFY-EXT-2,Verify,Patient,01/02/1980,F,Riyadh,RYD,2024-01-01T00:00:00Z`
    const badRef = `VERIFY-0003,VERIFY-EXT-3,Verify,Patient,1980-01-01,F,Riyadh,NOPE,2024-01-01T00:00:00Z`

    const upload = async (csv: string, dryRun: boolean) => {
      const res = await fetch(`${BASE}/api/integration/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: admin },
        body: JSON.stringify({ pipelineId, fileName: 'verify.csv', csv, dryRun }),
      })
      return { status: res.status, body: await res.json() }
    }

    const dry = await upload([header, good, badDate, badRef].join('\r\n'), true)
    check('dry run validates without writing', dry.status === 200 && dry.body.dryRun === true, `status ${dry.status}`)
    check(
      'dry run accepts the valid row and rejects the invalid ones',
      dry.body.load?.recordsRead === 3 && dry.body.load?.recordsRejected === 2,
      JSON.stringify(dry.body.load ?? {}).slice(0, 160)
    )
    const codes: string[] = (dry.body.load?.issues ?? []).map((i: { code: string }) => i.code)
    check('an ambiguous date is rejected, not guessed', codes.includes('INVALID_DATE'), codes.join(', '))
    check('an unknown business code is rejected', codes.includes('UNRESOLVED_REFERENCE'), codes.join(', '))
    const dateIssue = (dry.body.load?.issues ?? []).find((i: { code: string }) => i.code === 'INVALID_DATE')
    check(
      'each rejection names the row, field and offending value',
      Boolean(dateIssue?.rowNumber && dateIssue?.field && dateIssue?.rawValue),
      JSON.stringify(dateIssue ?? {})
    )

    // The dry run must genuinely not have written anything.
    const afterDry = await upload([header, good].join('\r\n'), true)
    check(
      'dry run wrote nothing — the row still reads as an insert',
      afterDry.body.load?.recordsInserted === 1 && afterDry.body.load?.recordsUpdated === 0,
      JSON.stringify(afterDry.body.load ?? {}).slice(0, 120)
    )

    const commit = await upload([header, good].join('\r\n'), false)
    check(
      'commit inserts the row',
      commit.status === 200 && commit.body.load?.recordsInserted === 1,
      JSON.stringify(commit.body.load ?? {}).slice(0, 120)
    )

    const replay = await upload([header, good].join('\r\n'), false)
    check(
      'replaying the same file updates rather than duplicating',
      replay.body.load?.recordsInserted === 0 && replay.body.load?.recordsUpdated === 1,
      JSON.stringify(replay.body.load ?? {}).slice(0, 120)
    )

    const missingColumn = await upload('mrn,first_name\nVERIFY-0004,Verify', true)
    check(
      'a file missing a required column is refused as a whole',
      (missingColumn.body.load?.issues ?? []).some(
        (i: { code: string }) => i.code === 'MISSING_REQUIRED_COLUMN'
      ),
      JSON.stringify(missingColumn.body.load?.issues ?? []).slice(0, 160)
    )

    const denied = await fetch(`${BASE}/api/integration/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: navigator },
      body: JSON.stringify({ pipelineId, fileName: 'x.csv', csv: header, dryRun: true }),
    })
    check('a role without integration.ingest cannot upload', denied.status === 403, `status ${denied.status}`)
  }

  // ── data lineage ──────────────────────────────────────────────────────
  group('Data lineage')

  const lineagePage = await get('/integration/lineage', admin)
  check('GET /integration/lineage', lineagePage.status === 200, `status ${lineagePage.status}`)
  const lineageText = visibleText(lineagePage.body)
  check(
    'lineage map shows both directions',
    lineageText.includes('Source application') && lineageText.includes('Page'),
    'expected application-to-page and page-to-application views'
  )

  // The provenance bar is the connection between the source systems and every
  // other screen. If it silently stopped rendering, no page would look broken —
  // which is exactly why it is asserted on rather than eyeballed.
  const provenanceRoutes = [
    '/', '/opportunities', '/queue', '/patients', '/revenue', '/clinical',
    '/service-lines', '/insurance', '/reactivation', '/follow-up', '/campaigns',
    '/analytics', '/ask', '/hospitals', '/departments', '/physicians',
  ]
  const missingProvenance: string[] = []
  for (const route of provenanceRoutes) {
    const res = await get(route, gdRiyadh)
    if (res.status !== 200 || !visibleText(res.body).includes('Data source')) {
      missingProvenance.push(`${route} (${res.status})`)
    }
  }
  check(
    `provenance bar renders on all ${provenanceRoutes.length} data-bearing pages`,
    missingProvenance.length === 0,
    missingProvenance.join(', ')
  )

  const clinicalPage = await get('/clinical', gdRiyadh)
  const clinicalText = visibleText(clinicalPage.body)
  check(
    'provenance names the source application feeding the page',
    clinicalText.includes('VIDA') || clinicalText.includes('Pharmacy'),
    'no source system named on the clinical page'
  )

  const adminPage = await get('/admin', admin)
  check(
    'configuration-only pages say so rather than showing an empty bar',
    visibleText(adminPage.body).includes('Platform configuration'),
    'expected the platform-configuration provenance label'
  )

  const navIntegration = await get('/integration', navigator)
  check(
    'care navigator is denied the integration module',
    navIntegration.status === 403 || navIntegration.status === 307,
    `status ${navIntegration.status}`
  )

  const qualityDenied = await fetch(`${BASE}/api/integration/quality`, {
    method: 'POST',
    headers: { cookie: auditor },
  })
  check(
    'a read-only role cannot trigger quality evaluation',
    qualityDenied.status === 403,
    `status ${qualityDenied.status}`
  )

  // ── help and documentation ────────────────────────────────────────────
  group('Help and documentation')

  const helpIndex = await get('/help', gdRiyadh)
  check('GET /help', helpIndex.status === 200, `status ${helpIndex.status}`)

  const manual = await get('/help/manual', gdRiyadh)
  const manualText = visibleText(manual.body)
  check('GET /help/manual', manual.status === 200, `status ${manual.status}`)
  check(
    'manual lists every navigation module',
    NAVIGATION.every((g) => g.items.every((i) => manualText.includes(i.label))),
    'a module in the sidebar is missing from the manual'
  )

  const architecture = await get('/help/architecture', gdRiyadh)
  const archText = visibleText(architecture.body)
  check('GET /help/architecture', architecture.status === 200, `status ${architecture.status}`)
  check(
    'architecture document contains the integration guidelines',
    archText.includes('Integration guidelines') && archText.includes('natural key'),
    'integration guidelines section did not render'
  )

  // The value of deriving the document from the code is that these numbers
  // track the system. If someone adds a rule or a feed and these assertions
  // fail, the document was hard-coded somewhere and has started lying.
  check(
    'documented counts are derived from the running system',
    archText.includes(`${RULE_CATALOGUE.length} rules`) &&
      archText.includes(`${DOMAINS.length} feeds`) &&
      archText.includes(`${ROLES.length} roles`),
    `expected ${RULE_CATALOGUE.length} rules / ${DOMAINS.length} feeds / ${ROLES.length} roles in the prose`
  )
  check(
    'every feed contract appears in the integration guidelines',
    DOMAINS.every((d) => archText.includes(d.label)),
    'a feed is missing from the contract table'
  )

  // Help is granted to every role on purpose: a role shipping without access
  // to its own documentation is a defect nobody would notice for months.
  const navigatorHelp = await get('/help/manual', navigator)
  check(
    'an operational role can read the manual',
    navigatorHelp.status === 200,
    `status ${navigatorHelp.status}`
  )
  const auditorArchitecture = await get('/help/architecture', auditor)
  check(
    'a read-only role can read the architecture document',
    auditorArchitecture.status === 200,
    `status ${auditorArchitecture.status}`
  )

  // Documentation reads no clinical feed, so it must not claim a data source.
  check(
    'documentation pages carry no provenance bar',
    !manualText.includes('Data source'),
    'the manual claimed a data lineage it does not have'
  )

  // ── audit trail ───────────────────────────────────────────────────────
  group('Audit and governance')

  const auditPage = await get('/audit', auditor)
  const auditText = visibleText(auditPage.body)
  check('audit page lists events', auditText.includes('Audit'), 'audit page did not render')
  check(
    'sign-in events are recorded',
    auditText.includes('LOGIN_SUCCESS') || auditText.includes('Login success'),
    'no authentication events in the trail'
  )

  // ── cleanup ───────────────────────────────────────────────────────────
  // The ingestion checks commit a real patient row to prove the loader writes.
  // Leaving test records in a clinical platform's patient table would be
  // sloppy, and would slowly skew every count the dashboards report.
  group('Cleanup')
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    const removedRuns = await prisma.ingestionRun.deleteMany({ where: { fileName: 'verify.csv' } })
    const removedPatients = await prisma.patient.deleteMany({
      where: { mrn: { startsWith: 'VERIFY-' } },
    })
    await prisma.$disconnect()
    check(
      'verification fixtures removed',
      true,
      `${removedPatients.count} patients, ${removedRuns.count} runs`
    )
    console.log(`      removed ${removedPatients.count} patients and ${removedRuns.count} ingestion runs`)
  } catch (err) {
    check(
      'verification fixtures removed',
      false,
      `cleanup failed — remove MRNs starting VERIFY- by hand: ${err instanceof Error ? err.message : err}`
    )
  }

  // ── summary ───────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) {
    console.log('\nFailures:')
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
    process.exit(1)
  }
  console.log('All checks passed.')
}

main().catch((e) => {
  console.error('\nVerification could not complete:', e instanceof Error ? e.message : e)
  process.exit(1)
})
