'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

export interface DemoAccount {
  email: string
  name: string
  title: string
  roleName: string
  scope: string
}

/**
 * Sign-in, with the demo roster alongside.
 *
 * The roster exists because this platform's whole behaviour — which modules
 * appear, which categories are visible, whether patient names are masked —
 * depends on the role signed in. Without a one-click way to switch personas,
 * verifying that RBAC actually works means retyping credentials twelve times.
 */
export function LoginForm({ accounts, password }: { accounts: DemoAccount[]; password: string }) {
  const router = useRouter()
  const [email, setEmail] = useState(accounts[0]?.email ?? '')
  const [pwd, setPwd] = useState(password)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pwd }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Sign-in failed.')
        setBusy(false)
        return
      }
      // refresh() as well as push(): the shell is a server component and has to
      // re-render against the new principal.
      router.push('/')
      router.refresh()
    } catch {
      setError('Could not reach the server. Is it running?')
      setBusy(false)
    }
  }

  return (
    <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="card card-pad">
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">
              O
            </span>
            <span className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
              Opportuna
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
            Hospital Growth &amp; Patient Opportunity Command Centre
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="email" className="label mb-1 block">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="label mb-1 block">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="input"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              required
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500"
            >
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-400 dark:border-ink-800 dark:text-ink-500">
          This deployment runs on a synthetic VIDA extract. No real patient data is present, and no
          record here describes an actual person.
        </p>
      </div>

      <div className="card card-pad">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Demonstration roles</h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Each role sees a different platform. Select one to load its credentials — the password is
          the same for every demo account.
        </p>
        <ul className="mt-3 divide-y divide-ink-100 dark:divide-ink-800">
          {accounts.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                onClick={() => {
                  setEmail(a.email)
                  setPwd(password)
                  setError(null)
                }}
                className={clsx(
                  'flex w-full items-start justify-between gap-3 px-2 py-2 text-left transition-colors',
                  email === a.email
                    ? 'bg-brand-50 dark:bg-brand-950/60'
                    : 'hover:bg-ink-50 dark:hover:bg-ink-800/60'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900 dark:text-ink-100">
                    {a.name}
                  </span>
                  <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                    {a.title}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-2xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                    {a.roleName}
                  </span>
                  <span className="block text-2xs text-ink-400">{a.scope}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
