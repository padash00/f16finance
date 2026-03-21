'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentType, ReactNode } from 'react'
import { Briefcase, CalendarDays, ChevronRight, CircleUserRound, Home, Wallet } from 'lucide-react'

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
]

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function OperatorAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const currentMeta = metaByPath.find((item) => item.match(pathname)) || metaByPath[0]
  const activeItem = navItems.find((item) => isActivePath(pathname, item.href)) || navItems[0]

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,165,80,0.16),transparent_26%),linear-gradient(180deg,#07101c_0%,#0b1324_48%,#040814_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 pb-28 pt-5 sm:px-5">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-amber-200">
                Операторский контур
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">{currentMeta.title}</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">{currentMeta.subtitle}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Раздел</div>
              <div className="mt-1 text-sm font-medium text-white">{activeItem.shortLabel}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex-1">{children}</div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 pt-2">
        <div className="mx-auto flex max-w-xl items-center gap-1 rounded-[1.75rem] border border-white/10 bg-slate-950/90 p-2 shadow-[0_22px_70px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-3 py-3 text-xs font-medium transition',
                  active
                    ? 'bg-[linear-gradient(135deg,rgba(255,179,107,0.96),rgba(255,122,89,0.94))] text-slate-950 shadow-[0_16px_34px_rgba(255,140,88,0.28)]'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-white',
                )}
                aria-label={item.description}
              >
                <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-slate-950' : 'text-slate-400 group-hover:text-white')} />
                <span className="truncate">{item.shortLabel}</span>
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
      {eyebrow ? (
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{eyebrow}</div>
      ) : null}
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
