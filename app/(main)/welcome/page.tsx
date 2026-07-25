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
  Users,
} from 'lucide-react'

import { AppLogoMark } from '@/components/app-brand-mark'
import { CAPABILITY_GROUPS } from '@/lib/core/capabilities'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useNavSession } from '@/lib/nav/use-nav-session'
import { getPathFeature } from '@/lib/nav/sections'
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

// Иконка + акцент раздела (тон тема-зависимый).
const GROUP_STYLES: Record<string, { icon: any; tone: string; label: string }> = {
  finance: { icon: Banknote, tone: 'text-emerald-600 dark:text-emerald-400', label: 'Деньги — выручка, расходы, ОПиУ, прогноз' },
  inventory: { icon: Boxes, tone: 'text-sky-600 dark:text-sky-400', label: 'Магазин — каталог, склад, приёмки, заявки' },
  shifts: { icon: CalendarClock, tone: 'text-cyan-600 dark:text-cyan-400', label: 'Смены — расписание и отчёты по дням' },
  staff: { icon: Users, tone: 'text-violet-600 dark:text-violet-400', label: 'Команда — операторы, сотрудники, зарплата, HR' },
  points: { icon: MonitorSmartphone, tone: 'text-blue-600 dark:text-blue-400', label: 'Точки — устройства, киоски, станции' },
  pos: { icon: ShoppingCart, tone: 'text-amber-600 dark:text-amber-400', label: 'POS и клиенты — чеки, возвраты, лояльность' },
  operations: { icon: FolderKanban, tone: 'text-rose-600 dark:text-rose-400', label: 'Операционная — задачи, инциденты, KPI, цели' },
  system: { icon: Cog, tone: 'text-slate-600 dark:text-slate-300', label: 'Системные настройки — доступ, телеграм, журнал' },
}

export default function WelcomePage() {
  const router = useRouter()
  const { can, isLoading: capsLoading, isSuperAdmin: capsIsSuper } = useCapabilities()
  const { orgFeatures, featuresAllAccess } = useNavSession()
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
          typeof window !== 'undefined' ? window.location.hostname.replace(/^www\./i, '').toLowerCase() : null
        const baseHost = getTenantBaseHost().replace(/^www\./i, '').toLowerCase()
        const hostSaysTenant = !!currentHost && currentHost !== baseHost
        setIsTenantContext(hostSaysTenant || !!json.isTenantContext)
        setStaffRole((json.staffRole as StaffRole | null) || null)
        setRoleLabel((json.roleLabel as string | null) || null)
        setDisplayName((json.displayName as string | null) || null)
        if (json.isSuperAdmin && !(hostSaysTenant || !!json.isTenantContext)) {
          router.replace('/dashboard')
          return
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    loadRole()
    return () => { active = false }
  }, [router])

  const accessibleGroups = useMemo(() => {
    if (capsLoading) return []
    return CAPABILITY_GROUPS.map((group) => {
      const accessiblePages = group.pages
        .filter((page) => {
          if (!can(`${page.id}.view`)) return false
          if (!featuresAllAccess) {
            const feat = getPathFeature(page.path)
            if (feat && !orgFeatures.includes(feat)) return false
          }
          return true
        })
        .map((page) => ({ id: page.id, path: page.path, label: page.label }))
      return { ...group, accessiblePages }
    }).filter((g) => g.accessiblePages.length > 0)
  }, [capsLoading, can, featuresAllAccess, orgFeatures])

  const totalAccessible = accessibleGroups.reduce((acc, g) => acc + g.accessiblePages.length, 0)

  if (loading || capsLoading) {
    return (
      <div className="app-page flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
          Подготавливаем ваш рабочий раздел…
        </div>
      </div>
    )
  }

  if (isSuperAdmin && !isTenantContext) return null

  const isOwner = isSuperAdmin || staffRole === 'owner'
  const RoleIcon = isOwner ? Crown : ShieldCheck
  const roleAccent = isOwner
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    : 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
  const greeting = displayName ? `Добро пожаловать, ${displayName}` : 'Добро пожаловать'

  return (
    <div className="app-page mx-auto w-full max-w-6xl space-y-10 pb-10">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <header>
        <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
          <AppLogoMark size="md" />
          <span>{SITE_NAME}</span>
          <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          <span>Рабочий кабинет</span>
        </div>

        <div className="mt-7 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${roleAccent}`}>
              <RoleIcon className="h-3.5 w-3.5" />
              {roleLabel || (isOwner ? 'Владелец' : 'Рабочий контур')}
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-slate-900 dark:text-white sm:text-5xl">
              {greeting}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Здесь собраны только разделы, к которым у вас сейчас есть доступ. Если нужно открыть что-то ещё —
              попросите владельца настроить право в «Управлении доступом».
            </p>
          </div>

          {/* Folio-цифра — количество доступного как элемент композиции */}
          <div className="flex shrink-0 items-baseline gap-3">
            <span className="text-6xl font-semibold leading-none tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-7xl">
              {totalAccessible}
            </span>
            <div className="pb-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
              <div className="font-medium text-slate-700 dark:text-slate-300">страниц</div>
              <div>в {accessibleGroups.length} разделах</div>
            </div>
          </div>
        </div>

        {/* Хайрлайн — швейцарская линейка */}
        <div className="mt-8 h-px w-full bg-slate-200 dark:bg-white/10" />
      </header>

      {/* ── Пустое состояние ─────────────────────────────────────────── */}
      {accessibleGroups.length === 0 && !capsIsSuper && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-8">
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-100">Пока нет открытых разделов</h2>
            <p className="mt-2 text-sm text-amber-800/90 dark:text-amber-200/80">
              Вашей роли ещё не выданы права. Попросите владельца открыть нужные разделы на странице{' '}
              <Link href="/access" className="font-medium underline underline-offset-2 hover:opacity-80">
                «Управление доступом»
              </Link>.
            </p>
          </div>
        </div>
      )}

      {/* ── Директория разделов ──────────────────────────────────────── */}
      {accessibleGroups.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {accessibleGroups.map((group, gi) => {
            const style = GROUP_STYLES[group.id] || GROUP_STYLES.system
            const Icon = style.icon
            return (
              <section
                key={group.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 dark:border-white/10 dark:bg-slate-900/50 dark:hover:border-white/20"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs tabular-nums text-slate-400 dark:text-slate-500">
                    {String(gi + 1).padStart(2, '0')}
                  </span>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 dark:border-white/10 ${style.tone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{group.label}</h2>
                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{style.label}</p>
                  </div>
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] tabular-nums text-slate-500 dark:border-white/10 dark:text-slate-400">
                    {group.accessiblePages.length}
                  </span>
                </div>

                <div className="mt-4 space-y-0.5">
                  {group.accessiblePages.slice(0, 7).map((page) => (
                    <Link
                      key={page.id}
                      href={page.path}
                      className="group/link flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.04]"
                    >
                      <span className="truncate">{page.label}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover/link:translate-x-0.5 group-hover/link:text-slate-500 dark:text-slate-600 dark:group-hover/link:text-slate-300" />
                    </Link>
                  ))}
                  {group.accessiblePages.length > 7 && (
                    <p className="px-2.5 pt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      + ещё {group.accessiblePages.length - 7}
                    </p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* ── Подсказка владельцу ──────────────────────────────────────── */}
      {isOwner && accessibleGroups.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
          <ShieldCheck className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            Этот список собран из ваших прав и включённых функций тарифа. Чтобы изменить, какие разделы видит роль —
            откройте{' '}
            <Link href="/access" className="font-medium text-amber-600 underline underline-offset-2 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300">
              Управление доступом
            </Link>.
          </p>
        </div>
      )}
    </div>
  )
}
