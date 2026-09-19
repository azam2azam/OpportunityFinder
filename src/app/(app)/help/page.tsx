import Link from 'next/link'
import { BookOpen, Blocks, ArrowRight } from 'lucide-react'
import { guard } from '@/lib/guard'
import { can } from '@/lib/rbac'
import { docStats } from '@/lib/docs/types'
import { ARCHITECTURE_DOC } from '@/lib/docs/architecture'
import { USER_MANUAL_DOC } from '@/lib/docs/manual'
import { PageHeader, Card, SectionHeader } from '@/components/ui'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Help & Documentation · Opportuna',
}

/**
 * The Help index.
 *
 * Two documents, and a starting point chosen for the reader's role. A help
 * page that opens with a search box assumes the reader knows what to search
 * for; on their first day they do not, so this names the three sections most
 * likely to be useful to them specifically.
 */
export default async function HelpIndex() {
  const principal = await guard('help.view')

  const docs = [
    {
      doc: USER_MANUAL_DOC,
      href: '/help/manual',
      icon: BookOpen,
      pitch:
        'How to sign in, read an opportunity, work your queue, and what every module is for. Start here on your first day.',
    },
    {
      doc: ARCHITECTURE_DOC,
      href: '/help/architecture',
      icon: Blocks,
      pitch:
        'The layers, the detection and scoring engines, the security model, and the full integration contract for connecting a source system.',
    },
  ]

  const starting = startingPoints(principal.roleKey, can(principal, 'integration.view'))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Help & Documentation"
        question="How does this system work, and how do I use it?"
        description="Two documents. The manual is for using the platform; the architecture document is for understanding and extending it."
      />

      <div className="grid gap-3 md:grid-cols-2">
        {docs.map(({ doc, href, icon: Icon, pitch }) => {
          const stats = docStats(doc)
          return (
            <Link
              key={href}
              href={href}
              className="card card-pad group flex flex-col transition-shadow hover:shadow-raised"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                    {doc.title}
                  </h2>
                  <p className="mt-0.5 text-2xs text-ink-400 dark:text-ink-500">
                    {stats.sections} sections · about {stats.minutes} min to read
                  </p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 dark:text-ink-600" />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-400">{pitch}</p>
              <p className="mt-3 border-t border-ink-100 pt-3 text-2xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
                <span className="label">Written for</span>
                <span className="mt-0.5 block normal-case tracking-normal">{doc.audience}</span>
              </p>
            </Link>
          )
        })}
      </div>

      <Card>
        <SectionHeader
          title="Start here"
          description={`Chosen for your role — ${principal.roleName}.`}
        />
        <ol className="space-y-2.5">
          {starting.map((s, i) => (
            <li key={s.href} className="flex gap-3">
              <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-2xs font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                {i + 1}
              </span>
              <div className="min-w-0">
                <Link
                  href={s.href}
                  className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
                >
                  {s.label}
                </Link>
                <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-400">{s.why}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <SectionHeader
          title="Also available outside the application"
          description="The same two documents are published to the repository for people who do not have an account here."
        />
        <p className="max-w-[72ch] text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          Both are generated from the same source as these pages by{' '}
          <code className="rounded border border-ink-200 bg-ink-100 px-1 py-0.5 text-[0.85em] dark:border-ink-700 dark:bg-ink-800">
            npm run docs:generate
          </code>
          , which writes <code className="rounded border border-ink-200 bg-ink-100 px-1 py-0.5 text-[0.85em] dark:border-ink-700 dark:bg-ink-800">docs/ARCHITECTURE.md</code>{' '}
          and <code className="rounded border border-ink-200 bg-ink-100 px-1 py-0.5 text-[0.85em] dark:border-ink-700 dark:bg-ink-800">docs/USER-MANUAL.md</code>. They cannot
          drift from what you are reading here, because there is only one copy of the content.
        </p>
      </Card>
    </div>
  )
}

interface StartingPoint {
  href: string
  label: string
  why: string
}

/**
 * Role-aware entry points.
 *
 * The section someone needs first depends entirely on what they were hired to
 * do, and a generic "read the manual" helps nobody. Falls back to the
 * operational path, which is right for the majority of accounts.
 */
function startingPoints(roleKey: string, integrator: boolean): StartingPoint[] {
  const workingTheQueue: StartingPoint = {
    href: '/help/manual#working-the-queue',
    label: 'Working your queue',
    why: 'The core loop: read the evidence, act, log what happened — including when nothing happened.',
  }
  const understanding: StartingPoint = {
    href: '/help/manual#the-opportunity',
    label: 'Understanding an opportunity',
    why: 'What the central record holds and why it was raised.',
  }
  const priority: StartingPoint = {
    href: '/help/manual#priority',
    label: 'Priority and score',
    why: 'What the ranking means, and when to trust your own judgement over it.',
  }

  if (integrator) {
    return [
      {
        href: '/help/architecture#integration-principles',
        label: 'Integration principles',
        why: 'Six rules that hold for every connector. Read before designing one.',
      },
      {
        href: '/help/architecture#integration-feeds',
        label: 'The feed contracts',
        why: 'Every feed, its target entity and its natural key, generated from the loader itself.',
      },
      {
        href: '/help/architecture#integration-new-feed',
        label: 'Adding a feed',
        why: 'The six-step checklist, one file per step.',
      },
    ]
  }

  switch (roleKey) {
    case 'GROUP_CEO':
    case 'GROUP_COO':
    case 'GROUP_CMO':
    case 'GENERAL_DIRECTOR':
    case 'EXECUTIVE_DIRECTOR':
      return [
        {
          href: '/help/manual#reading-a-page',
          label: 'How to read any page',
          why: 'Four elements repeat across the whole product, including the bar that tells you when a figure is understated.',
        },
        priority,
        {
          href: '/help/architecture#purpose',
          label: 'What this system is',
          why: 'Why it is an opportunity system rather than a dashboard, and what that buys you.',
        },
      ]
    case 'DATA_ANALYST':
      return [
        {
          href: '/help/manual#ask-data',
          label: 'Ask Data',
          why: 'Plain-language questions, and the limits of what it will answer.',
        },
        {
          href: '/help/architecture#scoring',
          label: 'Scoring engine',
          why: 'The factors, their weights and how a score is explained.',
        },
        understanding,
      ]
    case 'PLATFORM_ADMIN':
      return [
        {
          href: '/help/manual#configuration',
          label: 'Tuning the system',
          why: 'Rule parameters, scoring weights and thresholds — and what to check afterwards.',
        },
        {
          href: '/help/architecture#detection',
          label: 'Detection engine',
          why: 'How rules fire, hand off to each other, and reconcile.',
        },
        {
          href: '/help/architecture#security',
          label: 'Security and governance',
          why: 'Roles, scope, PHI masking and the audit trail.',
        },
      ]
    case 'AUDITOR':
      return [
        {
          href: '/help/architecture#security',
          label: 'Security and governance',
          why: 'Every control and where it is enforced.',
        },
        {
          href: '/help/manual#privacy',
          label: 'Patient privacy',
          why: 'What is masked, what is logged, and what users are told about it.',
        },
        {
          href: '/help/architecture#ask-data',
          label: 'Ask Data safeguards',
          why: 'How natural-language queries are constrained and recorded.',
        },
      ]
    default:
      return [understanding, workingTheQueue, priority]
  }
}
