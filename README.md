# Opportuna

**Hospital Growth & Patient Opportunity Command Centre**

An operational intelligence platform that turns hospital system data into prioritised, owned and
measurable patient opportunities. Not a BI dashboard — the central object is the **opportunity**,
and every screen exists to move one along:

```
DATA → INSIGHT → OPPORTUNITY → PRIORITY → ACTION → OUTCOME
```

---

## Running it

```bash
npm install
npm run db:reset     # schema, VIDA extract, integration metadata, detection, history, quality
npm run dev          # http://localhost:3300
```

`db:reset` runs six stages and takes about two minutes:

| Stage | What it does |
|---|---|
| `prisma db push` | Creates the schema |
| `db:seed` | Generates a synthetic VIDA extract — 3,000 patients across 5 hospitals |
| `seed:integration` | Source systems, pipelines, field mappings, quality rules and run history |
| `detect` | Runs all 33 detection rules over the population |
| `simulate` | Backfills operational history so funnels and conversion are populated |
| `quality` | Evaluates the 16 data-quality checks |

Sign in with any demo account below. The password for all of them is `Demo!Pass123`.

### Verifying

```bash
npm run test         # 108 unit tests — engines, scoring, guardrails, access control
npm run verify:http  # 76 end-to-end checks against the running server
```

`verify:http` needs the dev server running. It signs in as each persona and asserts on rendered
output — that RBAC holds, that hospital segregation holds, that PHI is masked for roles without
rights, that the SQL guardrails block destructive input, that every route renders, and that the
ingestion path validates, rejects and upserts exactly as documented.

---

## Demonstration roles

Each role sees a materially different platform. This is the fastest way to see the access model
working.

| Account | Role | Sees |
|---|---|---|
| `ceo@opportuna.health` | Group CEO | All hospitals, group KPIs, comparison, alerts |
| `coo@opportuna.health` | Group COO | Operational performance, action tracking, conversion |
| `cmo@opportuna.health` | Group CMO | Clinical categories only — no insurance, no claim amounts |
| `gd.riyadh@opportuna.health` | General Director | One hospital's command centre, full PHI |
| `gd.jeddah@opportuna.health` | General Director | A different hospital — try comparing what each can see |
| `ed.riyadh@opportuna.health` | Executive Director | Two hospitals (multi-hospital scope) |
| `dept.riyadh@opportuna.health` | Department Manager | Departmental queue |
| `navigator@opportuna.health` | Care Navigator | Work queue and outreach only — no dashboards |
| `rcm@opportuna.health` | Revenue Cycle Specialist | Insurance recovery only — clinical modules refuse |
| `analyst@opportuna.health` | Data Analyst | Analytics and generated SQL — patient names masked |
| `admin@opportuna.health` | Platform Administrator | Rules, scoring, users — no PHI |
| `auditor@opportuna.health` | Compliance Auditor | Audit trail, read-only |

---

## Architecture

```
VIDA HIS / LIS / RCM  ──▶  Integration (CDC, APIs, scheduled ETL)
                              │
                              ▼
                       Enterprise data platform
                              │
                              ▼
                    Semantic layer  (src/lib/enums.ts, queries.ts)
                              │
                              ▼
              Opportunity Detection Engine  (src/lib/detection/)
                              │
                              ▼
                 Opportunity Scoring Engine  (src/lib/scoring.ts)
                              │
                              ▼
                  Operational workflow + RBAC  (src/lib/rbac.ts)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
          Executive dashboards    Ask Data  (src/lib/nlsql/)
```

See [`docs/DATA-PLATFORM.md`](docs/DATA-PLATFORM.md) for how this reference deployment maps onto
the production stack (Snowflake, Kafka/CDC, Informatica, enterprise SSO).

### Stack

- **Next.js 16** (App Router, React 19, TypeScript) — server components throughout; client
  components only where interaction demands it
- **Prisma + SQLite** for the reference deployment; the schema is written to port to
  Postgres/Snowflake
- **Tailwind CSS** with a semantic priority palette
- **Recharts** for visualisation
- Zero native dependencies — auth uses Node's built-in `scrypt`

---

## The detection engine

33 rules across 8 categories. Each is a pure function over a preloaded snapshot, so a full run is a
fixed set of reads rather than thousands of per-patient queries, and every rule is unit-testable
against a hand-built patient.

| Category | Rules | Examples |
|---|---|---|
| Laboratory | 5 | Abnormal result with no follow-up; critical result unactioned; lapsed monitoring cycle |
| Surgery | 4 | Recommended but never booked; workup complete, procedure not performed |
| Medication | 5 | Refill overdue; refill pattern abandoned; monitored drug without its test |
| Insurance | 5 | Recoverable rejection; repeat rejection pattern; underpayment; stalled claim |
| Reactivation | 4 | Lapsed chronic patient; broken specialist cadence; post-surgical patient lost |
| Appointments | 4 | No-show never rebooked; follow-up interval exceeded; unreconciled booking |
| Referrals | 3 | Issued but never booked; expired unfulfilled; fulfilled outside the group |
| Service line | 3 | Capacity underused; referral leakage; excessive cancellations |

**Every threshold is configuration, not code.** Rules read their parameters from the database, and
the rule editor at `/rules/[id]` writes them back with the before-and-after recorded in the audit
trail. Detectors contain no literals of their own.

### Reconciliation

A detection run is not a rebuild. Opportunities people are actively working survive it with status,
owner and action history intact, while their score and narrative refresh against the latest data:

- **created** — no opportunity with this dedupe key exists
- **updated** — an open opportunity exists; refresh the assessment, keep the workflow
- **suppressed** — a closed opportunity exists; do not resurrect work a human dispositioned

---

## Scoring and explainability

Nine factors, weighted by an editable model, normalised to 0–100 and combined into a score that
maps onto a priority band. Two properties matter:

**The model is not hard-coded.** Weights and bands live in `ScoringModel` and are edited from
Administration. Two models ship — a balanced one (active) and a revenue-weighted draft — so the
difference is visible.

**Nothing is unexplained.** Every factor emits a sentence describing what it measured. Those
sentences are what the opportunity page shows under *"High priority because:"*. A score with no
breakdown is a bug.

Some normalisations are deliberately non-obvious and documented where they live:

- **Financial value scales logarithmically.** Linearly, a handful of large surgical cases would
  flatten every other signal to near zero.
- **Time sensitivity peaks then eases.** A follow-up 400 days late is a reactivation problem, not
  an urgent one; scoring it at maximum forever would crowd out newly actionable work.
- **A clinical-safety floor can raise a priority but never lower it,** and the override is recorded
  explicitly rather than folded silently into the number.

---

## Ask Data

Natural language → SQL → validation → execution → visualisation → explanation.

The spec notes the hospital already operates an NL-to-SQL engine. `NlSqlProvider` in
`src/lib/nlsql/types.ts` is the seam for it. The shipped implementation is a deterministic template
engine covering 17 question patterns; an enterprise engine is dropped in by implementing the
interface.

**Validation happens on this side of the seam regardless of who generated the SQL.** An external
engine is untrusted input — a model that has read a user's question can be talked into writing
`DELETE`. So every query is checked before it reaches the database:

- read-only (SELECT/WITH only, write keywords rejected on word boundaries)
- a single statement, with SQL comments rejected outright since they can conceal a second one
- only tables in the semantic model — `User`, `Session`, `Role` and `AuditEvent` are never queryable
- always row-bounded

Hospital scope is **bound as a parameter by the provider**, not appended afterwards — appending a
scope clause to arbitrary SQL is not safely possible.

Every question is logged with its interpretation, validation outcome and row count. Blocked
questions are logged too; a log of only successes is the wrong half.

---

## Data ingestion

Nine feeds, four ways in, one contract. Full procedure in
[`docs/INGESTION-MANUAL.md`](docs/INGESTION-MANUAL.md); the architecture as Mermaid in
[`docs/INTEGRATION-DIAGRAM.md`](docs/INTEGRATION-DIAGRAM.md).

| Feed | Lands in | Natural key |
|---|---|---|
| Patient registration | `Patient` | `mrn` |
| Clinical encounters | `Encounter` | `sourceId` |
| Laboratory results | `LabResult` | `sourceId` |
| Appointments | `Appointment` | `sourceId` |
| Insurance claims | `InsuranceClaim` | `claimNumber` |
| Pharmacy dispensing | `PharmacyTransaction` | `sourceId` |
| Surgical pathway | `Surgery` | `sourceId` |
| Referrals | `Referral` | `sourceId` |
| Diagnoses | `Diagnosis` | `patientId + icd10 + diagnosedAt` |

Transport is CDC stream, API pull, SFTP file drop or manual upload. The contract does not change
between them — the manual path exists to prove a mapping before anyone builds a connector for it.

**The feed contracts in `src/lib/ingestion/domains.ts` are the single source of truth.** The Field
Mapping screen, the CSV template endpoint, the validator and the loader all read from them, so the
documented interface cannot drift from the one that actually runs. Adding a feed means adding an
entry there and nothing else.

### Properties worth knowing

- **Dry run first.** Commit unlocks only after that exact file has passed validation. You see how
  many rows would insert, how many would *overwrite*, and every rejection with its row, column and
  offending value.
- **Idempotent.** Rows upsert on the natural key, so replaying a file after a partial failure
  updates rather than duplicates. "Re-send it" is a safe instruction to give an integrator.
- **Ambiguous dates are rejected, not guessed.** `01/02/2026` is two different days depending on
  where you are, and guessing wrong shifts a clinical follow-up window by a month.
- **Unknown business codes are rejected, not created.** A placeholder hospital record would silently
  corrupt every figure that groups by hospital.
- **Consent defaults to false.** An unmapped consent column excludes patients from outreach rather
  than opting them in — and a quality check exists specifically to tell you that is what happened.

### Quality is measured separately from ingestion

Ingestion answers *did the rows load*. Quality answers *can the platform use them*, and that second
failure is silent: a feed can load ten thousand rows cleanly and leave every rule finding nothing,
because the one column those rules depend on arrived empty.

Sixteen checks across completeness, validity, consistency, timeliness and uniqueness, each carrying
its remediation. A consent column at 0% reads as *this is probably a mapping error, not a population
that unanimously refused* — not as an abstract percentage.

---

## Security and governance

| Control | Where |
|---|---|
| Role-based access control | `src/lib/rbac.ts`, `src/lib/guard.ts` |
| Hospital data segregation | `scopeWhere()` — every opportunity read goes through it |
| Minimum-necessary categories | `visibleCategories()` — a CMO sees no claim amounts |
| PHI masking | `projectPatient()` — one place, so no page can forget |
| Patient access logging | `auditPhiAccess()` — fires before the profile renders |
| AI interaction auditing | Every Ask Data question, blocked ones included |
| SQL guardrails | `src/lib/nlsql/validator.ts` |
| Configuration change history | Full before/after on rule and scoring edits |
| Export auditing | Filters, row count, and whether PHI was included |

Scope **fails closed**: a principal with no hospital assignment gets `hospitalId IN ()`, which
matches nothing, rather than an omitted filter that would match everything.

Out-of-scope records return 404, not 403 — a 403 would confirm that the record exists elsewhere.

**The platform produces decision support, never autonomous clinical decisions.** Every opportunity
carries the observation that produced it and the weighted factors behind its score, so any
recommendation can be examined and overruled. Clinical judgement stays with the treating clinician.

---

## Project layout

```
prisma/
  schema.prisma          30-entity conceptual model
  seed.ts                Synthetic VIDA extract generator (deterministic)
  seed-data.ts           Reference data — LOINC, ICD-10, CPT, payers, rejection playbook
src/
  app/
    (app)/               Authenticated shell — the 18 navigation modules
    api/                 Route handlers (auth, actions, ask, detection, rules, scoring, export)
  components/
    client/              Interactive components
    *.tsx                Server-rendered primitives
  lib/
    detection/           Rule catalogue, detectors, context loader, engine
    ingestion/           Feed contracts, CSV parsing, loader, quality checks
    nlsql/               Ask Data provider seam, templates, validator
    scoring.ts           The scoring engine
    rbac.ts              Roles, permissions, scope, PHI masking
    queries.ts           Scoped data access — nothing bypasses it
    alerts.ts            Executive alert evaluation
scripts/
  run-detection.ts       CLI detection run
  simulate-workflow.ts   Backfills operational history
  verify-http.ts         52-check end-to-end verification
tests/                   108 unit tests
docs/                    Ingestion manual, integration diagram, platform mapping, assumptions
```

---

## Data

All data is synthetic. No record describes an actual person. The generator uses a seeded PRNG, so a
given `SEED` always produces the same population — detection counts are stable enough to assert on.

Patients are assigned clinical *scenarios* that plant the exact patterns detectors look for.
Purely random histories leave some rules with zero matches, which makes an empty screen ambiguous:
no data, or a broken rule? Planted cohorts remove that ambiguity.

Scale knobs:

```bash
SEED_PATIENTS=10000 npm run db:seed    # larger population
SEED=12345 npm run db:seed             # different population, same shape
```
