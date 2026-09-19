# Data Ingestion Manual

How to get data into Opportuna — by file, by connector, or by fixing one that has stopped.

Written for whoever owns the integration. It assumes you know your source system and nothing about
this platform.

---

## Contents

1. [The short version](#the-short-version)
2. [Before you start](#before-you-start)
3. [Method 1 — manual CSV upload](#method-1--manual-csv-upload)
4. [Method 2 — automated connector](#method-2--automated-connector)
5. [The nine feeds](#the-nine-feeds)
6. [File format rules](#file-format-rules)
7. [Load order](#load-order)
8. [What happens to your file](#what-happens-to-your-file)
9. [Every rejection code](#every-rejection-code)
10. [Data quality](#data-quality)
11. [Troubleshooting](#troubleshooting)
12. [Where to look in the application](#where-to-look-in-the-application)

---

## The short version

```
Field Mapping  →  download template  →  fill it  →  Upload  →  Validate  →  read the errors
      ↑                                                                            │
      └──────────────────── fix and repeat ────────────────────────────────────────┘
                                          │
                                     Commit  →  check Data Quality
```

Open **Data & integration → Upload Data**, pick your feed, download the template, put your data in
it, and press **Validate**. Nothing is written. You get the exact row, column and value behind every
rejection. Fix, repeat, then **Commit**.

You need the `integration.ingest` permission. The Platform Administrator role has it.

---

## Before you start

**Reference data must exist first.** Hospitals, departments, specialties, physicians, payers and the
medication formulary are referenced by every clinical feed using their business codes. If your file
says `hospital_code = RYD` and no hospital has that code, the row is rejected — the platform never
invents a placeholder record to make a reference resolve. That is deliberate: a placeholder hospital
would silently corrupt every figure that groups by hospital.

**Patients before clinical data.** Every clinical feed resolves its patient by MRN. Load patients
first or everything else rejects.

**Send history, not just today.** Several rules measure a patient against their own past behaviour —
refill cadence, visit interval, cancellation pattern. A feed carrying only the last week gives them
nothing to compare against. Twenty-four months is the useful minimum.

---

## Method 1 — manual CSV upload

Use for backfills, corrections, and proving a mapping before anyone builds a connector for it.

### Step 1 — get the template

**Data & integration → Field Mapping**, pick your feed, **Download CSV template**.

The template is generated from the loader itself, so its header row is exactly what the platform
accepts. It includes one worked example row — keep it while you are testing to see the expected
formats, delete it before you commit.

### Step 2 — fill it in

Column names must match the template. Extra columns are ignored with a warning; missing *required*
columns reject the whole file before any row is read.

### Step 3 — validate

**Upload Data**, pick the feed, choose your file, **Validate (dry run)**.

Nothing is written. You get back:

- how many rows would insert and how many would **update existing records** — check that number, it
  is how you find out a file is about to overwrite four thousand patients
- every rejected row, with its row number, column, offending value and what to do about it
- warnings for rows that loaded but will not do what you expect
- a preview of the first accepted rows as the platform actually read them

### Step 4 — commit

**Commit to platform** unlocks only after that exact file has passed a dry run. Swap the file and it
locks again.

Loads are **idempotent**: rows match on the feed's natural key, so re-sending the same file updates
rather than duplicates. Recovering from a partial failure is just sending it again.

### Step 5 — check quality

**Data & integration → Data Quality**. A clean load is not the same as usable data — see
[Data quality](#data-quality).

### Limits

12 MB per upload, roughly 60,000 clinical rows. Beyond that, split the file or build a connector.

---

## Method 2 — automated connector

The contract is identical. The manual path exists to prove your mapping before you automate it.

### Choose a transport

| Mode | Latency | Use when | Fails by |
|---|---|---|---|
| **CDC stream** | Seconds–minutes | The source has a replica you may read and volume is high. Lowest latency, lowest load on the source. | Going silent. A stopped consumer looks exactly like a quiet period. |
| **API pull** | Minutes–hours | The source exposes a paginated, filterable API you can watermark on an updated timestamp. | Partial pages; a watermark advancing past rows not yet committed at the source. |
| **SFTP file drop** | Hours | The source is a batch system producing a scheduled extract. | A missing file, or one re-dropped under the same name with different content. |
| **Database link** | Minutes | Last resort. No API, no extract, and the DBA team permits a read-only connection. | Source schema changes, silently, with no announcement. |

### Watermarking

Incremental pipelines advance a watermark after each successful run. Two rules:

- **Watermark on an updated timestamp, not a created one.** A row edited yesterday but created last
  year must come through again.
- **Lag the watermark by a few minutes.** Rows committing at the source while you read can otherwise
  fall in the gap between one run's ceiling and the next run's floor. They are then never collected.

### Scheduling

Set the cron and the SLA on the pipeline. The SLA is what staleness is measured against — a feed is
flagged once it has missed **three** scheduled cycles. One missed cycle is noise; three is a fault.

### Failure handling

Do not silently skip a failed batch. A partial run is recorded as `PARTIAL` with its rejected rows
attached, which is what lets you hand a precise list back to the source team. Re-send the whole
batch after fixing — idempotency makes that safe.

---

## The nine feeds

| Feed | Lands in | Natural key | What stops working without it |
|---|---|---|---|
| **Patient registration** | `Patient` | `mrn` | Everything. Clinical rows resolve patients by MRN; consent and contactability gate all outreach. |
| **Clinical encounters** | `Encounter` | `sourceId` | Follow-up interval rule, all four reactivation rules, chronic-therapy review, lifetime value, and the "no encounter since" test most clinical rules use. |
| **Laboratory results** | `LabResult` | `sourceId` | All five laboratory rules, plus monitoring checks on high-risk medication. |
| **Appointments** | `Appointment` | `sourceId` | No-show, repeated cancellation and unreconciled booking rules; cancellation analysis; patient engagement scoring. |
| **Insurance claims** | `InsuranceClaim` | `claimNumber` | The entire Insurance Recovery module. |
| **Pharmacy dispensing** | `PharmacyTransaction` | `sourceId` | Refill overdue, refill abandonment, incomplete course. |
| **Surgical pathway** | `Surgery` | `sourceId` | All four surgical rules and post-surgical reactivation — the largest financial values in the pipeline. |
| **Referrals** | `Referral` | `sourceId` | Referral never booked, expired referral, leakage, and service-line leakage analysis. |
| **Diagnoses** | `Diagnosis` | `patientId + icd10 + diagnosedAt` | The chronic flag, which gates lapsed-chronic reactivation and recurring lab monitoring. |

Full column lists, types and examples are in **Field Mapping** in the application. It is generated
from the loader, so it is never out of date.

### The five fields that matter most

These are the ones whose absence is least obvious and most damaging:

| Field | Feed | Why |
|---|---|---|
| `follow_up_recommended` + `follow_up_days` | Encounter | Drives an entire rule. Usually free text in a clinical note at source — extract it upstream, the rule cannot infer it. |
| `consent_marketing` | Patient | Defaults to **false** when absent. An unmapped column silently excludes every patient from every outreach rule. |
| `repeat_interval_days` | Laboratory | Without it, the recurring-monitoring rule has nothing to measure lateness against. |
| `rejection_recovery_rate` | Claim | Defaults to zero, which puts every rejection below the recoverable threshold and makes the recovery module report nothing. |
| `workup_complete` | Surgery | Drives the rule about pre-operative assessments expiring unused. |

---

## File format rules

### CSV

RFC 4180. Quoted fields may contain commas and newlines; a literal quote inside a quoted field is
doubled (`""`). UTF-8. A byte-order mark from Excel is stripped rather than becoming part of your
first column name.

### Types

| Type | Accepted | Rejected |
|---|---|---|
| `string` | Any text. | Nothing, unless required and empty. |
| `integer` | Whole numbers. Thousands separators tolerated (`1,250`). | Decimals; non-numeric text. |
| `number` | Decimals and whole numbers. Separators tolerated. | Non-numeric; outside a declared min/max. |
| `boolean` | `true`/`false`, `1`/`0`, `yes`/`no`, `y`/`n`, `t`/`f`, any case. | Anything else. |
| `date` / `datetime` | **ISO 8601 only** — `2026-06-18` or `2026-06-18T10:30:00Z`. No timezone is read as UTC. | Everything else, including `06/18/2026`. |
| `enum` | One of the listed values, any case. Normalised to upper case. | Anything outside the list. No synonym mapping. |
| reference | A business code that exists — hospital code, MRN, specialty code. | Unknown codes. |

### Why ambiguous dates are rejected rather than guessed

`01/02/2026` is 2 January in one country and 1 February in another. A platform that guesses wrong
shifts a clinical follow-up window by a month, and does so silently on every row. Rejecting the
ambiguous case and telling you to send ISO is the only safe behaviour. Convert upstream.

---

## Load order

1. **Reference data** — hospitals, departments, specialties, physicians, payers, medication
   formulary. Currently loaded by the platform seed rather than by a feed.
2. **Patients** — every clinical feed resolves patients by MRN.
3. **Encounters** — laboratory results, diagnoses and claims may reference an encounter.
4. **Everything else** — laboratory, appointments, claims, pharmacy, surgery, referrals, diagnoses,
   in any order.

Loading out of order rejects rows that would otherwise be perfectly valid. The rejection message
tells you which reference failed.

---

## What happens to your file

1. **Parsed** — RFC 4180, BOM stripped.
2. **Typed** — every value coerced against the field contract; failures carry row, column and value.
3. **Resolved** — business codes looked up. Unknown codes reject the row.
4. **Upserted** — matched on the feed's natural key. Insert or update, never duplicate.
5. **Measured** — quality checks run against what landed.
6. **Recorded** — the run, every rejected row and the quality result are written to the audit trail,
   attributed to whoever ran it.

A dry run stops after step 3 and reports what steps 4–6 *would* have done.

---

## Every rejection code

| Code | Meaning | Fix |
|---|---|---|
| `MISSING_REQUIRED_COLUMN` | The file has no column for a required field. Structural — no rows load. | Add the column. Compare against the template. |
| `REQUIRED_FIELD_EMPTY` | A required field was blank on this row. | Populate it, or exclude the row at source. |
| `INVALID_DATE` | Not ISO 8601. | Convert upstream. `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`. |
| `INVALID_ENUM` | A coded value outside the accepted set. | Map it at source. The platform does not map synonyms. |
| `INVALID_NUMBER` | A numeric field could not be parsed. | Check for currency symbols, spaces or text such as `N/A`. |
| `INVALID_INTEGER` | A whole-number field carried a decimal. | Round at source, deliberately. |
| `INVALID_BOOLEAN` | A true/false field held something else. | Use `true`/`false`, `1`/`0` or `yes`/`no`. |
| `BELOW_MINIMUM` / `ABOVE_MAXIMUM` | Outside the declared bounds. | Usually a unit mismatch — days sent as hours, amounts in the wrong currency scale. |
| `UNRESOLVED_REFERENCE` | A business code had no match. | Load the reference data first, or correct the code. Placeholders are never created. |
| `MISSING_NATURAL_KEY` | No complete natural key, so the row can be neither matched nor inserted. | Populate the key columns for that feed. |
| `WRITE_FAILED` | Validated, but the database refused it. | Usually a constraint the mapping does not know about. Take the message to the platform team. |

### Warnings — these load, but read them

| Code | Meaning |
|---|---|
| `UNKNOWN_COLUMN` | A column not in this feed was ignored. Harmless, but check your mapping is what you intended. |
| `FOLLOW_UP_WITHOUT_INTERVAL` | Encounter flagged for follow-up with no interval. It loaded, but the follow-up-overdue rule will ignore it. |
| `REJECTED_WITHOUT_REASON` | A rejected claim with no reason code. It loaded, but no recovery pathway can be assigned. |
| `PENDING_WITH_VALUE` | A laboratory row marked pending that also carried a result. |

---

## Data quality

Ingestion answers *did the rows load*. Quality answers *can the platform use them*. Those are
different questions, and the second one fails silently.

A patient feed can load ten thousand rows cleanly, show a green run, and leave every outreach rule
finding nothing — because `consent_marketing` was not mapped, defaulted to false, and excluded
everyone. Nobody notices for weeks, and the conclusion drawn is usually that the detection rules do
not work.

Sixteen checks across five dimensions:

- **Completeness** — did the field arrive at all
- **Validity** — is it well-formed
- **Consistency** — do fields agree with each other (paid never exceeding approved, for instance)
- **Timeliness** — is the feed current, judged against its own schedule
- **Uniqueness** — are natural keys actually unique

Each failure carries its remediation. A consent column at 0% does not read as
`0.00% completeness`; it reads as *this is probably a mapping error, not a population that
unanimously refused*.

Quality runs automatically after every committed load. **Data Quality → Re-evaluate quality** runs
it on demand after you have fixed something upstream.

---

## Troubleshooting

**Everything rejects with `UNRESOLVED_REFERENCE` on `patient_mrn`.**
The patient feed has not loaded, or your MRN format differs between systems. Check one MRN against
the Patients screen.

**Everything rejects with `INVALID_DATE`.**
Your export is using a locale date format. Excel does this on save. Export from the source system
directly, or format the column as ISO before saving.

**The dry run says it will update thousands of records I did not expect.**
Your file overlaps existing data. That may be correct for a correction, and is a serious problem for
an import. Check the natural key for the feed — you may be re-sending history you have already
loaded.

**The load succeeded but no opportunities appeared.**
Detection runs on a schedule, not on load. Trigger it from **Opportunity Rules → Run detection**.
If it still finds nothing, check **Data Quality** — the field a rule depends on is probably empty.

**A pipeline shows as stale but the source team says it is sending.**
Check the watermark on the pipeline detail page. A watermark that has advanced past the data is the
usual cause: the connector believes it has already collected everything.

**A rule that used to find things has gone quiet.**
Look at that feed's quality checks first, then its reject rate. A source-side schema change that
renames a column shows up as a completeness failure, not as an ingestion error — the column simply
stops arriving, and unmapped columns are only a warning.

**Claims load but Insurance Recovery is empty.**
`rejection_recovery_rate` is almost certainly unmapped. It defaults to zero, and zero is below the
recoverable threshold on every rejection. Supply your own historical recovery rates per reason and
payer.

**Surgical conversion shows nothing.**
Your theatre feed is performed-cases-only. Recommendations and consultations are what the conversion
rules measure. On most theatre systems this is a query parameter — see the operator notes on the
Theatre source system.

---

## Where to look in the application

| Screen | Use it for |
|---|---|
| **Integration Overview** | The architecture diagram, connection status, and what depends on each feed. |
| **Source Systems** | Connection detail, endpoints, owning teams, and the operator notes for each system's quirks. |
| **Ingestion Pipelines** | Run history, staleness, reject rates. Problems are sorted to the top. |
| **Pipeline detail** | Every rejected row for one feed, with row, column and value — this is what you hand back to the source team. |
| **Field Mapping** | The interface contract. Generated from the loader, so never out of date. |
| **Upload Data** | Validate and commit a file. |
| **Data Quality** | Whether what landed can actually drive the rules. |

---

## Reference

- Field contracts in code: `src/lib/ingestion/domains.ts`
- Parsing and coercion: `src/lib/ingestion/parse.ts`
- Reference resolution and upsert: `src/lib/ingestion/load.ts`
- Quality checks: `src/lib/ingestion/quality.ts`
- Architecture mapping to the production stack: [`DATA-PLATFORM.md`](DATA-PLATFORM.md)
- Integration diagram as Mermaid: [`INTEGRATION-DIAGRAM.md`](INTEGRATION-DIAGRAM.md)

Adding a new feed means adding an entry to `domains.ts`. The mapping screen, CSV template, validator
and loader all read from it, so nothing else has to change.
