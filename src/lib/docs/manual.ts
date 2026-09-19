import type { DocDefinition } from './types'
import { NAVIGATION } from '../navigation'
import { ROLES } from '../rbac'
import { RULE_CATALOGUE } from '../detection/rules'
import { DOMAINS } from '../ingestion/domains'
import {
  OPPORTUNITY_CATEGORIES,
  CATEGORY_LABEL,
  FUNNEL_STAGES,
  STATUS_LABEL,
} from '../enums'

/**
 * The user manual.
 *
 * Written for the people who work the queue, not for the people who build it.
 * Where the architecture document explains *why the system is shaped this
 * way*, this one answers *what do I do on Tuesday morning* — and the module
 * table is derived from the real navigation so a new module cannot be missing
 * from the manual.
 */

/** What each module is for, in the words its reader would use. */
const MODULE_PURPOSE: Record<string, string> = {
  '/': 'Where the biggest opportunities are today, group-wide or for your hospital.',
  '/opportunities': 'Every opportunity in one filterable, ranked list. The place to go when you know what you are looking for.',
  '/queue': 'Your own assigned work, ordered by what needs attention first. This is the screen most people live in.',
  '/patients': 'Opportunities grouped by patient, so you can see everything about one person before you call them.',
  '/revenue': 'Opportunities with a financial dimension, ranked by recoverable value.',
  '/clinical': 'Laboratory, surgical and medication opportunities — clinical situations needing a qualified eye.',
  '/service-lines': 'Where a service line is under-performing against its own history or its peers.',
  '/insurance': 'Rejected and underpaid claims, grouped by recovery pathway.',
  '/reactivation': 'Patients who have lapsed and are worth bringing back.',
  '/follow-up': 'Recommended follow-ups that never happened, and treatment courses left incomplete.',
  '/campaigns': 'Grouped outreach across many opportunities at once, with approval before anything launches.',
  '/analytics': 'How the pipeline is performing: conversion, cycle time, value realised, by rule and by owner.',
  '/ask': 'Ask the hospital data a question in plain language instead of waiting for a report.',
  '/hospitals': 'Hospital-by-hospital comparison, and a single hospital in depth.',
  '/departments': 'Departmental performance and opportunity load.',
  '/physicians': 'Physician-level patterns — referral conversion, follow-up completion.',
  '/integration': 'How data reaches the platform, and whether it is arriving.',
  '/integration/sources': 'The external systems connected to the platform.',
  '/integration/pipelines': 'Every feed, its schedule, its last run and its reject rate.',
  '/integration/mapping': 'How a source system\'s columns map onto the platform\'s fields.',
  '/integration/upload': 'Validate a data file, review what it would do, then commit it.',
  '/integration/lineage': 'Which source application feeds which page, in both directions.',
  '/integration/quality': 'Whether the data that loaded is good enough to drive the rules.',
  '/rules': 'The detection rules, their parameters, and what each one is looking for.',
  '/admin': 'Users, roles, scoring weights and priority thresholds.',
  '/audit': 'Who did what, who saw which patient, and every question asked of the data.',
  '/help': 'This section. The manual and the architecture document, with a starting point chosen for your role.',
  '/help/manual': 'This document — how to use the platform day to day.',
  '/help/architecture': 'How the platform is built, and the full contract for connecting a source system to it.',
}

const moduleRows = NAVIGATION.flatMap((group) =>
  group.items.map((item) => [
    `**${item.label}**`,
    group.title,
    MODULE_PURPOSE[item.href] ?? item.hint ?? '—',
  ])
)

/** Scope levels in the words a reader would use. */
const SCOPE_LABEL: Record<string, string> = {
  GROUP: 'Group-wide',
  MULTI_HOSPITAL: 'Several hospitals',
  HOSPITAL: 'One hospital',
  DEPARTMENT: 'One department',
}

export const USER_MANUAL_DOC: DocDefinition = {
  slug: 'manual',
  title: 'User Manual',
  question: 'How do I use this system to get through my day?',
  description:
    'Signing in, reading an opportunity, working your queue, and what every module is for. Start at the beginning on your first day; after that, jump to the section you need.',
  audience:
    'Everyone who uses the platform — care navigators, RCM specialists, department managers, directors and analysts.',
  sections: [
    // ───────────────────────────────────────────────── getting started
    {
      id: 'getting-started',
      title: 'Getting started',
      summary: 'Your first five minutes.',
      blocks: [
        {
          kind: 'steps',
          items: [
            {
              title: 'Sign in',
              body: 'Use your work email address and password. Your session lasts twelve hours, after which you will be asked to sign in again — this is deliberate, because the system holds patient data and an unattended signed-in screen is a real risk.',
            },
            {
              title: 'Notice where you landed',
              body: 'You are not taken to the same page as everyone else. The system opens on the screen your role actually works from: a care navigator lands on their queue, an RCM specialist on insurance recovery, an auditor on the audit trail. A director lands on the executive dashboard.',
            },
            {
              title: 'Look at your sidebar',
              body: 'It shows only what you have permission to open. If a colleague mentions a module you cannot see, that is your role, not a fault — the system never shows a link that would refuse you.',
            },
            {
              title: 'Check your scope',
              body: 'Under your name in the sidebar is the data you can see: one hospital, several, or group-wide. Every number on every page is already filtered to that scope. You are never looking at another hospital\'s patients without knowing it.',
            },
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          title: 'Dark mode and mobile',
          body: 'The theme toggle sits at the bottom of the sidebar and remembers your choice. Every screen works on a phone — the sidebar collapses to a menu and tables scroll sideways — because a fair amount of this work happens away from a desk.',
        },
      ],
    },

    // ───────────────────────────────────────────────── reading a page
    {
      id: 'reading-a-page',
      title: 'How to read any page',
      summary: 'Four elements repeat everywhere. Learn them once.',
      blocks: [
        {
          kind: 'defs',
          items: [
            {
              term: 'The question under the title',
              body: 'Every page states, in blue under its heading, the operational question it exists to answer. If the question is not one you are asking, you are probably on the wrong page — use it to navigate rather than guessing from the module name.',
            },
            {
              term: 'The data source bar',
              body: 'A thin strip above the content naming the source applications behind that page. Collapsed by default. Expand it to see when each feed last loaded, how many records arrived and whether quality checks are passing.',
            },
            {
              term: 'KPI tiles',
              body: 'The numbers along the top. Where a comparison is available, the tile shows the change against the prior period, coloured by whether that direction is good — which is not always up. Most tiles are clickable and take you to the list behind the number.',
            },
            {
              term: 'The list',
              body: 'The working part of the page. Sorted by priority by default, filterable along the top. Click any row to open the opportunity in full.',
            },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          title: 'When the data source bar turns amber',
          body: 'It means a feed this page depends on has stopped, is running late, or is failing its quality checks — and the figures on the page are probably understated. This matters because a page looks completely normal when a feed dies: opportunities simply stop being created and nothing announces it. If you see amber, expand the bar, read which feed it is, and tell whoever owns the integration before you act on the numbers.',
        },
      ],
    },

    // ───────────────────────────────────────────────── the opportunity
    {
      id: 'the-opportunity',
      title: 'Understanding an opportunity',
      summary: 'The record you will spend most of your time in.',
      blocks: [
        {
          kind: 'text',
          body: `An opportunity is a specific patient situation that someone should do something about. The system currently detects them with ${RULE_CATALOGUE.length} rules across ${OPPORTUNITY_CATEGORIES.length} categories: ${OPPORTUNITY_CATEGORIES.map((c) => CATEGORY_LABEL[c]).join(', ')}.`,
        },
        {
          kind: 'text',
          body: 'Open one and you get the whole story on a single screen, in the order you need it:',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**Who and what** — the patient, the hospital and department, and what kind of opportunity this is.',
            '**Why it was raised** — the evidence. The actual result, claim, gap or lapse that caused the rule to fire, with dates.',
            '**Why it is ranked where it is** — the score, broken down factor by factor.',
            '**What to do** — the recommended action and channel, which you can follow or override.',
            '**What has happened so far** — every action anyone has taken, with who and when.',
          ],
        },
        {
          kind: 'note',
          tone: 'rule',
          title: 'The recommendation is a suggestion, and you are the decision-maker',
          body: 'For clinical opportunities in particular: the system surfaces a situation and names the rule that raised it. It does not make clinical decisions, and it is not trying to. If your judgement says this is not appropriate for this patient, reject it and record the reason. That is a correct use of the system, not a failure to comply with it — and the rejection reasons are read directly by the people who tune the rules.',
        },
      ],
    },

    // ───────────────────────────────────────────────── priority
    {
      id: 'priority',
      title: 'Priority and score',
      summary: 'What the number means and when to distrust it.',
      blocks: [
        {
          kind: 'text',
          body: 'Every opportunity carries a score from 0 to 100 and a band: **Critical**, **High**, **Medium** or **Low**. The band is what the queue sorts by. The score is how it got there, and you can always see the breakdown.',
        },
        {
          kind: 'text',
          body: 'The score combines clinical urgency, how likely the patient is to convert, financial value, how time-critical it is, how engaged the patient has been, their history, service availability, insurance status and proximity. Clinical urgency carries the most weight. Your administrator can change those weights, so if the ranking consistently feels wrong, that is a conversation worth having rather than something to work around.',
        },
        {
          kind: 'note',
          tone: 'info',
          title: 'When priority does not match the score',
          body: 'Occasionally you will see a Critical opportunity with a middling score. That is a clinical safety floor: certain rules declare a minimum priority that cannot be scored away. The detail page says so explicitly when it happens. A floor can only raise a priority, never lower one.',
        },
        {
          kind: 'text',
          body: 'Treat the ranking as a well-informed starting order, not an instruction. It knows the data; it does not know that this patient\'s daughter called yesterday.',
        },
      ],
    },

    // ───────────────────────────────────────────────── daily routine
    {
      id: 'working-the-queue',
      title: 'Working your queue',
      summary: 'The core loop, for anyone whose job is to act on opportunities.',
      blocks: [
        {
          kind: 'steps',
          items: [
            {
              title: 'Open My Work Queue',
              body: 'Everything assigned to you, ordered by priority with the overdue ones marked. Work top down. Anything past its SLA shows in red, and clearing those first is almost always right.',
            },
            {
              title: 'Read before you act',
              body: 'Open the opportunity and read the evidence and the explanation. Thirty seconds here prevents the call where you cannot answer "why are you ringing me".',
            },
            {
              title: 'Take the action',
              body: 'Call, message, schedule, or route it onward. Use the recommended action unless you have reason not to.',
            },
            {
              title: 'Log what happened — including nothing',
              body: 'Record the action and its outcome. "No answer" is a real outcome and worth logging: three unanswered calls is information about that patient, and if you do not record them the system will keep telling you to ring.',
            },
            {
              title: 'Move the status or close it',
              body: 'Move it forward if it progressed, or close it. If it was not appropriate, reject it with a reason. Leaving work open that will never move makes every queue metric lie.',
            },
          ],
        },
        {
          kind: 'text',
          body: `An opportunity moves through these stages: ${FUNNEL_STAGES.map((s) => STATUS_LABEL[s]).join(' → ')}. You do not have to move through every one — skipping straight to Converted when a patient books on the first call is normal and correct.`,
        },
        {
          kind: 'note',
          tone: 'warn',
          title: 'Two people, one patient',
          body: 'The system works hard to ensure a patient never appears in two queues for the same problem. If you find that happening, report it — it usually means two rules need a handoff between them, and it is a defect worth fixing rather than an inconvenience to absorb.',
        },
      ],
    },

    // ───────────────────────────────────────────────── modules
    {
      id: 'modules',
      title: 'What every module is for',
      summary: 'The whole application, one line each. You will see the subset your role allows.',
      blocks: [
        {
          kind: 'table',
          columns: ['Module', 'Group', 'What it is for'],
          rows: moduleRows,
          caption: 'Generated from the live navigation, so it cannot omit a module.',
        },
      ],
    },

    // ───────────────────────────────────────────────── campaigns
    {
      id: 'campaigns',
      title: 'Campaigns: acting on many at once',
      summary: 'When one-by-one outreach is the wrong tool.',
      blocks: [
        {
          kind: 'text',
          body: 'A campaign groups many similar opportunities into one piece of outreach — every lapsed diabetic patient at one hospital, say — so they can be worked as a batch and measured as a batch.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Build the audience', body: 'Filter the Opportunity Center to exactly the group you mean, then create a campaign from that selection.' },
            { title: 'Choose the channel and message', body: 'Phone, SMS, email or WhatsApp. Patients without marketing consent are excluded automatically and you cannot override that.' },
            { title: 'Get it approved', body: 'A campaign cannot launch without someone holding campaign approval. This is deliberate: bulk outreach to patients is not a decision one person should be able to make alone.' },
            { title: 'Track it', body: 'Reach, response, conversion and realised value, attributed back to the individual opportunities so you can see which parts of the audience actually responded.' },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────────── ask data
    {
      id: 'ask-data',
      title: 'Ask Data',
      summary: 'Questions in plain language, answered within your own scope.',
      blocks: [
        {
          kind: 'text',
          body: 'Type a question the way you would ask a colleague — "how many critical lab opportunities are open at Riyadh", "which department converted best last month". You get a table back, and if you have the technical permission, the SQL that produced it.',
        },
        {
          kind: 'list',
          items: [
            'Answers are restricted to your hospital scope. You cannot ask your way around a permission.',
            'Patient-identifying columns stay masked unless your role allows unmasked access.',
            'Results are capped, so an over-broad question returns a sample rather than everything.',
            'If it does not understand, it says so rather than guessing. A confidently wrong answer would be far worse than an honest refusal.',
            'Every question and every query it runs is recorded in the audit trail — not to police you, but because an AI feature nobody can review afterwards has no place in a system holding patient data.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          body: 'Ask Data is for questions, not for actions. It will tell you which opportunities match something; it will not assign, contact or close them. Take the answer back to the Opportunity Center to act on it.',
        },
      ],
    },

    // ───────────────────────────────────────────────── admin
    {
      id: 'configuration',
      title: 'For administrators: tuning the system',
      summary: 'What you can change without a developer, and what to watch afterwards.',
      blocks: [
        {
          kind: 'defs',
          items: [
            {
              term: 'Rule parameters',
              body: `Under **Opportunity Rules**, every one of the ${RULE_CATALOGUE.length} rules exposes its thresholds — days overdue, minimum values, lapse windows — with an explanation of what each does. Changing one changes what the system detects from the next run. Every change is recorded with your name against it.`,
            },
            {
              term: 'Enabling and disabling rules',
              body: 'A rule that consistently produces work your teams reject is doing harm. Disable it, or tighten its parameters, rather than asking people to ignore it. Queue trust is difficult to rebuild once lost.',
            },
            {
              term: 'Scoring weights',
              body: 'Under **Administration**. Weights are relative and need not sum to a hundred. Change one thing at a time and watch the priority distribution afterwards — it is easy to make everything Critical, which is the same as making nothing Critical.',
            },
            {
              term: 'Priority thresholds',
              body: 'The score boundaries between bands are configurable too. If your teams have capacity for more Critical work, lowering the threshold is a legitimate lever and safer than inflating weights.',
            },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          title: 'After any change, look at the distribution',
          body: 'The single most useful health check is the spread of findings across rules. If one rule is producing half the pipeline, it is not a good rule — it is firing on something too common to be actionable, and it will drown everything else in the queue.',
        },
      ],
    },

    // ───────────────────────────────────────────────── uploading
    {
      id: 'uploading',
      title: 'For integrators: getting data in',
      summary: `${DOMAINS.length} feeds, and a dry run before anything is committed.`,
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Download the template', body: 'From **Upload Data**, pick the feed and download its CSV template. It carries the exact expected header, so a file built from it cannot have a column mismatch.' },
            { title: 'Validate first', body: 'Upload and review. Nothing is written yet. You see what would be created, what would be updated, and every issue with its row number and reason.' },
            { title: 'Fix and repeat', body: 'A file missing a required column is refused whole rather than partially loaded — a partial load is far more expensive to find later than a rejected file.' },
            { title: 'Commit', body: 'When the dry run is clean, commit. Loads are idempotent, so re-uploading the same file updates rather than duplicates. Replaying a file is always safe.' },
            { title: 'Check quality afterwards', body: 'A clean load is not the same as usable data. Run the quality checks and read the result — a feed can load perfectly and still fail to drive a single rule.' },
          ],
        },
        {
          kind: 'links',
          items: [
            { href: '/help/architecture', label: 'Integration guidelines', body: 'The full contract, in the architecture document' },
            { href: '/integration/upload', label: 'Upload Data', body: 'Templates, validation and commit' },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────────── roles
    {
      id: 'roles',
      title: 'Roles and what each one sees',
      summary: `${ROLES.length} roles. Yours is shown under your name in the sidebar.`,
      blocks: [
        {
          kind: 'table',
          columns: ['Role', 'Scope', 'What it is for'],
          rows: ROLES.map((r) => [`**${r.name}**`, SCOPE_LABEL[r.scopeLevel] ?? r.scopeLevel, r.description]),
        },
        {
          kind: 'text',
          body: 'If you need access you do not have, ask an administrator rather than borrowing a colleague\'s account. Every action is recorded against the signed-in user, so shared credentials make the audit trail useless precisely when it matters most.',
        },
      ],
    },

    // ───────────────────────────────────────────────── privacy
    {
      id: 'privacy',
      title: 'Patient privacy: your responsibilities',
      summary: 'Short, and genuinely important.',
      blocks: [
        {
          kind: 'list',
          items: [
            'You see patient identity only where your role needs it to do its job. Analytical and executive roles see masked initials and age bands — that is minimum-necessary access working correctly, not a missing feature.',
            'Every time patient-level data is opened, it is logged with your name against it. This is normal and expected; it exists so that a genuine breach can be investigated.',
            'Export only what you need for the task in front of you, and treat the export as patient data the moment it leaves the system.',
            'Never paste patient identifiers into a tool outside this platform. That includes chat, email and search.',
            'Sign out on shared machines. The twelve-hour session is generous and is not a substitute for closing the door.',
          ],
        },
      ],
    },

    // ───────────────────────────────────────────────── troubleshooting
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      summary: 'The five things people actually ask.',
      blocks: [
        {
          kind: 'defs',
          items: [
            {
              term: '"A page is empty"',
              body: 'Usually scope: your role may cover one hospital and the opportunities are in another. Check the scope line under your name. If the scope is right and the page is still empty, expand the data source bar — a stalled feed produces an empty page rather than an error.',
            },
            {
              term: '"It says I am not allowed"',
              body: 'The refusal page names the exact permission required. Send that name to your administrator; it is the fastest way to get the right access rather than a guess at it.',
            },
            {
              term: '"The numbers changed since this morning"',
              body: 'Detection runs in batches. New opportunities appear at the next run, and resolved ones are closed automatically when the underlying problem clears — a patient who came in overnight removes their own opportunity.',
            },
            {
              term: '"This figure disagrees with the HIS"',
              body: 'The HIS is right. This platform holds a derived working copy for prioritisation, and it is always at least slightly behind. Check the data source bar for when that feed last loaded before escalating.',
            },
            {
              term: '"An opportunity makes no sense for this patient"',
              body: 'Reject it and record the reason. That is the intended path, and rejection reasons are exactly what the people tuning the rules read. Silently ignoring it means the rule keeps producing work like it forever.',
            },
          ],
        },
      ],
    },

    // ───────────────────────────────────────────────── glossary
    {
      id: 'glossary',
      title: 'Glossary',
      blocks: [
        {
          kind: 'defs',
          items: [
            { term: 'Opportunity', body: 'A specific patient situation someone should act on, with an owner, a priority and a lifecycle.' },
            { term: 'Category', body: `The kind of opportunity. One of ${OPPORTUNITY_CATEGORIES.length}: ${OPPORTUNITY_CATEGORIES.map((c) => CATEGORY_LABEL[c]).join(', ')}.` },
            { term: 'Rule', body: 'The named piece of logic that detected it. Always visible on the opportunity, never hidden behind a model.' },
            { term: 'Score and band', body: 'A 0–100 ranking and its priority band, with a factor-by-factor explanation.' },
            { term: 'SLA', body: 'The time by which an opportunity should have been acted on. Turns red when passed.' },
            { term: 'Conversion', body: 'The patient returned and the care happened. The outcome the whole system is measured on.' },
            { term: 'Realised value', body: 'Value actually delivered, as opposed to the potential value estimated at detection.' },
            { term: 'Feed', body: `One stream of data from a source system. There are ${DOMAINS.length}.` },
            { term: 'Scope', body: 'The hospitals your role lets you see. Applied to every page before you see it.' },
            { term: 'PHI', body: 'Protected health information — anything identifying a patient. Masked unless your role needs it.' },
          ],
        },
      ],
    },
  ],
}
