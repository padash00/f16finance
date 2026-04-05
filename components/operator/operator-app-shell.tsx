'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentType, ReactNode } from 'react'
import { useEffect } from 'react'
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
  {
    href: '/operator',
    label: 'Сегодня',
    shortLabel: 'Главная',
    icon: Home,
    description: 'Главный экран оператора',
  },
  {
    href: '/operator/shifts',
    label: 'Смены',
    shortLabel: 'Смены',
    icon: CalendarDays,
    description: 'График и подтверждение смен',
  },
  {
    href: '/operator/tasks',
    label: 'Задачи',
    shortLabel: 'Задачи',
    icon: Briefcase,
    description: 'Новые и активные задачи',
  },
  {
    href: '/operator/salary',
    label: 'Зарплата',
    shortLabel: 'Зарплата',
    icon: Wallet,
    description: 'Неделя, долги, авансы и выплаты',
  },
  {
    href: '/operator/profile',
    label: 'Профиль',
    shortLabel: 'Профиль',
    icon: CircleUserRound,
    description: 'Личные данные и настройки',
  },
  {
    href: '/operator/terminal-login',
    label: 'Терминал',
    shortLabel: 'Терминал',
    icon: MonitorSmartphone,
    description: 'Вход на Orda Point по QR с экрана кассы',
  },
]

const metaByPath: Array<{
  match: (pathname: string) => boolean
  title: string
  subtitle: string
}> = [
  {
    match: (pathname) => pathname === '/operator',
    title: 'Личный кабинет оператора',
    subtitle: 'Сегодняшняя смена, задачи, долг и зарплата в одном месте.',
  },
  {
    match: (pathname) => pathname.startsWith('/operator/shifts'),
    title: 'Мои смены',
    subtitle: 'Текущая неделя, подтверждение графика и история рабочих дней.',
  },
  {
    match: (pathname) => pathname.startsWith('/operator/tasks'),
    title: 'Мои задачи',
    subtitle: 'Новые поручения, статус выполнения и комментарии без лишних экранов.',
  },
  {
    match: (pathname) => pathname.startsWith('/operator/salary'),
    title: 'Моя зарплата',
    subtitle: 'Начисление по неделе, долги, авансы и история фактических выплат.',
  },
  {
    match: (pathname) => pathname.startsWith('/operator/profile'),
    title: 'Мой профиль',
    subtitle: 'Контакты, точки, Telegram и быстрый доступ к рабочим настройкам.',
  },
  {
    match: (pathname) => pathname.startsWith('/operator/terminal-login'),
    title: 'Вход на терминале',
    subtitle: 'Подтвердите вход в Orda Point на кассе: отсканируйте QR или введите код из ссылки.',
  },
  {
    match: (pathname) => pathname.startsWith('/operator/point-qr-confirm'),
    title: 'Подтверждение входа',
    subtitle: 'Вы подтверждаете вход в программу на рабочем компьютере.',
  },
  {
    match: (pathname) => pathname.startsWith('/operator/settings'),
    title: 'Настройки оператора',
    subtitle: 'Безопасность, уведомления и быстрые рабочие действия в мобильном формате.',
  },
]

function isActivePath(pathname: string, href: string) {
  if (href === '/operator/profile' && pathname.startsWith('/operator/settings')) {
    return true
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function OperatorAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const currentMeta = metaByPath.find((item) => item.match(pathname)) || metaByPath[0]
  const activeItem = navItems.find((item) => isActivePath(pathname, item.href)) || navItems[0]

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/operator/profile', { cache: 'no-store', credentials: 'same-origin' })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (cancelled || res.ok) return
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,165,80,0.16),transparent_26%),linear-gradient(180deg,#07101c_0%,#0b1324_48%,#040814_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:px-5 sm:pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
        <div className="overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_30px_90px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:rounded-[2rem] sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-amber-200 sm:text-[11px]">
                Операторский контур
              </div>
              <h1 className="mt-3 text-xl font-semibold tracking-tight text-white sm:mt-4 sm:text-2xl">{currentMeta.title}</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">{currentMeta.subtitle}</p>
            </div>
            <div className="self-start rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-left sm:text-right">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Раздел</div>
              <div className="mt-1 text-sm font-medium text-white">{activeItem.shortLabel}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                    active
                      ? 'border-amber-400/25 bg-amber-400/10 text-amber-200'
                      : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:text-white',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>

        <div className="mt-4 flex-1">{children}</div>
      </div>

      <nav
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4"
        style={{ paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom, 0px))' }}
        aria-label="Основная навигация"
      >
        <div
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-stretch gap-0.5 overflow-x-auto rounded-[2.25rem] border border-white/[0.14]',
            'bg-[linear-gradient(180deg,rgba(255,255,255,0.12)_0%,rgba(15,23,42,0.55)_100%)] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.45),0_1px_0_rgba(255,255,255,0.06)_inset]',
            'backdrop-blur-2xl backdrop-saturate-150 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group relative flex min-w-[3.35rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[1.35rem] px-1 py-2 text-[10px] font-semibold leading-none tracking-tight transition sm:min-w-[3.85rem] sm:gap-1 sm:px-1.5 sm:py-2.5 sm:text-[11px]',
                  active
                    ? 'text-slate-950'
                    : 'text-slate-400 hover:text-white',
                )}
                aria-label={item.description}
              >
                {active ? (
                  <span
                    className="absolute inset-0 rounded-[1.35rem] bg-[linear-gradient(145deg,rgba(255,200,140,0.98),rgba(255,130,95,0.95))] shadow-[0_10px_28px_rgba(255,140,88,0.35)]"
                    aria-hidden
                  />
                ) : null}
                <Icon
                  className={cn(
                    'relative z-[1] h-[1.15rem] w-[1.15rem] shrink-0 sm:h-5 sm:w-5',
                    active ? 'text-slate-950' : 'text-slate-400 group-hover:text-white',
                  )}
                />
                <span className="relative z-[1] max-w-[4.25rem] truncate text-center">{item.shortLabel}</span>
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
    <Link
      href={href}
      className="group block rounded-[1.6rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_16px_48px_rgba(0,0,0,0.22)] transition hover:border-amber-400/30 hover:bg-white/[0.07]"
    >
      {eyebrow ? <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{eyebrow}</div> : null}
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">{title}</div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-2 text-slate-400 transition group-hover:border-amber-400/30 group-hover:text-amber-200">
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
    </Link>
  )
}
