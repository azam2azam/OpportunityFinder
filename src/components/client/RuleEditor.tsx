'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

export interface ParamRow {
  key: string
  value: unknown
  doc: string
  isDefault: boolean
}

/**
 * Rule parameter editor.
 *
 * Each field renders by the type of its current value — a number gets a number
 * input, a boolean a checkbox, a list a comma-separated field. Parameters that
 * still hold the shipped default are marked, so an administrator can see at a
 * glance what has been tuned away from the catalogue and what has not.
 */
export function RuleEditor({
  ruleId,
  ruleKey,
  enabled,
  slaDays,
  clinicalUrgency,
  defaultOwnerRole,
  params,
  canEdit,
}: {
  ruleId: string
  ruleKey: string
  enabled: boolean
  slaDays: number
  clinicalUrgency: number
  defaultOwnerRole: string
  params: ParamRow[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(params.map((p) => [p.key, serialise(p.value)]))
  )
  const [isEnabled, setIsEnabled] = useState(enabled)
  const [sla, setSla] = useState(String(slaDays))
  const [urgency, setUrgency] = useState(String(clinicalUrgency))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty =
    isEnabled !== enabled ||
    sla !== String(slaDays) ||
    urgency !== String(clinicalUrgency) ||
    params.some((p) => draft[p.key] !== serialise(p.value))

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const parsed: Record<string, unknown> = {}
      for (const p of params) {
        const raw = draft[p.key]
        parsed[p.key] = deserialise(raw, p.value)
      }
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: isEnabled,
          slaDays: Number(sla),
          clinicalUrgency: Number(urgency),
          params: parsed,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'The rule could not be saved.')
      } else {
        setSaved(true)
        router.refresh()
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {params.map((p) => (
          <div key={p.key}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <label
                htmlFor={`${ruleKey}-${p.key}`}
                className="text-sm font-medium text-ink-900 dark:text-ink-100"
              >
                {humanise(p.key)}
              </label>
              {!p.isDefault && (
                <span className="chip border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200">
                  customised
                </span>
              )}
            </div>
            {typeof p.value === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
                <input
                  id={`${ruleKey}-${p.key}`}
                  type="checkbox"
                  checked={draft[p.key] === 'true'}
                  disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, [p.key]: String(e.target.checked) })}
                  className="h-4 w-4 rounded border-ink-300"
                />
                {draft[p.key] === 'true' ? 'Enabled' : 'Disabled'}
              </label>
            ) : (
              <input
                id={`${ruleKey}-${p.key}`}
                type={typeof p.value === 'number' ? 'number' : 'text'}
                step="any"
                value={draft[p.key] ?? ''}
                disabled={!canEdit}
                onChange={(e) => setDraft({ ...draft, [p.key]: e.target.value })}
                className="input"
              />
            )}
            <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{p.doc}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-t border-ink-100 pt-3 dark:border-ink-800 sm:grid-cols-3">
        <div>
          <label htmlFor={`${ruleKey}-sla`} className="label mb-1 block">
            SLA (days)
          </label>
          <input
            id={`${ruleKey}-sla`}
            type="number"
            min={1}
            value={sla}
            disabled={!canEdit}
            onChange={(e) => setSla(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={`${ruleKey}-urgency`} className="label mb-1 block">
            Baseline urgency
          </label>
          <input
            id={`${ruleKey}-urgency`}
            type="number"
            min={0}
            max={100}
            value={urgency}
            disabled={!canEdit}
            onChange={(e) => setUrgency(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <span className="label mb-1 block">Owning team</span>
          <p className="py-1.5 text-sm text-ink-700 dark:text-ink-200">{humanise(defaultOwnerRole)}</p>
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3 dark:border-ink-800">
          <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300"
            />
            Rule enabled
          </label>
          <button onClick={save} disabled={busy || !dirty} className={clsx('btn btn-primary ml-auto')}>
            {busy ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger-600 dark:text-danger-500">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-positive-600 dark:text-positive-500">
          Saved. The new thresholds apply from the next detection run — existing opportunities keep
          their current status and owner.
        </p>
      )}
    </div>
  )
}

function serialise(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return String(value)
  return value == null ? '' : String(value)
}

/** Parses the field back to the shape the original value had. */
function deserialise(raw: string, original: unknown): unknown {
  if (typeof original === 'boolean') return raw === 'true'
  if (typeof original === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : original
  }
  if (Array.isArray(original)) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return raw
}

function humanise(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}
