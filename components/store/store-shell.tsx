'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  Activity, Boxes, Warehouse, FileText, ClipboardList, Building2,
  Receipt, Users2, Monitor, ReceiptText, ArrowLeft, Store, LogOut,
  Clock, Settings, Menu, X, Search, Command,
} from 'lucide-react'
import { isAbortError } from '@/lib/is-abort-error'

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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const isActive = (item: Item) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/')

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  useEffect(() => { setMobileOpen(false) }, [pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navList = (onNavigate?: () => void) => (
    <nav className="flex-1 space-y-1 px-2 py-3">
      {NAV.map((item) => {
        const active = isActive(item)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              active ? 'bg-slate-100 text-slate-900 ring-1 ring-slate-200 dark:bg-white/[0.07] dark:text-white dark:ring-white/10' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white'
            }`}
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-200 text-slate-500 dark:bg-white/5 dark:text-slate-500'}`}>
              <Icon className="h-4 w-4" />
            </span>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-dvh bg-white dark:bg-slate-950/30">
      {/* Топ-бар модуля «Магазин» */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/80 sm:px-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setMobileOpen(true)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 md:hidden" aria-label="Меню">
            <Menu className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/15">
              <Store className="h-4 w-4 text-emerald-300" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">Orda</span>
              <span className="hidden text-slate-600 sm:inline">·</span>
              <span className="hidden text-sm font-semibold text-emerald-600 dark:text-emerald-300 sm:inline">Магазин</span>
              <span className="ml-1 hidden rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700/90 dark:text-emerald-300/90 lg:inline">модуль</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setSearchOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white">
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Поиск</span>
            <span className="hidden items-center gap-0.5 rounded-md border border-slate-300 bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 lg:flex"><Command className="h-2.5 w-2.5" />K</span>
          </button>
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> <span className="hidden sm:inline">В Orda</span>
          </Link>
          <button onClick={handleLogout} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300" title="Выйти">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Десктоп-сайдбар */}
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 flex-col self-start overflow-y-auto border-r border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/40 md:flex">
          {navList()}
          <div className="border-t border-slate-200 p-2 dark:border-white/10">
            <Link href="/dashboard" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Назад в Orda
            </Link>
          </div>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      {/* Мобильное меню */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[80%] max-w-[18rem] flex-col border-r border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/15"><Store className="h-4 w-4 text-emerald-300" /></div>
                <span className="text-sm font-semibold text-slate-900 dark:text-white">Магазин</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{navList(() => setMobileOpen(false))}</div>
            <div className="border-t border-slate-200 p-2 dark:border-white/10">
              <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Назад в Orda
              </Link>
            </div>
          </div>
        </div>
      )}

      {searchOpen && <StoreSearch onClose={() => setSearchOpen(false)} navItems={NAV} />}
    </div>
  )
}

function StoreSearch({ onClose, navItems }: { onClose: () => void; navItems: Item[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [q, setQ] = useState('')
  const [products, setProducts] = useState<Array<{ title: string; subtitle: string; href: string }>>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 0) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const navMatches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return navItems
    return navItems.filter((i) => i.label.toLowerCase().includes(s))
  }, [q, navItems])

  useEffect(() => {
    if (!q.trim()) { setProducts([]); return }
    const ac = new AbortController()
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/store/global-search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store', signal: ac.signal })
        const j = await res.json().catch(() => null)
        if (ac.signal.aborted) return
        setProducts(res.ok && j?.ok && Array.isArray(j?.data?.results) ? j.data.results.slice(0, 8) : [])
      } catch (e) { if (!isAbortError(e) && !ac.signal.aborted) setProducts([]) }
      finally { if (!ac.signal.aborted) setSearching(false) }
    }, 250)
    return () => { clearTimeout(t); ac.abort() }
  }, [q])

  const go = (href: string) => { router.push(href); onClose() }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-950/70 p-4 pt-[12vh] backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950/95">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <Search className="h-4 w-4 text-slate-500" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по магазину: раздел, товар, штрихкод…" className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-500 outline-none dark:text-slate-200" />
          <kbd className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {navMatches.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-slate-500">Разделы</div>
              {navMatches.map((i) => {
                const Icon = i.icon
                return (
                  <button key={i.href} onClick={() => go(i.href)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400"><Icon className="h-4 w-4" /></span>
                    {i.label}
                  </button>
                )
              })}
            </div>
          )}
          {q.trim() && (
            <div>
              <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-slate-500">{searching ? 'Ищу товары…' : products.length ? 'Товары и документы' : 'Ничего не найдено'}</div>
              {products.map((r, idx) => (
                <button key={`${r.href}-${idx}`} onClick={() => go(r.href)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5">
                  <span className="truncate">{r.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{r.subtitle}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
