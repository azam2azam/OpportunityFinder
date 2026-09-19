'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

/**
 * The action panel on an opportunity.
 *
 * Only actions that make sense from the current status are offered. Showing
 * "Schedule appointment" on an opportunity nobody has contacted yet invites a
 * lifecycle that does not reflect what happened, and the funnel then lies about
 * where work is being lost.
 */

interface ActionOption {
  type: string
  label: string
  /** Status this action moves the opportunity into, if any. */
  toStatus?: string
  /** Statuses from which this action is offered; empty means always. */
  from?: string[]
  needsNote?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
}

const CLINICAL_OUTREACH: ActionOption[] = [
  { type: 'REVIEW', label: 'Mark reviewed', toStatus: 'REVIEWED', from: ['DETECTED'] },
  { type: 'ASSIGN', label: 'Claim this opportunity', toStatus: 'ASSIGNED', from: ['DETECTED', 'REVIEWED'] },
  { type: 'CALL', label: 'Log phone call', toStatus: 'CONTACTED', from: ['ASSIGNED', 'REVIEWED', 'CONTACTED'], needsNote: true },
  { type: 'SMS', label: 'Log SMS sent', toStatus: 'CONTACTED', from: ['ASSIGNED', 'REVIEWED', 'CONTACTED'] },
  { type: 'PHYSICIAN_REVIEW', label: 'Refer for physician review', from: ['ASSIGNED', 'REVIEWED', 'CONTACTED'], needsNote: true },
  {
    type: 'SCHEDULE_APPOINTMENT',
    label: 'Appointment scheduled',
    toStatus: 'APPOINTMENT_SCHEDULED',
    from: ['CONTACTED'],
  },
  { type: 'STATUS_CHANGE', label: 'Patient attended', toStatus: 'PATIENT_RETURNED', from: ['APPOINTMENT_SCHEDULED'] },
  {
    type: 'STATUS_CHANGE',
    label: 'Treatment completed',
    toStatus: 'TREATMENT_COMPLETED',
    from: ['PATIENT_RETURNED'],
  },
  { type: 'STATUS_CHANGE', label: 'Convert', toStatus: 'CONVERTED', from: ['TREATMENT_COMPLETED', 'PATIENT_RETURNED'], tone: 'primary' },
]

const FINANCIAL: ActionOption[] = [
  { type: 'REVIEW', label: 'Mark reviewed', toStatus: 'REVIEWED', from: ['DETECTED'] },
  { type: 'ASSIGN', label: 'Claim this opportunity', toStatus: 'ASSIGNED', from: ['DETECTED', 'REVIEWED'] },
  { type: 'CORRECT_CODING', label: 'Coding corrected', from: ['ASSIGNED', 'REVIEWED'], needsNote: true },
  { type: 'OBTAIN_DOCUMENTATION', label: 'Documentation obtained', from: ['ASSIGNED', 'REVIEWED'], needsNote: true },
  { type: 'RESUBMIT_CLAIM', label: 'Claim resubmitted', toStatus: 'CONTACTED', from: ['ASSIGNED', 'REVIEWED', 'CONTACTED'], needsNote: true },
  { type: 'FINANCIAL_COUNSELLING', label: 'Financial counselling offered', toStatus: 'CONTACTED', from: ['ASSIGNED', 'REVIEWED', 'CONTACTED'], needsNote: true },
  { type: 'STATUS_CHANGE', label: 'Payment recovered', toStatus: 'CONVERTED', from: ['CONTACTED'], tone: 'primary' },
]

const ALWAYS: ActionOption[] = [{ type: 'NOTE', label: 'Add note', needsNote: true }]

const CLOSERS: ActionOption[] = [
  { type: 'CLOSE', label: 'Close — not applicable', toStatus: 'NOT_APPLICABLE', needsNote: true, tone: 'secondary' },
  { type: 'CLOSE', label: 'Close — rejected', toStatus: 'REJECTED', needsNote: true, tone: 'danger' },
]

export function ActionPanel({
  opportunityId,
  status,
  category,
  closed,
  canClose,
  canAssign,
}: {
  opportunityId: string
  status: string
  category: string
  closed: boolean
  canClose: boolean
  canAssign: boolean
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const financial = category === 'INSURANCE'
  const flow = financial ? FINANCIAL : CLINICAL_OUTREACH
  const available = [...flow, ...ALWAYS].filter((a) => {
    if (a.type === 'ASSIGN' && !canAssign) return false
    if (!a.from) return true
    return a.from.includes(status)
  })

  async function run(action: ActionOption) {
    if (action.needsNote && note.trim().length === 0) {
      setError('This action needs a note describing what happened.')
      return
    }
    setBusy(`${action.type}:${action.toStatus ?? ''}`)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: action.type, toStatus: action.toStatus, note: note.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'The action could not be recorded.')
        setBusy(null)
        return
      }
      setNote('')
      setDone(action.label)
      // The page is a server component; refresh re-runs it so the history,
      // status chip and funnel position all update together.
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(null)
    }
  }

  if (closed) {
    return (
      <div className="mt-4 rounded-md border border-ink-200 bg-ink-50 p-3 text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-800/60 dark:text-ink-300">
        This opportunity is closed. Reopening it is deliberately not possible from here — detection
        will raise a fresh opportunity if the underlying pattern recurs, which keeps the audit trail
        of what was decided, and when, intact.
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-3 border-t border-ink-100 pt-4 dark:border-ink-800">
      <div>
        <label htmlFor="action-note" className="label mb-1 block">
          Note
        </label>
        <textarea
          id="action-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened? This becomes part of the permanent record."
          className="input resize-y"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {available.map((a) => {
          const key = `${a.type}:${a.toStatus ?? ''}`
          return (
            <button
              key={`${key}:${a.label}`}
              onClick={() => run(a)}
              disabled={busy !== null}
              className={clsx(
                'btn',
                a.tone === 'primary' ? 'btn-primary' : a.tone === 'danger' ? 'btn-danger' : 'btn-secondary'
              )}
            >
              {busy === key ? 'Saving…' : a.label}
            </button>
          )
        })}
      </div>

      {canClose && (
        <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <span className="self-center text-2xs font-semibold uppercase tracking-wide text-ink-400">
            Close
          </span>
          {CLOSERS.map((a) => (
            <button
              key={a.toStatus}
              onClick={() => run(a)}
              disabled={busy !== null}
              className={clsx('btn', a.tone === 'danger' ? 'btn-danger' : 'btn-secondary')}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger-600 dark:text-danger-500">
          {error}
        </p>
      )}
      {done && !error && (
        <p className="text-sm text-positive-600 dark:text-positive-500">Recorded: {done}.</p>
      )}
    </div>
  )
}
