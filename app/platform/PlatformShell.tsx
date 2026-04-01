'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  BarChart3,
  Building2,
  CreditCard,
  LogOut,
  PlusCircle,
  Zap,
} from 'lucide-react'

const NAV = [
  { href: '/platform', label: 'Обзор', icon: BarChart3, exact: true },
  { href: '/platform/organizations', label: 'Организации', icon: Building2, exact: false },
  { href: '/platform/billing', label: 'Тарифы', icon: CreditCard, exact: false },
]

export default function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen bg-[#050816]">
      <aside className="flex w-56 shrink-0 flex-col border-r border-white/[0.06] bg-slate-950/60 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-2.5 border-b border-white/[0.06] px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Orda Platform</span>
        </div>

        <nav className="flex-1 space-y-0.5 p-2 pt-3">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-violet-500/15 text-violet-300'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            )
          })}

          <div className="my-2 border-t border-white/[0.06]" />

          <Link
            href="/platform/new"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            <PlusCircle className="h-4 w-4 shrink-0" />
            Новая организация
          </Link>
        </nav>

        <div className="border-t border-white/[0.06] p-2">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-slate-300"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Выйти
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
