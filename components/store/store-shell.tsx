'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  Activity, Boxes, Warehouse, FileText, ClipboardList, Building2,
  Receipt, Users2, Monitor, ReceiptText, ArrowLeft, Store, LogOut,
  Clock, Settings,
} from 'lucide-react'

type Item = { href: string; label: string; icon: any; exact?: boolean }

const NAV: Item[] = [
  { href: '/store/sales', label: 'Аналитика', icon: Activity },
  { href: '/store', label: 'Обзор', icon: Boxes, exact: true },
  { href: '/store/stock', label: 'Склад', icon: Warehouse },
  { href: '/store/documents', label: 'Документы', icon: FileText },
  { href: '/store/orders', label: 'Заявки', icon: ClipboardList },
  { href: '/store/vendors', label: 'Поставщики', icon: Building2 },
  { href: '/store/cashbox', label: 'Касса', icon: Receipt },
  { href: '/store/shifts', label: 'Смены', icon: Clock },
  { href: '/store/clients', label: 'Клиенты', icon: Users2 },
  { href: '/pos', label: 'Web POS', icon: Monitor },
  { href: '/store/receipt-settings', label: 'Реквизиты ККМ', icon: ReceiptText },
  { href: '/store/settings', label: 'Настройки', icon: Settings },
]

export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isActive = (item: Item) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/')

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-dvh bg-slate-950/30">
      {/* Топ-бар модуля «Магазин» */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/10 bg-slate-950/80 px-4 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/15">
            <Store className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Orda</span>
            <span className="text-slate-600">·</span>
            <span className="text-sm font-semibold text-emerald-300">Магазин</span>
            <span className="ml-1 hidden rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300/90 sm:inline">модуль</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> В Orda
          </Link>
          <button onClick={handleLogout} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300" title="Выйти">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 flex-col self-start overflow-y-auto border-r border-white/10 bg-slate-950/40 md:flex">
          <nav className="flex-1 space-y-1 px-2 py-3">
            {NAV.map((item) => {
              const active = isActive(item)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? 'bg-white/[0.07] text-white ring-1 ring-white/10' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-500'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="border-t border-white/10 p-2">
            <Link href="/dashboard" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Назад в Orda
            </Link>
          </div>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
