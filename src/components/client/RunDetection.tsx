'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play, Loader2 } from 'lucide-react'

interface RunSummary {
  created: number
  updated: number
  suppressed: number
  durationMs: number
}

/**
 * Triggers a detection run.
 *
 * A run takes tens of seconds over the full population, so the button reports
 * what actually happened rather than just succeeding silently — created against
 * updated is the number that tells an administrator whether their threshold
 * change did anything.
 */
export function RunDetection() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      const res = await fetch('/api/detection/run', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'The detection run failed.')
      } else {
        setSummary(data.totals)
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
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {busy ? 'Detecting…' : 'Run detection'}
      </button>
      {summary && (
        <p className="text-2xs text-ink-500 dark:text-ink-400">
          {summary.created.toLocaleString()} new · {summary.updated.toLocaleString()} refreshed ·{' '}
          {summary.suppressed.toLocaleString()} suppressed in {(summary.durationMs / 1000).toFixed(1)}s
        </p>
      )}
      {error && <p className="text-2xs text-danger-600 dark:text-danger-500">{error}</p>}
      {busy && (
        <p className="text-2xs text-ink-400">
          Scanning the full population — this takes about a minute.
        </p>
      )}
    </div>
  )
}
