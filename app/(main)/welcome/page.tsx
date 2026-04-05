'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  CalendarClock,
  CalendarRange,
  Calculator,
  Crown,
  DollarSign,
  FolderKanban,
  LayoutDashboard,
  Network,
  Loader2,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'

import { AppLogoMark } from '@/components/app-brand-mark'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

type WelcomeAction = {
  href: string
  label: string
  note: string
  icon: any
}

const MANAGER_ACTIONS: WelcomeAction[] = [
  { href: '/shifts', label: 'График смен', note: 'Назначения операторов и контроль недели', icon: CalendarClock },
  { href: '/salary', label: 'Зарплата', note: 'Расчёты, начисления и выплаты', icon: Wallet },
  { href: '/income', label: 'Доходы', note: 'Оборот, выручка и приток денег', icon: TrendingUp },
  { href: '/expenses', label: 'Расходы', note: 'Списание средств и контроль статей', icon: TrendingDown },
  { href: '/weekly-report', label: 'Недельный отчёт', note: 'Итоги недели и план-факт', icon: CalendarRange },
  { href: '/tasks', label: 'Задачи', note: 'Контроль поручений, сроков и текущей работы', icon: FolderKanban },
  { href: '/structure', label: 'Структура', note: 'Распределение ролей по команде и точкам', icon: Network },
]

const MARKETER_ACTIONS: WelcomeAction[] = [
  { href: '/tasks', label: 'Задачи', note: 'Постановка, контроль и сопровождение задач', icon: FolderKanban },
]

const OWNER_ACTIONS: WelcomeAction[] = [
  { href: '/dashboard', label: 'Главная панель', note: 'Общий статус бизнеса и ключевые метрики', icon: LayoutDashboard },
  { href: '/income', label: 'Доходы', note: 'Оборот, выручка и притоки денег', icon: TrendingUp },
  { href: '/expenses', label: 'Расходы', note: 'Списания, статьи и контроль затрат', icon: TrendingDown },
  { href: '/cashflow', label: 'Cash Flow', note: 'Движение денег и баланс нарастающим итогом', icon: Wallet },
  { href: '/profitability', label: 'ОПиУ и EBITDA', note: 'Полная прибыль, комиссии и рентабельность', icon: Calculator },
  { href: '/salary', label: 'Зарплата', note: 'Расчёты, начисления и выплаты команде', icon: DollarSign },
  { href: '/operators', label: 'Операторы', note: 'Управление командой и профили', icon: Users },
  { href: '/kpi', label: 'KPI', note: 'Контроль плановых показателей', icon: Target },
  { href: '/forecast', label: 'AI Прогноз', note: 'Прогноз доходов на 30/60/90 дней', icon: TrendingUp },
  { href: '/goals', label: 'Цели и план', note: 'Плановые показатели по выручке', icon: Target },
]

export default function WelcomePage() {
  const router = useRouter()
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

        if (json.isSuperAdmin && !(hostSaysTenant || !!json.isTenantContext)) {
          router.replace('/dashboard')
          return
        }

        if (!json.isSuperAdmin && !['manager', 'marketer', 'owner'].includes(json.staffRole || '')) {
          router.replace(json.defaultPath || '/unauthorized')
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

  const welcomeConfig = useMemo(() => {
    if (isSuperAdmin || staffRole === 'owner') {
      return {
        title: displayName ? `Добро пожаловать, ${displayName}` : 'Добро пожаловать, Владелец',
        description: 'У вас открыт полный управленческий доступ к финансам, команде и аналитике бизнеса.',
        checklist: [
          'Откройте главную панель — там собраны ключевые метрики бизнеса за сегодня.',
          'Проверьте Cash Flow за последние 30 дней: положительный ли баланс?',
          'Сверьте рентабельность текущего месяца в разделе ОПиУ и EBITDA.',
          'Просмотрите рейтинг операторов и KPI — кто показывает лучшие результаты.',
          'Проверьте зарплатный расчёт перед датой выплат.',
        ],
        actions: OWNER_ACTIONS,
      }
    }

    if (staffRole === 'manager') {
      return {
        title: 'Добро пожаловать, руководитель',
        description: 'У вас открыт доступ только к ключевым операционным и финансовым разделам.',
        checklist: [
          'Проверьте график смен и расставьте операторов на текущую неделю.',
          'Сверьте структуру команды по точкам и назначьте старших операторов там, где это нужно.',
          'Откройте зарплату и убедитесь, что расчёты по сменам актуальны.',
          'Сверьте доходы, расходы, задачи и недельный отчёт перед началом работы.',
        ],
        actions: MANAGER_ACTIONS,
      }
    }

    return {
      title: 'Добро пожаловать, маркетолог',
      description: 'У вас открыт доступ только к разделу задач. Остальные модули скрыты.',
      checklist: [
        'Откройте задачи и проверьте активные карточки.',
        'Создайте новые задачи для операторов или команды, если это нужно.',
        'Отслеживайте статусы и дедлайны только в рабочем блоке задач.',
      ],
      actions: MARKETER_ACTIONS,
    }
  }, [displayName, isSuperAdmin, staffRole])

  if (loading) {
    return (
      <>
          <div className="app-page flex min-h-[60vh] items-center justify-center">
            <Card className="w-full max-w-xl border-white/10 bg-slate-950/70 p-6 text-white">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                Подготавливаем ваш рабочий раздел...
              </div>
            </Card>
          </div>
      </>
    )
  }

  if (isSuperAdmin && !isTenantContext) {
    return null
  }

  return (
    <>
        <div className="app-page space-y-6">
          <Card className={`overflow-hidden border-white/10 p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.32)] sm:p-8 ${
            staffRole === 'owner'
              ? 'bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.18),transparent_34%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))]'
              : 'bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.18),transparent_34%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))]'
          }`}>
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
                  <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                    staffRole === 'owner'
                      ? 'border border-amber-400/20 bg-amber-400/10 text-amber-200'
                      : 'border border-violet-400/20 bg-violet-400/10 text-violet-200'
                  }`}>
                    {roleLabel || 'Рабочий контур'}
                  </span>
                  {displayName ? (
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-medium text-slate-300">
                      {displayName}
                    </span>
                  ) : null}
                </div>
                <div className={`mb-4 inline-flex rounded-2xl p-4 ${staffRole === 'owner' ? 'bg-amber-500/12' : 'bg-violet-500/12'}`}>
                  {staffRole === 'owner'
                    ? <Crown className="h-7 w-7 text-amber-300" />
                    : <ShieldCheck className="h-7 w-7 text-violet-300" />
                  }
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">{welcomeConfig.title}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{welcomeConfig.description}</p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/20 px-5 py-4 text-sm text-slate-300">
                После входа вы будете видеть только разрешённые разделы для своей роли.
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/65 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
            <h2 className="text-xl font-semibold">С чего начать</h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-300">
              {welcomeConfig.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </Card>

          <div className={`grid gap-4 ${welcomeConfig.actions.length >= 6 ? 'xl:grid-cols-3' : welcomeConfig.actions.length === 1 ? 'md:max-w-xl' : 'xl:grid-cols-2'}`}>
            {welcomeConfig.actions.map((action) => {
              const Icon = action.icon

              return (
                <Card
                  key={action.href}
                  className="border-white/10 bg-slate-950/65 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-4 inline-flex rounded-2xl bg-white/6 p-3">
                        <Icon className="h-6 w-6 text-violet-300" />
                      </div>
                      <h2 className="text-xl font-semibold">{action.label}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{action.note}</p>
                    </div>
                  </div>

                  <Button asChild className="mt-6 w-full">
                    <Link href={action.href}>
                      Открыть раздел
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </Card>
              )
            })}
          </div>
        </div>
    </>
  )
}
