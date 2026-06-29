'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Banknote,
  Boxes,
  CalendarClock,
  Cog,
  Crown,
  FolderKanban,
  Loader2,
  MonitorSmartphone,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'

import { AppLogoMark } from '@/components/app-brand-mark'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CAPABILITY_GROUPS } from '@/lib/core/capabilities'
import { useCapabilities } from '@/lib/client/use-capabilities'
import type { StaffRole } from '@/lib/core/access'
import { SITE_NAME } from '@/lib/core/site'
import { getTenantBaseHost } from '@/lib/core/tenant-domain'

type SessionRoleResponse = {
  ok: boolean
  isSuperAdmin?: boolean
  isTenantContext?: boolean
  isStaff?: boolean
  staffRole?: StaffRole | null
  roleLabel?: string | null
  displayName?: string | null
  defaultPath?: string
}

// Стиль каждой группы (иконка + цвет акцента)
const GROUP_STYLES: Record<string, { icon: any; tone: string; bg: string; label: string }> = {
  finance: {
    icon: Banknote,
    tone: 'text-emerald-300',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    label: 'Деньги — выручка, расходы, ОПиУ, прогноз',
  },
  inventory: {
    icon: Boxes,
    tone: 'text-sky-300',
    bg: 'bg-sky-500/10 border-sky-500/30',
    label: 'Магазин — каталог, склад, приёмки, заявки',
  },
  shifts: {
    icon: CalendarClock,
    tone: 'text-cyan-300',
    bg: 'bg-cyan-500/10 border-cyan-500/30',
    label: 'Смены — расписание и отчёты по дням',
  },
  staff: {
    icon: Users,
    tone: 'text-violet-300',
    bg: 'bg-violet-500/10 border-violet-500/30',
    label: 'Команда — операторы, сотрудники, зарплата, HR',
  },
  points: {
    icon: MonitorSmartphone,
    tone: 'text-blue-300',
    bg: 'bg-blue-500/10 border-blue-500/30',
    label: 'Точки — устройства, киоски, станции',
  },
  pos: {
    icon: ShoppingCart,
    tone: 'text-amber-300',
    bg: 'bg-amber-500/10 border-amber-500/30',
    label: 'POS и клиенты — чеки, возвраты, лояльность',
  },
  operations: {
    icon: FolderKanban,
    tone: 'text-rose-300',
    bg: 'bg-rose-500/10 border-rose-500/30',
    label: 'Операционная — задачи, инциденты, KPI, цели',
  },
  system: {
    icon: Cog,
    tone: 'text-slate-300',
    bg: 'bg-slate-500/10 border-slate-500/30',
    label: 'Системные настройки — доступ, телеграм, журнал',
  },
}

export default function WelcomePage() {
  const router = useRouter()
  const { can, isLoading: capsLoading, isSuperAdmin: capsIsSuper } = useCapabilities()
  const [loading, setLoading] = useState(true)
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [roleLabel, setRoleLabel] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isTenantContext, setIsTenantContext] = useState(false)

  useEffect(() => {
    let active = true

    const loadRole = async () => {
      try {
        const response = await fetch('/api/auth/session-role')
        const json = (await response.json().catch(() => null)) as SessionRoleResponse | null

        if (!active) return

        if (!response.ok || !json?.ok) {
          router.replace('/login')
          return
        }

        setIsSuperAdmin(!!json.isSuperAdmin)
        const currentHost =
          typeof window !== 'undefined'
            ? window.location.hostname.replace(/^www\./i, '').toLowerCase()
            : null
        const baseHost = getTenantBaseHost().replace(/^www\./i, '').toLowerCase()
        const hostSaysTenant = !!currentHost && currentHost !== baseHost
        setIsTenantContext(hostSaysTenant || !!json.isTenantContext)
        setStaffRole((json.staffRole as StaffRole | null) || null)
        setRoleLabel((json.roleLabel as string | null) || null)
        setDisplayName((json.displayName as string | null) || null)

        // Супер-админ на корневом домене перебрасывается на /dashboard
        if (json.isSuperAdmin && !(hostSaysTenant || !!json.isTenantContext)) {
          router.replace('/dashboard')
          return
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    loadRole()
    return () => {
      active = false
    }
  }, [router])

  // Сборка карточек: только разделы и страницы где у пользователя есть <page>.view
  const accessibleGroups = useMemo(() => {
    if (capsLoading) return []
    return CAPABILITY_GROUPS
      .map((group) => {
        const accessiblePages = group.pages
          .filter((page) => can(`${page.id}.view`))
          .map((page) => ({
            id: page.id,
            path: page.path,
            label: page.label,
          }))
        return { ...group, accessiblePages }
      })
      .filter((g) => g.accessiblePages.length > 0)
  }, [capsLoading, can])

  const totalAccessible = accessibleGroups.reduce((acc, g) => acc + g.accessiblePages.length, 0)

  if (loading || capsLoading) {
    return (
      <div className="app-page flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-xl border-border bg-white dark:bg-slate-950/70 p-6 text-foreground">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-slate-50 dark:bg-black/20 px-4 py-4 text-sm text-slate-700 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
            Подготавливаем ваш рабочий раздел…
          </div>
        </Card>
      </div>
    )
  }

  if (isSuperAdmin && !isTenantContext) {
    return null
  }

  const headerIcon = isSuperAdmin || staffRole === 'owner' ? Crown : ShieldCheck
  const HeaderIcon = headerIcon
  const accentClass =
    isSuperAdmin || staffRole === 'owner'
      ? 'border border-amber-400/20 bg-amber-400/10 text-amber-700 dark:text-amber-200'
      : 'border border-violet-400/20 bg-violet-400/10 text-violet-700 dark:text-violet-200'
  const heroBg =
    isSuperAdmin || staffRole === 'owner'
      ? 'bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.08),transparent_34%),linear-gradient(135deg,rgba(255,251,245,1),rgba(255,250,240,1))] dark:bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.18),transparent_34%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))]'
      : 'bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.08),transparent_34%),linear-gradient(135deg,rgba(252,250,255,1),rgba(248,244,255,1))] dark:bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.18),transparent_34%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))]'
  const greeting = displayName ? `Добро пожаловать, ${displayName}` : 'Добро пожаловать'

  return (
    <div className="app-page space-y-6 w-full">
      {/* Шапка */}
      <Card className={`overflow-hidden border-border p-6 text-foreground shadow-[0_24px_70px_rgba(0,0,0,0.32)] sm:p-8 ${heroBg}`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-5 flex flex-wrap items-center gap-4">
              <AppLogoMark size="lg" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{SITE_NAME}</p>
                <p className="mt-0.5 text-sm text-slate-500">Рабочий кабинет</p>
              </div>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${accentClass}`}>
                {roleLabel || (isSuperAdmin ? 'Супер-админ' : 'Рабочий контур')}
              </span>
              {displayName ? (
                <span className="rounded-full border border-border bg-slate-100 dark:bg-white/6 px-3 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  {displayName}
                </span>
              ) : null}
            </div>
            <div className={`mb-4 inline-flex rounded-2xl p-4 ${isSuperAdmin || staffRole === 'owner' ? 'bg-amber-500/12' : 'bg-violet-500/12'}`}>
              <HeaderIcon className={`h-7 w-7 ${isSuperAdmin || staffRole === 'owner' ? 'text-amber-300' : 'text-violet-300'}`} />
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">{greeting}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-700 dark:text-slate-300">
              Здесь — только те разделы, к которым у вас сейчас есть доступ.
              Если нужно открыть что-то ещё — попросите владельца настроить
              право в разделе «Управление доступом».
            </p>
          </div>

          <div className="rounded-3xl border border-border bg-slate-50 dark:bg-black/20 px-5 py-4 text-sm text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-300" />
              <span className="font-semibold text-foreground">{totalAccessible}</span>
              <span>доступных страниц</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">в {accessibleGroups.length} разделах</p>
          </div>
        </div>
      </Card>

      {/* Если совсем ничего не доступно (кастомная роль с нулевыми правами) */}
      {accessibleGroups.length === 0 && !capsIsSuper && (
        <Card className="border-amber-500/20 bg-amber-500/5 p-6 text-amber-200">
          <h2 className="text-lg font-semibold">У вас пока нет открытых разделов</h2>
          <p className="mt-2 text-sm">
            Попросите владельца открыть нужные права на странице
            «Управление доступом».
          </p>
        </Card>
      )}

      {/* Карточки разделов — только те которые доступны */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-2">
        {accessibleGroups.map((group) => {
          const style = GROUP_STYLES[group.id] || GROUP_STYLES.system
          const Icon = style.icon
          return (
            <Card
              key={group.id}
              className={`group border ${style.bg} p-6 text-foreground shadow-[0_18px_48px_rgba(0,0,0,0.24)] transition hover:scale-[1.005]`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className={`mb-4 inline-flex rounded-2xl p-3 ${style.bg}`}>
                    <Icon className={`h-6 w-6 ${style.tone}`} />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground">{group.label}</h2>
                  <p className="mt-1.5 text-xs leading-5 text-slate-400">
                    {style.label}
                  </p>
                  <div className="mt-2 text-[11px] text-slate-500">
                    Доступно страниц: <span className={style.tone}>{group.accessiblePages.length}</span>
                  </div>
                </div>
              </div>

              {/* Список страниц */}
              <div className="mt-5 space-y-1.5">
                {group.accessiblePages.slice(0, 6).map((page) => (
                  <Link
                    key={page.id}
                    href={page.path}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.03] px-3 py-2 text-sm text-slate-700 dark:text-slate-200 transition hover:bg-slate-100 dark:hover:bg-white/[0.07] hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="truncate">{page.label}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
                  </Link>
                ))}
                {group.accessiblePages.length > 6 && (
                  <p className="text-center text-xs text-slate-500 pt-1">
                    + ещё {group.accessiblePages.length - 6}
                  </p>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Подсказка владельцу */}
      {(isSuperAdmin || staffRole === 'owner') && (
        <Card className="border-border bg-white dark:bg-slate-950/50 p-5 text-sm text-slate-700 dark:text-slate-300">
          <div className="flex items-start gap-3">
            <Wallet className="h-5 w-5 text-amber-300 shrink-0" />
            <div>
              <h3 className="font-semibold text-foreground mb-1">Управление правами</h3>
              <p>
                Эта страница автоматически собрана из ваших прав. Чтобы изменить
                какие разделы видит роль — откройте{' '}
                <Link href="/access" className="text-amber-300 underline hover:text-amber-200">
                  Управление доступом
                </Link>{' '}
                и настройте capabilities. Карточки тут перерисуются при следующем входе.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
