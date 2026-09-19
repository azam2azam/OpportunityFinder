# User Manual

**How do I use this system to get through my day?**

Signing in, reading an opportunity, working your queue, and what every module is for. Start at the beginning on your first day; after that, jump to the section you need.

**Written for:** Everyone who uses the platform — care navigators, RCM specialists, department managers, directors and analysts.

*Generated from `src/lib/docs/manual.ts` by `npm run docs:generate`. Do not edit by hand — edit the source and regenerate, or the application and this file will disagree.*

## Contents

1. [Getting started](#getting-started)
2. [How to read any page](#reading-a-page)
3. [Understanding an opportunity](#the-opportunity)
4. [Priority and score](#priority)
5. [Working your queue](#working-the-queue)
6. [What every module is for](#modules)
7. [Campaigns: acting on many at once](#campaigns)
8. [Ask Data](#ask-data)
9. [For administrators: tuning the system](#configuration)
10. [For integrators: getting data in](#uploading)
11. [Roles and what each one sees](#roles)
12. [Patient privacy: your responsibilities](#privacy)
13. [Troubleshooting](#troubleshooting)
14. [Glossary](#glossary)

---

<a id="getting-started"></a>

## Getting started

*Your first five minutes.*

1. **Sign in** — Use your work email address and password. Your session lasts twelve hours, after which you will be asked to sign in again — this is deliberate, because the system holds patient data and an unattended signed-in screen is a real risk.
2. **Notice where you landed** — You are not taken to the same page as everyone else. The system opens on the screen your role actually works from: a care navigator lands on their queue, an RCM specialist on insurance recovery, an auditor on the audit trail. A director lands on the executive dashboard.
3. **Look at your sidebar** — It shows only what you have permission to open. If a colleague mentions a module you cannot see, that is your role, not a fault — the system never shows a link that would refuse you.
4. **Check your scope** — Under your name in the sidebar is the data you can see: one hospital, several, or group-wide. Every number on every page is already filtered to that scope. You are never looking at another hospital's patients without knowing it.

> [!NOTE]
> **Dark mode and mobile**
>
> The theme toggle sits at the bottom of the sidebar and remembers your choice. Every screen works on a phone — the sidebar collapses to a menu and tables scroll sideways — because a fair amount of this work happens away from a desk.

---

<a id="reading-a-page"></a>

## How to read any page

*Four elements repeat everywhere. Learn them once.*

**The question under the title**

Every page states, in blue under its heading, the operational question it exists to answer. If the question is not one you are asking, you are probably on the wrong page — use it to navigate rather than guessing from the module name.

**The data source bar**

A thin strip above the content naming the source applications behind that page. Collapsed by default. Expand it to see when each feed last loaded, how many records arrived and whether quality checks are passing.

**KPI tiles**

The numbers along the top. Where a comparison is available, the tile shows the change against the prior period, coloured by whether that direction is good — which is not always up. Most tiles are clickable and take you to the list behind the number.

**The list**

The working part of the page. Sorted by priority by default, filterable along the top. Click any row to open the opportunity in full.

> [!WARNING]
> **When the data source bar turns amber**
>
> It means a feed this page depends on has stopped, is running late, or is failing its quality checks — and the figures on the page are probably understated. This matters because a page looks completely normal when a feed dies: opportunities simply stop being created and nothing announces it. If you see amber, expand the bar, read which feed it is, and tell whoever owns the integration before you act on the numbers.

---

<a id="the-opportunity"></a>

## Understanding an opportunity

*The record you will spend most of your time in.*

An opportunity is a specific patient situation that someone should do something about. The system currently detects them with 33 rules across 8 categories: Laboratory, Surgical, Medication, Insurance recovery, Patient reactivation, Appointment & follow-up, Referral, Service-line growth.

Open one and you get the whole story on a single screen, in the order you need it:

1. **Who and what** — the patient, the hospital and department, and what kind of opportunity this is.
2. **Why it was raised** — the evidence. The actual result, claim, gap or lapse that caused the rule to fire, with dates.
3. **Why it is ranked where it is** — the score, broken down factor by factor.
4. **What to do** — the recommended action and channel, which you can follow or override.
5. **What has happened so far** — every action anyone has taken, with who and when.

> [!IMPORTANT]
> **The recommendation is a suggestion, and you are the decision-maker**
>
> For clinical opportunities in particular: the system surfaces a situation and names the rule that raised it. It does not make clinical decisions, and it is not trying to. If your judgement says this is not appropriate for this patient, reject it and record the reason. That is a correct use of the system, not a failure to comply with it — and the rejection reasons are read directly by the people who tune the rules.

---

<a id="priority"></a>

## Priority and score

*What the number means and when to distrust it.*

Every opportunity carries a score from 0 to 100 and a band: **Critical**, **High**, **Medium** or **Low**. The band is what the queue sorts by. The score is how it got there, and you can always see the breakdown.

The score combines clinical urgency, how likely the patient is to convert, financial value, how time-critical it is, how engaged the patient has been, their history, service availability, insurance status and proximity. Clinical urgency carries the most weight. Your administrator can change those weights, so if the ranking consistently feels wrong, that is a conversation worth having rather than something to work around.

> [!NOTE]
> **When priority does not match the score**
>
> Occasionally you will see a Critical opportunity with a middling score. That is a clinical safety floor: certain rules declare a minimum priority that cannot be scored away. The detail page says so explicitly when it happens. A floor can only raise a priority, never lower one.

Treat the ranking as a well-informed starting order, not an instruction. It knows the data; it does not know that this patient's daughter called yesterday.

---

<a id="working-the-queue"></a>

## Working your queue

*The core loop, for anyone whose job is to act on opportunities.*

1. **Open My Work Queue** — Everything assigned to you, ordered by priority with the overdue ones marked. Work top down. Anything past its SLA shows in red, and clearing those first is almost always right.
2. **Read before you act** — Open the opportunity and read the evidence and the explanation. Thirty seconds here prevents the call where you cannot answer "why are you ringing me".
3. **Take the action** — Call, message, schedule, or route it onward. Use the recommended action unless you have reason not to.
4. **Log what happened — including nothing** — Record the action and its outcome. "No answer" is a real outcome and worth logging: three unanswered calls is information about that patient, and if you do not record them the system will keep telling you to ring.
5. **Move the status or close it** — Move it forward if it progressed, or close it. If it was not appropriate, reject it with a reason. Leaving work open that will never move makes every queue metric lie.

An opportunity moves through these stages: Detected → Reviewed → Assigned → Contacted → Appointment scheduled → Patient returned → Treatment completed → Converted. You do not have to move through every one — skipping straight to Converted when a patient books on the first call is normal and correct.

> [!WARNING]
> **Two people, one patient**
>
> The system works hard to ensure a patient never appears in two queues for the same problem. If you find that happening, report it — it usually means two rules need a handoff between them, and it is a defect worth fixing rather than an inconvenience to absorb.

---

<a id="modules"></a>

## What every module is for

*The whole application, one line each. You will see the subset your role allows.*

| Module | Group | What it is for |
|---|---|---|
| **Executive Dashboard** | Command | Where the biggest opportunities are today, group-wide or for your hospital. |
| **Opportunity Center** | Command | Every opportunity in one filterable, ranked list. The place to go when you know what you are looking for. |
| **My Work Queue** | Command | Your own assigned work, ordered by what needs attention first. This is the screen most people live in. |
| **Patient Opportunities** | Opportunity types | Opportunities grouped by patient, so you can see everything about one person before you call them. |
| **Revenue Opportunities** | Opportunity types | Opportunities with a financial dimension, ranked by recoverable value. |
| **Clinical Opportunities** | Opportunity types | Laboratory, surgical and medication opportunities — clinical situations needing a qualified eye. |
| **Service-Line Growth** | Opportunity types | Where a service line is under-performing against its own history or its peers. |
| **Insurance Recovery** | Opportunity types | Rejected and underpaid claims, grouped by recovery pathway. |
| **Patient Reactivation** | Opportunity types | Patients who have lapsed and are worth bringing back. |
| **Follow-up & Treatment Gaps** | Opportunity types | Recommended follow-ups that never happened, and treatment courses left incomplete. |
| **Campaigns / Actions** | Act & analyse | Grouped outreach across many opportunities at once, with approval before anything launches. |
| **Analytics** | Act & analyse | How the pipeline is performing: conversion, cycle time, value realised, by rule and by owner. |
| **Ask Data** | Act & analyse | Ask the hospital data a question in plain language instead of waiting for a report. |
| **Hospitals** | Organisation | Hospital-by-hospital comparison, and a single hospital in depth. |
| **Departments** | Organisation | Departmental performance and opportunity load. |
| **Physicians** | Organisation | Physician-level patterns — referral conversion, follow-up completion. |
| **Integration Overview** | Data & integration | How data reaches the platform, and whether it is arriving. |
| **Source Systems** | Data & integration | The external systems connected to the platform. |
| **Ingestion Pipelines** | Data & integration | Every feed, its schedule, its last run and its reject rate. |
| **Field Mapping** | Data & integration | How a source system's columns map onto the platform's fields. |
| **Upload Data** | Data & integration | Validate a data file, review what it would do, then commit it. |
| **Lineage Map** | Data & integration | Which source application feeds which page, in both directions. |
| **Data Quality** | Data & integration | Whether the data that loaded is good enough to drive the rules. |
| **Opportunity Rules** | Configuration | The detection rules, their parameters, and what each one is looking for. |
| **Administration** | Configuration | Users, roles, scoring weights and priority thresholds. |
| **Audit & Governance** | Configuration | Who did what, who saw which patient, and every question asked of the data. |
| **Help & Documentation** | Help | This section. The manual and the architecture document, with a starting point chosen for your role. |
| **User Manual** | Help | This document — how to use the platform day to day. |
| **Architecture & Integration** | Help | How the platform is built, and the full contract for connecting a source system to it. |

*Generated from the live navigation, so it cannot omit a module.*

---

<a id="campaigns"></a>

## Campaigns: acting on many at once

*When one-by-one outreach is the wrong tool.*

A campaign groups many similar opportunities into one piece of outreach — every lapsed diabetic patient at one hospital, say — so they can be worked as a batch and measured as a batch.

1. **Build the audience** — Filter the Opportunity Center to exactly the group you mean, then create a campaign from that selection.
2. **Choose the channel and message** — Phone, SMS, email or WhatsApp. Patients without marketing consent are excluded automatically and you cannot override that.
3. **Get it approved** — A campaign cannot launch without someone holding campaign approval. This is deliberate: bulk outreach to patients is not a decision one person should be able to make alone.
4. **Track it** — Reach, response, conversion and realised value, attributed back to the individual opportunities so you can see which parts of the audience actually responded.

---

<a id="ask-data"></a>

## Ask Data

*Questions in plain language, answered within your own scope.*

Type a question the way you would ask a colleague — "how many critical lab opportunities are open at Riyadh", "which department converted best last month". You get a table back, and if you have the technical permission, the SQL that produced it.

- Answers are restricted to your hospital scope. You cannot ask your way around a permission.
- Patient-identifying columns stay masked unless your role allows unmasked access.
- Results are capped, so an over-broad question returns a sample rather than everything.
- If it does not understand, it says so rather than guessing. A confidently wrong answer would be far worse than an honest refusal.
- Every question and every query it runs is recorded in the audit trail — not to police you, but because an AI feature nobody can review afterwards has no place in a system holding patient data.

> [!NOTE]
> Ask Data is for questions, not for actions. It will tell you which opportunities match something; it will not assign, contact or close them. Take the answer back to the Opportunity Center to act on it.

---

<a id="configuration"></a>

## For administrators: tuning the system

*What you can change without a developer, and what to watch afterwards.*

**Rule parameters**

Under **Opportunity Rules**, every one of the 33 rules exposes its thresholds — days overdue, minimum values, lapse windows — with an explanation of what each does. Changing one changes what the system detects from the next run. Every change is recorded with your name against it.

**Enabling and disabling rules**

A rule that consistently produces work your teams reject is doing harm. Disable it, or tighten its parameters, rather than asking people to ignore it. Queue trust is difficult to rebuild once lost.

**Scoring weights**

Under **Administration**. Weights are relative and need not sum to a hundred. Change one thing at a time and watch the priority distribution afterwards — it is easy to make everything Critical, which is the same as making nothing Critical.

**Priority thresholds**

The score boundaries between bands are configurable too. If your teams have capacity for more Critical work, lowering the threshold is a legitimate lever and safer than inflating weights.

> [!WARNING]
> **After any change, look at the distribution**
>
> The single most useful health check is the spread of findings across rules. If one rule is producing half the pipeline, it is not a good rule — it is firing on something too common to be actionable, and it will drown everything else in the queue.

---

<a id="uploading"></a>

## For integrators: getting data in

*9 feeds, and a dry run before anything is committed.*

1. **Download the template** — From **Upload Data**, pick the feed and download its CSV template. It carries the exact expected header, so a file built from it cannot have a column mismatch.
2. **Validate first** — Upload and review. Nothing is written yet. You see what would be created, what would be updated, and every issue with its row number and reason.
3. **Fix and repeat** — A file missing a required column is refused whole rather than partially loaded — a partial load is far more expensive to find later than a rejected file.
4. **Commit** — When the dry run is clean, commit. Loads are idempotent, so re-uploading the same file updates rather than duplicates. Replaying a file is always safe.
5. **Check quality afterwards** — A clean load is not the same as usable data. Run the quality checks and read the result — a feed can load perfectly and still fail to drive a single rule.

- [Integration guidelines](/help/architecture) — The full contract, in the architecture document
- [Upload Data](/integration/upload) — Templates, validation and commit

---

<a id="roles"></a>

## Roles and what each one sees

*11 roles. Yours is shown under your name in the sidebar.*

| Role | Scope | What it is for |
|---|---|---|
| **Group CEO** | Group-wide | Group-wide KPIs, opportunity pipeline, hospital comparison, executive alerts. |
| **Group COO** | Group-wide | Operational performance, opportunity pipeline, action tracking, conversion and revenue recovery. |
| **Group Chief Medical Officer** | Group-wide | Clinical opportunities, treatment gaps, follow-up cohorts, chronic care and clinical safety indicators. |
| **General Director** | One hospital | Hospital command centre: today’s opportunities, priorities, potential revenue, conversion funnel. |
| **Executive Director** | One hospital | Department and physician performance, opportunity aging, assignment and conversion status. |
| **Department Manager** | One department | Departmental work queue, assignment and conversion of owned opportunities. |
| **Care Navigator** | One hospital | Front-line outreach: claims opportunities from the work queue, contacts patients, books appointments. |
| **Revenue Cycle Specialist** | One hospital | Insurance recovery: rejection triage, resubmission, documentation and financial counselling. |
| **Data Analyst** | Group-wide | Analytics and natural-language data access, including the generated SQL. No patient identifiers. |
| **Platform Administrator** | Group-wide | Rules, scoring weights, alerts, users and detection runs. Configuration only — no PHI. |
| **Compliance Auditor** | Group-wide | Read-only access to audit trails, AI interaction logs and SQL execution history. |

If you need access you do not have, ask an administrator rather than borrowing a colleague's account. Every action is recorded against the signed-in user, so shared credentials make the audit trail useless precisely when it matters most.

---

<a id="privacy"></a>

## Patient privacy: your responsibilities

*Short, and genuinely important.*

- You see patient identity only where your role needs it to do its job. Analytical and executive roles see masked initials and age bands — that is minimum-necessary access working correctly, not a missing feature.
- Every time patient-level data is opened, it is logged with your name against it. This is normal and expected; it exists so that a genuine breach can be investigated.
- Export only what you need for the task in front of you, and treat the export as patient data the moment it leaves the system.
- Never paste patient identifiers into a tool outside this platform. That includes chat, email and search.
- Sign out on shared machines. The twelve-hour session is generous and is not a substitute for closing the door.

---

<a id="troubleshooting"></a>

## Troubleshooting

*The five things people actually ask.*

**"A page is empty"**

Usually scope: your role may cover one hospital and the opportunities are in another. Check the scope line under your name. If the scope is right and the page is still empty, expand the data source bar — a stalled feed produces an empty page rather than an error.

**"It says I am not allowed"**

The refusal page names the exact permission required. Send that name to your administrator; it is the fastest way to get the right access rather than a guess at it.

**"The numbers changed since this morning"**

Detection runs in batches. New opportunities appear at the next run, and resolved ones are closed automatically when the underlying problem clears — a patient who came in overnight removes their own opportunity.

**"This figure disagrees with the HIS"**

The HIS is right. This platform holds a derived working copy for prioritisation, and it is always at least slightly behind. Check the data source bar for when that feed last loaded before escalating.

**"An opportunity makes no sense for this patient"**

Reject it and record the reason. That is the intended path, and rejection reasons are exactly what the people tuning the rules read. Silently ignoring it means the rule keeps producing work like it forever.

---

<a id="glossary"></a>

## Glossary

**Opportunity**

A specific patient situation someone should act on, with an owner, a priority and a lifecycle.

**Category**

The kind of opportunity. One of 8: Laboratory, Surgical, Medication, Insurance recovery, Patient reactivation, Appointment & follow-up, Referral, Service-line growth.

**Rule**

The named piece of logic that detected it. Always visible on the opportunity, never hidden behind a model.

**Score and band**

A 0–100 ranking and its priority band, with a factor-by-factor explanation.

**SLA**

The time by which an opportunity should have been acted on. Turns red when passed.

**Conversion**

The patient returned and the care happened. The outcome the whole system is measured on.

**Realised value**

Value actually delivered, as opposed to the potential value estimated at detection.

**Feed**

One stream of data from a source system. There are 9.

**Scope**

The hospitals your role lets you see. Applied to every page before you see it.

**PHI**

Protected health information — anything identifying a patient. Masked unless your role needs it.
