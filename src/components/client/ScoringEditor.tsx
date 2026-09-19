'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { SCORING_FACTORS, FACTOR_LABEL, type ScoringFactor } from '@/lib/enums'

export interface ScoringModelView {
  id: string
  name: string
  isActive: boolean
  notes: string | null
  thresholds: { CRITICAL: number; HIGH: number; MEDIUM: number }
  weights: Record<string, number>
}

/**
 * Scoring model editor.
 *
 * Weights are shown both as raw numbers and as a share of the total, because
 * the raw number alone is meaningless — the scorer normalises by the weight
 * sum, so "30" means nothing until you know what the others add up to. Editing
 * a weight updates the share immediately, which is the feedback that makes the
 * model tunable rather than guessable.
 */
export function ScoringEditor({
  models,
  canEdit,
}: {
  models: ScoringModelView[]
  canEdit: boolean
}) {
  const router = useRouter()
  const active = models.find((m) => m.isActive) ?? models[0]
  const [selectedId, setSelectedId] = useState(active?.id ?? '')
  const selected = models.find((m) => m.id === selectedId) ?? active

  const [weights, setWeights] = useState<Record<string, number>>(selected?.weights ?? {})
  const [thresholds, setThresholds] = useState(selected?.thresholds ?? { CRITICAL: 78, HIGH: 62, MEDIUM: 42 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function switchModel(id: string) {
    const m = models.find((x) => x.id === id)
    if (!m) return
    setSelectedId(id)
    setWeights(m.weights)
    setThresholds(m.thresholds)
    setSaved(false)
    setError(null)
  }

  const total = Object.values(weights).reduce((s, w) => s + w, 0)
  const bandsValid = thresholds.CRITICAL > thresholds.HIGH && thresholds.HIGH > thresholds.MEDIUM

  async function save(activate: boolean) {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/scoring', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedId, weights, thresholds, activate }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'The scoring model could not be saved.')
      else {
        setSaved(true)
        router.refresh()
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (!selected) return null

  return (
    <div className="space-y-4">
      {models.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-2xs font-semibold uppercase tracking-wide text-ink-400">
            Model
          </span>
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => switchModel(m.id)}
              className={clsx(
                'chip transition-colors',
                m.id === selectedId
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300'
              )}
            >
              {m.name}
              {m.isActive && <span className="ml-1 text-2xs opacity-80">· active</span>}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SCORING_FACTORS.map((factor) => {
          const value = weights[factor] ?? 0
          const share = total > 0 ? (value / total) * 100 : 0
          return (
            <div key={factor} className="rounded-md border border-ink-200 p-3 dark:border-ink-700">
              <label
                htmlFor={`weight-${factor}`}
                className="block text-sm font-medium text-ink-900 dark:text-ink-100"
              >
                {FACTOR_LABEL[factor as ScoringFactor]}
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id={`weight-${factor}`}
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={value}
                  disabled={!canEdit}
                  onChange={(e) => setWeights({ ...weights, [factor]: Number(e.target.value) })}
                  className="h-1 flex-1 accent-brand-600"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={value}
                  disabled={!canEdit}
                  onChange={(e) => setWeights({ ...weights, [factor]: Number(e.target.value) })}
                  className="input w-16 py-1 text-center"
                  aria-label={`${FACTOR_LABEL[factor as ScoringFactor]} weight`}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700">
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} />
                </span>
                <span className="tabular w-10 text-right text-2xs text-ink-500">
                  {share.toFixed(0)}%
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-md border border-ink-200 p-3 dark:border-ink-700">
        <p className="label mb-2">Priority bands</p>
        <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">
          A score of 0–100 maps to a priority through these thresholds. Raising CRITICAL makes the
          top band scarcer; lowering MEDIUM sweeps more work into the queue.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['CRITICAL', 'HIGH', 'MEDIUM'] as const).map((band) => (
            <div key={band}>
              <label htmlFor={`band-${band}`} className="label mb-1 block">
                {band.charAt(0) + band.slice(1).toLowerCase()} at or above
              </label>
              <input
                id={`band-${band}`}
                type="number"
                min={0}
                max={100}
                value={thresholds[band]}
                disabled={!canEdit}
                onChange={(e) => setThresholds({ ...thresholds, [band]: Number(e.target.value) })}
                className="input"
              />
            </div>
          ))}
        </div>
        {!bandsValid && (
          <p className="mt-2 text-xs text-danger-600 dark:text-danger-500">
            Bands must decrease: Critical &gt; High &gt; Medium.
          </p>
        )}
      </div>

      <p className="text-xs text-ink-500 dark:text-ink-400">
        Total weight {total}. The score is the weighted mean of the normalised factors, so only the
        relative sizes matter — doubling every weight changes nothing.
        {selected.notes && <span className="ml-1 italic">{selected.notes}</span>}
      </p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <button onClick={() => save(false)} disabled={busy || !bandsValid || total <= 0} className="btn btn-secondary">
            {busy ? 'Saving…' : 'Save'}
          </button>
          {!selected.isActive && (
            <button onClick={() => save(true)} disabled={busy || !bandsValid || total <= 0} className="btn btn-primary">
              Save and make active
            </button>
          )}
          <p className="ml-auto text-xs text-ink-400">
            Applies from the next detection run. Existing opportunities keep their status and owner.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger-600 dark:text-danger-500">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-positive-600 dark:text-positive-500">
          Scoring model saved and recorded in the audit trail.
        </p>
      )}
    </div>
  )
}
