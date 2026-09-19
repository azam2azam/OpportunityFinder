'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  LayoutDashboard, Target, ListChecks, Users, TrendingUp, Stethoscope, GitBranch,
  ShieldCheck, UserPlus, CalendarClock, Megaphone, BarChart3, MessageSquareText,
  Building2, Network, UserRound, SlidersHorizontal, Settings, FileSearch,
  Menu, X, Moon, Sun, LogOut, ChevronDown, Search,
  Share2, Server, Workflow, ArrowLeftRight, Upload, BadgeCheck, Waypoints,
} from 'lucide-react'
import type { NavGroup } from '@/lib/navigation'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Target, ListChecks, Users, TrendingUp, Stethoscope, GitBranch,
  ShieldCheck, UserPlus, CalendarClock, Megaphone, BarChart3, MessageSquareText,
  Building2, Network, UserRound, SlidersHorizontal, Settings, FileSearch,
  Share2, Server, Workflow, ArrowLeftRight, Upload, BadgeCheck, Waypoints,
}

export interface ShellUser {
  name: string
  title: string
  roleName: string
  roleKey: string
  scopeLabel: string
  initials: string
}

export interface HospitalOption {
  id: string
  name: string
  code: string
}

/**
 * The application shell: navigation, hospital scope selector, theme, sign-out.
 *
 * Client-side because it owns the mobile drawer, the theme toggle and the
 * active-route highlight. Everything it renders is passed in from the server
 * layout — it makes no permission decisions of its own, so there is nothing
 * here an inspecting user could subvert.
 */
export function Shell({
  navigation,
  user,
  hospitals,
  activeHospitalId,
  children,
}: {
  navigation: NavGroup[]
  user: ShellUser
  hospitals: HospitalOption[]
  activeHospitalId: string | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Reading the DOM after mount is the hydration-safe way to pick up the theme
  // the pre-paint script already applied; the server cannot know it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  // Route change should dismiss transient chrome; leaving the drawer open over
  // the new page is disorienting on mobile.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setOpen(false)
    setMenuOpen(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('opportuna-theme', next ? 'dark' : 'light')
    } catch {
      // Private browsing blocks storage; the toggle still works for this session.
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  function setHospital(id: string) {
    const params = new URLSearchParams(window.location.search)
    if (id) params.set('hospital', id)
    else params.delete('hospital')
    router.push(`${pathname}?${params.toString()}`)
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <div className="flex min-h-screen bg-ink-50 dark:bg-ink-950">
      {/* Mobile scrim */}
      {open && (
        <button
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink-950/50 lg:hidden"
        />
      )}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-ink-200 bg-white transition-transform dark:border-ink-800 dark:bg-ink-900 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-ink-200 px-4 dark:border-ink-800">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">
              O
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink-900 dark:text-ink-50">
              Opportuna
            </span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="btn btn-ghost -mr-1 px-1.5 py-1 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
          {navigation.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? Target
                  const active = isActive(item.href)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={clsx(
                          'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-brand-50 font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200'
                            : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                        )}
                      >
                        <Icon className={clsx('h-4 w-4 shrink-0', active && 'text-brand-600 dark:text-brand-300')} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-ink-200 p-3 dark:border-ink-800">
          <div className="rounded-md bg-ink-50 p-2.5 dark:bg-ink-800/60">
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-400">Data scope</p>
            <p className="mt-0.5 text-xs text-ink-600 dark:text-ink-300">{user.scopeLabel}</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-ink-200 bg-white/90 px-3 backdrop-blur dark:border-ink-800 dark:bg-ink-900/90 sm:px-4">
          <button
            onClick={() => setOpen(true)}
            className="btn btn-ghost px-1.5 py-1 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>

          {hospitals.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="sr-only">Hospital</span>
              <select
                value={activeHospitalId ?? ''}
                onChange={(e) => setHospital(e.target.value)}
                className="input w-auto max-w-[220px] py-1 text-sm"
              >
                <option value="">All hospitals in scope</option>
                {hospitals.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <form action="/opportunities" className="ml-auto hidden items-center sm:flex">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                name="q"
                placeholder="Search reference, MRN, title…"
                className="input w-56 py-1 pl-8 text-sm lg:w-72"
                aria-label="Search opportunities"
              />
            </div>
          </form>

          <button
            onClick={toggleTheme}
            className="btn btn-ghost px-1.5 py-1"
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-ink-100 dark:hover:bg-ink-800"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-2xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
                {user.initials}
              </span>
              <span className="hidden min-w-0 md:block">
                <span className="block truncate text-xs font-medium text-ink-900 dark:text-ink-100">
                  {user.name}
                </span>
                <span className="block truncate text-2xs text-ink-500 dark:text-ink-400">
                  {user.roleName}
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 w-60 animate-slide-up rounded-lg border border-ink-200 bg-white p-1 shadow-pop dark:border-ink-800 dark:bg-ink-900"
              >
                <div className="border-b border-ink-100 px-2.5 py-2 dark:border-ink-800">
                  <p className="text-sm font-medium text-ink-900 dark:text-ink-100">{user.name}</p>
                  <p className="text-xs text-ink-500 dark:text-ink-400">{user.title}</p>
                  <p className="mt-1 text-2xs text-ink-400">{user.scopeLabel}</p>
                </div>
                <button
                  role="menuitem"
                  onClick={signOut}
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
