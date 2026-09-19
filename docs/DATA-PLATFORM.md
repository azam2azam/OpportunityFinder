# Data platform and integration

How this reference deployment maps onto the production architecture in the specification, and what
would change on the way there.

---

## Source systems

The platform consumes VIDA HIS and its satellites. The domains landed by this deployment, with the
table each feeds:

| VIDA domain | Table | Drives |
|---|---|---|
| Patient Registration | `Patient` | Contactability, consent, payer, geography |
| Encounters (OPD/IPD/ED/day case) | `Encounter` | Activity, follow-up instructions, gross charge |
| Appointments | `Appointment` | No-shows, cancellations, unreconciled bookings |
| Diagnosis | `Diagnosis` | Chronic context for monitoring and reactivation rules |
| Procedures | `Procedure` | Delivered activity |
| Surgery | `Surgery` | Recommendation → workup → booking → performance chain |
| Laboratory (LIS) | `LabResult` | Abnormal results, pending orders, monitoring cycles |
| Pharmacy | `PharmacyTransaction` | Dispense cadence, refill abandonment |
| Medication / Orders | `Medication`, `Prescription` | Chronic therapy, monitoring requirements |
| Billing / Claims (RCM) | `InsuranceClaim` | Adjudication status, underpayment |
| Rejections | `InsuranceRejection` | Reason codes, recovery pathways, responsible department |
| Referrals | `Referral` | Onward care, expiry, leakage |
| Payers | `Payer` | Resubmission windows |

Every clinical table carries `sourceSystem` and `sourceId` so a row can be traced to its origin
record. Radiology, clinical notes, discharge and the patient portal are modelled in the conceptual
schema but not populated by the synthetic generator — they attach through the same adapter pattern.

---

## Integration

| Concern | Reference deployment | Production |
|---|---|---|
| Ingestion | `prisma/seed.ts` writes the landed tables directly | CDC from VIDA (Debezium/GoldenGate) onto Kafka; scheduled ETL for slow-moving reference data |
| Orchestration | `npm run detect` | Scheduler triggers detection on CDC arrival or nightly |
| Warehouse | SQLite file | Snowflake; the schema is written to port — enum-like columns are strings validated in the semantic layer, and there are no SQLite-specific types |
| Governance | Schema + `src/lib/enums.ts` | Informatica for lineage, quality rules and the business glossary |
| Identity | Server-side sessions, scrypt | Enterprise SSO via OIDC; `getPrincipal()` is the single swap point |
| NL-to-SQL | Template provider | The hospital's existing engine, through `NlSqlProvider` |

### Why the seams are where they are

Three modules are deliberately isolated so a production swap touches one file each:

**`src/lib/auth.ts` → `getPrincipal()`** resolves the caller into a `Principal`. Replacing session
cookies with OIDC means changing how that function obtains a user id. Everything downstream consumes
the `Principal`, so nothing else moves.

**`src/lib/nlsql/types.ts` → `NlSqlProvider`** is the NL-to-SQL seam. Validation, scope binding,
execution and auditing all live on the platform side of it, so an enterprise engine inherits the
guardrails rather than having to reimplement them.

**`src/lib/detection/context.ts` → `loadContext()`** is the only code that reads source tables.
Detectors operate on the returned snapshot. Moving the warehouse to Snowflake means rewriting this
one function; the 33 rules are untouched.

---

## Detection at production scale

The reference loader pulls the full population into memory. At 3,000 patients that is roughly
120,000 rows and a 50-second full run. This does not scale to a group with a million patients, and
the shape of the fix is already implied by the design:

1. **Incremental runs.** Detectors are pure over a snapshot, so a snapshot restricted to patients
   with CDC activity since the last run produces identical results for those patients. The
   `DetectionRun` table already records run boundaries.
2. **Partition by hospital.** `runDetection` accepts `hospitalId`; runs parallelise across hospitals
   with no shared state.
3. **Push aggregates down.** The three service-line rules operate on `ServiceLineMetric`, which in
   production is a warehouse view rather than a table the generator writes.

What should *not* change is the purity of the detectors. The reason a full run is one bounded set of
reads instead of thousands of per-patient queries is that rules cannot query — and that property is
also what makes each rule testable against a hand-built patient.

---

## Portability notes

The schema avoids anything SQLite-specific. Three details matter when porting:

- **Enum-like columns are strings.** SQLite has no enum type, and Snowflake's differs from
  Postgres's. The validity contract lives in `src/lib/enums.ts`; add a `CHECK` constraint or a
  native enum on the target as preferred.
- **JSON columns are `String`.** `params`, `evidence`, `scoreBreakdown`, `criteria` and `detail`
  hold JSON as text. Postgres `jsonb` or Snowflake `VARIANT` would allow indexed queries into the
  evidence blob — worth doing, since the insurance module currently reads rejection reasons back out
  of `evidence` in application code.
- **Timestamps are stored as epoch milliseconds by SQLite.** The Ask Data templates contain
  `strftime('%Y-%m', col / 1000, 'unixepoch')`, which is the one genuinely dialect-specific thing in
  the codebase. Porting means rewriting those expressions — they are confined to
  `src/lib/nlsql/templates.ts`.

---

## Data quality dependencies

The detection rules depend on source fields that are frequently incomplete in real HIS deployments.
Where a field is unreliable, the affected rules degrade in a specific way:

| Field | Rules affected | Behaviour when missing |
|---|---|---|
| `Encounter.followUpRecommended` / `followUpDays` | `APPT_FOLLOWUP_INTERVAL_EXCEEDED` | Rule silently finds nothing — the single largest coverage risk, since this is often free text in practice rather than a structured field |
| `LabResult.repeatIntervalDays` | `LAB_RECURRING_LAPSED` | Rule finds nothing; consider deriving the interval from observed history per test |
| `Surgery.workupComplete` | `SURG_WORKUP_DONE_NOT_PERFORMED` | Rule finds nothing |
| `InsuranceRejection.historicalRecoveryRate` | `INS_REJECTION_RECOVERABLE` | Defaults to 0, so everything falls below the minimum rate and the rule goes silent. In production this should be computed from the group's own recovery history rather than supplied by the source |
| `Patient.contactable` / `consentMarketing` | All outreach rules | Fails **open** into exclusion — an unknown consent state is treated as no consent, so the patient is not contacted |

The Rules module surfaces "silent rules" — enabled rules producing nothing — precisely so a missing
source field shows up as a question rather than as an absence nobody noticed.

---

## Observability

The reference deployment records what a production deployment would ship to its monitoring stack:

- `DetectionRun` — per-rule scanned/created/updated/suppressed counts and durations
- `NlQuery` — every natural-language interaction with its validation outcome
- `AuditEvent` — authentication, PHI access, actions, configuration changes, exports, denials

Rule performance on the Analytics page (conversion against dismissal rate, per rule) is the
application-level metric that matters most: a rule being dismissed 40% of the time is generating
work that wastes a navigator's day, and no infrastructure metric would reveal it.
