import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getPrincipal } from '@/lib/auth'
import { landingRoute } from '@/lib/navigation'
import { LoginForm, type DemoAccount } from '@/components/client/LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const existing = await getPrincipal()
  if (existing) redirect(landingRoute(existing))

  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: { role: true, hospitalScopes: { include: { hospital: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const accounts: DemoAccount[] = users.map((u) => ({
    email: u.email,
    name: u.name,
    title: u.title,
    roleName: u.role.name,
    scope:
      u.role.scopeLevel === 'GROUP'
        ? 'All hospitals'
        : u.hospitalScopes.length > 1
          ? `${u.hospitalScopes.length} hospitals`
          : (u.hospitalScopes[0]?.hospital.city ?? 'Hospital'),
  }))

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 p-4 dark:bg-ink-950">
      <LoginForm accounts={accounts} password="Demo!Pass123" />
    </main>
  )
}
