'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentType, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Briefcase, CalendarDays, ChevronRight, CircleUserRound, Home, MonitorSmartphone, Wallet } from 'lucide-react'

import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  shortLabel: string
  icon: ComponentType<{ className?: string }>
  description: string
}

const navItems: NavItem[] = [
  { href: '/operator', label: 'Сегодня', shortLabel: 'Главная', icon: Home, description: 'Главный экран оператора' },
  { href: '/operator/shifts', label: 'Смены', shortLabel: 'Смены', icon: CalendarDays, description: 'График и подтверждение смен' },
  { href: '/operator/tasks', label: 'Задачи', shortLabel: 'Задачи', icon: Briefcase, description: 'Новые и активные задачи' },
  { href: '/operator/salary', label: 'Зарплата', shortLabel: 'Зарплата', icon: Wallet, description: 'Неделя, долги, авансы и выплаты' },
  { href: '/operator/profile', label: 'Профиль', shortLabel: 'Профиль', icon: CircleUserRound, description: 'Личные данные и настройки' },
  { href: '/operator/terminal-login', label: 'Терминал', shortLabel: 'Терминал', icon: MonitorSmartphone, description: 'Вход на Orda Point по QR с экрана кассы' },
]

const metaByPath: Array<{ match: (pathname: string) => boolean; title: string; subtitle: string }> = [
  { match: (p) => p === '/operator', title: 'Личный кабинет', subtitle: 'Сегодняшняя смена, задачи, долг и зарплата в одном месте.' },
  { match: (p) => p.startsWith('/operator/shifts'), title: 'Мои смены', subtitle: 'Текущая неделя, подтверждение графика и история рабочих дней.' },
  { match: (p) => p.startsWith('/operator/tasks'), title: 'Мои задачи', subtitle: 'Новые поручения, статус выполнения и комментарии.' },
  { match: (p) => p.startsWith('/operator/salary'), title: 'Моя зарплата', subtitle: 'Начисление по неделе, долги, авансы и история выплат.' },
  { match: (p) => p.startsWith('/operator/profile'), title: 'Мой профиль', subtitle: 'Контакты, точки, Telegram и рабочие настройки.' },
  { match: (p) => p.startsWith('/operator/terminal-login'), title: 'Вход на терминале', subtitle: 'Подтвердите вход в Orda Point на кассе: QR или код из ссылки.' },
  { match: (p) => p.startsWith('/operator/point-qr-confirm'), title: 'Подтверждение входа', subtitle: 'Вы подтверждаете вход в программу на рабочем компьютере.' },
  { match: (p) => p.startsWith('/operator/settings'), title: 'Настройки', subtitle: 'Безопасность, уведомления и быстрые рабочие действия.' },
]

function isActivePath(pathname: string, href: string) {
  if (href === '/operator/profile' && pathname.startsWith('/operator/settings')) return true
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function OperatorAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [operatorName, setOperatorName] = useState<string | null>(null)
  const currentMeta = metaByPath.find((item) => item.match(pathname)) || metaByPath[0]
  const activeItem = navItems.find((item) => isActivePath(pathname, item.href)) || navItems[0]

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/operator/profile', { cache: 'no-store', credentials: 'same-origin' })
      const json = (await res.json().catch(() => null)) as
        | { error?: string; operator?: { name?: string; short_name?: string } }
        | null
      if (cancelled) return
      if (res.ok) {
        const nm = json?.operator?.short_name || json?.operator?.name || null
        if (nm) setOperatorName(nm)
        return
      }
      const code = json?.error
      if (code === 'operator-inactive' || code === 'operator-auth-disabled') {
        await supabase.auth.signOut().catch(() => null)
        window.location.href = '/login?reason=operator-disabled'
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0b0c] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl">
        {/* Боковое меню — десктоп */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[#23262b] px-4 py-6 lg:flex">
          <div className="px-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400">Orda · Оператор</div>
            <div className="mt-2 truncate font-mono text-sm font-semibold text-zinc-100">{operatorName || 'Кабинет'}</div>
          </div>
          <nav className="mt-7 flex flex-1 flex-col gap-0.5" aria-label="Меню оператора">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 border-l-2 px-3 py-2.5 font-mono text-[13px] uppercase tracking-wide transition',
                    active
                      ? 'border-amber-400 bg-amber-400/[0.06] text-amber-300'
                      : 'border-transparent text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="px-1 pt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-700">Orda Control</div>
        </aside>

        {/* Контент */}
        <div className="flex min-h-screen w-full min-w-0 flex-1 flex-col px-3 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:px-5 lg:px-8 lg:pb-10 lg:pt-8">
          <header className="border border-[#23262b] bg-[#0e0f10] p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400 lg:hidden">Оператор</div>
                <h1 className="mt-2 font-mono text-xl font-semibold uppercase tracking-tight text-zinc-50 sm:text-2xl lg:mt-0">{currentMeta.title}</h1>
                <p className="mt-2 max-w-2xl text-[13px] leading-5 text-zinc-500">{currentMeta.subtitle}</p>
              </div>
              <div className="hidden shrink-0 border border-[#23262b] px-3 py-1.5 text-right sm:block">
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">Раздел</div>
                <div className="mt-0.5 font-mono text-[12px] uppercase text-zinc-300">{activeItem.shortLabel}</div>
              </div>
            </div>

            {/* Чип-навигация — мобильный/планшет */}
            <div className="mt-4 flex flex-wrap gap-1.5 lg:hidden">
              {navItems.map((item) => {
                const active = isActivePath(pathname, item.href)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition',
                      active ? 'border-amber-400/50 bg-amber-400/[0.08] text-amber-300' : 'border-[#23262b] text-zinc-500 hover:text-zinc-200',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </header>

          <div className="mt-4 flex-1 lg:mt-6">{children}</div>
        </div>
      </div>

      {/* Нижнее меню — мобильный/планшет */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[#23262b] bg-[#0a0b0c]/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Основная навигация"
      >
        <div className="mx-auto flex max-w-lg items-stretch">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-1 border-t-2 px-1 py-2.5 font-mono text-[9px] uppercase tracking-wide transition',
                  active ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-600 hover:text-zinc-300',
                )}
                aria-label={item.description}
              >
                <Icon className="h-[1.05rem] w-[1.05rem] shrink-0" />
                <span className="max-w-[4.5rem] truncate">{item.shortLabel}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

export function OperatorSectionCard({
  eyebrow,
  title,
  description,
  href,
}: {
  eyebrow?: string
  title: string
  description: string
  href: string
}) {
  return (
    <Link href={href} className="group block border border-[#23262b] bg-[#0e0f10] p-4 transition hover:border-amber-400/40 hover:bg-[#121314]">
      {eyebrow ? <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">{eyebrow}</div> : null}
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[15px] font-semibold uppercase tracking-tight text-zinc-100">{title}</div>
          <p className="mt-1.5 text-[13px] leading-5 text-zinc-500">{description}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 transition group-hover:text-amber-400" />
      </div>
    </Link>
  )
}
