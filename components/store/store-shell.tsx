'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity, Boxes, Warehouse, FileText, ClipboardList, Building2,
  Receipt, Users2, Monitor, ReceiptText, ArrowLeft, Store,
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
  { href: '/store/clients', label: 'Клиенты', icon: Users2 },
  { href: '/pos', label: 'Web POS', icon: Monitor },
  { href: '/store/receipt-settings', label: 'Реквизиты ККМ', icon: ReceiptText },
]

export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isActive = (item: Item) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/')

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)]">
      <aside className="sticky top-0 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 flex-col self-start overflow-y-auto border-r border-white/10 bg-slate-950/40 md:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/15">
            <Store className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Магазин</div>
            <div className="text-[11px] text-slate-500">рабочее пространство</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-1">
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
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад в Orda
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
