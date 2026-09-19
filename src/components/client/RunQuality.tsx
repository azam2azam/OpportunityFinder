'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, Loader2 } from 'lucide-react'

/**
 * Re-evaluates every data quality check on demand.
 *
 * Quality normally runs after a load, but an operator who has just fixed
 * something upstream needs to confirm it without waiting for the next cycle.
 */
export function RunQuality() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{ passed: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      const res = await fetch('/api/integration/quality', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Evaluation failed.')
      else {
        setSummary({ passed: data.passed, failed: data.failed })
        router.refresh()
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={run} disabled={busy} className="btn btn-primary">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
        {busy ? 'Evaluating…' : 'Re-evaluate quality'}
      </button>
      {summary && (
        <p className="text-2xs text-ink-500 dark:text-ink-400">
          {summary.passed} passing · {summary.failed} failing
        </p>
      )}
      {error && <p className="text-2xs text-danger-600 dark:text-danger-500">{error}</p>}
    </div>
  )
}
