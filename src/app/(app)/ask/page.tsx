import { guard } from '@/lib/guard'
import { can } from '@/lib/rbac'
import { prisma } from '@/lib/db'
import { EXAMPLE_QUESTIONS } from '@/lib/nlsql'
import { dateTime } from '@/lib/format'
import { PageHeader, Card, SectionHeader, TableShell } from '@/components/ui'
import { AskData } from '@/components/client/AskData'

export const dynamic = 'force-dynamic'

export default async function AskDataPage() {
  const principal = await guard('askdata.use')
  const canViewSql = can(principal, 'askdata.viewsql')

  // The user's own recent questions, so the interaction log is visible to the
  // person it is about rather than only to auditors.
  const recent = await prisma.nlQuery.findMany({
    where: { userId: principal.userId },
    orderBy: { askedAt: 'desc' },
    take: 10,
    select: {
      id: true, question: true, askedAt: true, validation: true,
      rowCount: true, durationMs: true, engine: true,
    },
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ask Data"
        question="What do you want to know about the hospital data?"
        description="Ask in plain language. The engine resolves the question to a validated read-only query, runs it inside your access scope, and explains what came back."
      />

      <AskData examples={EXAMPLE_QUESTIONS} canViewSql={canViewSql} />

      <Card>
        <SectionHeader
          title="How this works"
          description="Natural language → SQL → validation → execution → result → visualisation → explanation."
        />
        <ol className="space-y-2.5 text-sm text-ink-600 dark:text-ink-300">
          <li className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-2xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
              1
            </span>
            <span>
              <strong className="font-medium text-ink-900 dark:text-ink-100">Interpretation.</strong>{' '}
              Your question is matched against the Ask Data semantic model. The reading the engine
              settled on is always shown, so you can tell whether it understood you before you act on
              the number.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-2xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
              2
            </span>
            <span>
              <strong className="font-medium text-ink-900 dark:text-ink-100">Validation.</strong> The
              generated query is checked before it reaches the database: read-only, a single
              statement, no comments, only tables in the semantic model, and always row-bounded.
              Credentials, sessions and the audit trail itself are never queryable.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-2xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
              3
            </span>
            <span>
              <strong className="font-medium text-ink-900 dark:text-ink-100">Scope.</strong> Your
              hospital access is bound into the query as a parameter, not appended afterwards. A
              question cannot widen what you are entitled to see.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-2xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
              4
            </span>
            <span>
              <strong className="font-medium text-ink-900 dark:text-ink-100">Audit.</strong> Every
              question is recorded — the text, the interpretation, the validation outcome, the row
              count and the engine — whether it succeeded or was blocked.
            </span>
          </li>
        </ol>
        {!canViewSql && (
          <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
            The generated SQL is shown to roles holding the askdata.viewsql permission. Your role
            sees the interpretation and explanation instead.
          </p>
        )}
      </Card>

      {recent.length > 0 && (
        <Card>
          <SectionHeader
            title="Your recent questions"
            description="Your own interaction log, as recorded for audit."
          />
          <TableShell
            head={
              <>
                <th className="th">Question</th>
                <th className="th">Asked</th>
                <th className="th">Validation</th>
                <th className="th text-right">Rows</th>
                <th className="th text-right">Duration</th>
              </>
            }
          >
            {recent.map((q) => (
              <tr key={q.id}>
                <td className="td max-w-md">
                  <span className="block truncate">{q.question}</span>
                </td>
                <td className="td whitespace-nowrap text-xs text-ink-500">{dateTime(q.askedAt)}</td>
                <td className="td">
                  <span
                    className={
                      q.validation === 'PASSED'
                        ? 'chip border-positive-100 bg-positive-50 text-positive-700 dark:border-positive-900 dark:bg-positive-900/40 dark:text-positive-100'
                        : 'chip border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700 dark:bg-warn-700/20'
                    }
                  >
                    {q.validation}
                  </span>
                </td>
                <td className="td tabular text-right">{q.rowCount}</td>
                <td className="td tabular text-right text-xs text-ink-500">{q.durationMs} ms</td>
              </tr>
            ))}
          </TableShell>
        </Card>
      )}
    </div>
  )
}
