# Assumptions and decisions

Where the specification left room for judgement, this is what was decided and why. Read this before
extending the platform — several choices would be wrong for a different deployment.

---

## The largest assumption

**No live VIDA connection exists in this environment, so the platform runs on a synthetic extract
that lands the same tables a real integration would.**

Everything downstream — semantic layer, detection, scoring, Ask Data, dashboards — is production
code operating on production-shaped data. The substitution is confined to `prisma/seed.ts`. Pointing
at real VIDA means replacing `loadContext()` in `src/lib/detection/context.ts` and the seed; no rule,
score or screen changes.

All patient records are fabricated. No record describes an actual person.

---

## Scope decisions

**Built:** all 18 navigation modules, all 8 opportunity categories (33 rules), the configurable
scoring engine with explainability, the full opportunity lifecycle with actions and conversions,
RBAC across 12 roles with hospital segregation and PHI masking, Ask Data with SQL guardrails,
campaign tracking, executive alerts, and the audit trail.

**Modelled but not populated:** radiology, clinical notes as structured data, discharge summaries
and patient-portal interactions exist in the conceptual schema. They attach through the same pattern
as the populated domains; nothing depends on their absence.

**Deliberately not built:** campaign *creation* is read-only in the UI. Creating a cohort that
messages thousands of patients about their health is the highest-consequence write in the product,
and shipping it without the approval workflow, opt-out enforcement and message review that a real
deployment needs would have been the wrong kind of completeness. Two worked campaigns are seeded so
the module's funnel and attribution are real. The `Campaign` and `CampaignMember` tables, the
approval fields and the funnel logic are all in place; what is missing is the authoring UI.

---

## Judgement calls worth knowing about

### One opportunity per clinical thread, not per source row

Several rules could fire repeatedly for the same underlying problem — three analytes in one lapsed
renal panel, two prescriptions for the same drug, a series of abnormal results in one thread. Each
of these is one phone call, so the detectors collapse them: `LAB_RECURRING_LAPSED` keys on panel
rather than analyte, `LAB_ABNORMAL_NO_FOLLOWUP` takes only the latest result per test, and the
engine collapses duplicate dedupe keys within a run.

This was not an aesthetic choice. The first detection run produced 6,715 findings from
`LAB_RECURRING_LAPSED` alone — 53% of the entire pipeline from one low-value rule. A queue like that
is unusable regardless of how correct each individual row is.

### "Recurring" means the patient has a repeat history

`LAB_RECURRING_LAPSED` requires at least two prior results in the panel *and* a chronic diagnosis or
active long-term prescription. A single old result with a repeat interval attached is an episode,
not a monitoring cycle, and recalling those patients generates work nobody intended.

### Rules hand off to each other rather than overlapping

- A medication gap under 90 days is `MED_REFILL_OVERDUE`; beyond it, `MED_REFILL_ABANDONED` owns it.
- A monitoring lapse beyond 540 days is a reactivation case, not a lab recall.
- `INS_PATIENT_PATHWAY` only fires once the payer route is genuinely closed — the insurer must be
  exhausted before the patient is asked to pay.

Without these handoffs the same patient appears in two queues for one problem, and the counts on the
dashboard double-count the work.

### Insurance: recoverable value, not rejected value

`potentialValue` on a recovery opportunity is the rejected amount weighted by the historical
recovery rate for that reason and payer — not the full rejected amount. Showing the gross figure
would overstate the pipeline by roughly a factor of two and set an expectation the team cannot meet.

### Physician metrics are normalised and framed

The Physicians module shows open loops per hundred encounters and closure rate alongside raw counts,
and says in the page itself that these describe where loops remain open rather than clinical
quality. An open opportunity attributed to a physician usually reflects a patient who did not return.
Presenting the raw count as a ranking would be both unfair and, in a real hospital, politically fatal
to the platform's adoption.

### Scale-dependent thresholds

`SL_HIGH_CANCELLATION` ships with `minEncounters: 30`. For a real group this is too low — a
high-volume hospital would want 80 or more, or small clinics will look volatile. It was lowered to
fit the 3,000-patient demo population, and the parameter documentation says so.

---

## Things a real deployment must decide

**Consent and outreach.** Detection excludes patients who are not contactable or have not consented.
Whether consent for clinical follow-up is the same consent as for growth outreach is a policy
question this platform does not answer — it treats them as one flag, which is probably too coarse.

**The self-pay pathway.** `INS_PATIENT_PATHWAY` raises financial counselling where the payer route is
closed, and its evidence carries the caveat that eligibility must be confirmed against the payer
contract before any pricing discussion. The legal boundary here varies by jurisdiction and contract,
and this rule should be reviewed by counsel before it is enabled in production.

**Who holds `patient.view.phi`.** Currently: clinical roles, directors, navigators and RCM
specialists. Analysts and administrators do not. That split is defensible but is a policy decision,
not a technical one.

**Realised value.** Recognised at conversion, set equal to the estimated potential value. A real
deployment should reconcile against actual billed revenue rather than trusting the estimate, or the
recovered-revenue figure will drift from finance's numbers and lose credibility.

**Retention.** Audit events and `NlQuery` rows accumulate without a retention policy. Both contain
PHI-adjacent data (patient ids, question text) and need one.

---

## Known limitations

- **Detection is a full scan.** Fine at 3,000 patients (~50s); needs the incremental strategy in
  `docs/DATA-PLATFORM.md` beyond roughly 50,000.
- **The insurance module reads rejection details out of the `evidence` JSON blob** rather than
  joining. Correct and consistent with the narrative shown on each opportunity, but it prevents
  database-level aggregation over rejection reasons. Postgres `jsonb` would fix this.
- **Ask Data covers 17 question patterns.** Outside them it declines and says what it can answer
  rather than guessing. That is the right behaviour for a deterministic engine, but it is narrower
  than a language model would be — which is what the `NlSqlProvider` seam exists for.
- **Timestamp arithmetic in the Ask Data templates is SQLite-specific** (`strftime(... 'unixepoch')`)
  and is the one thing in the codebase that must be rewritten on port.
- **Browser-based UI verification was not possible in this environment** — the in-app browser does
  not drive Next dev servers reliably here. Verification is done over HTTP instead
  (`scripts/verify-http.ts`, 52 checks), asserting on rendered markup for every route, every role
  boundary, PHI masking and the SQL guardrails. That covers behaviour and access control; it does not
  cover visual rendering or responsive layout, which have not been visually confirmed.
