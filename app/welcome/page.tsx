'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  CalendarClock,
  CalendarRange,
  FolderKanban,
  Loader2,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { StaffRole } from '@/lib/core/access'

type SessionRoleResponse = {
  ok: boolean
  isSuperAdmin?: boolean
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
]

const MARKETER_ACTIONS: WelcomeAction[] = [
  { href: '/tasks', label: 'Задачи', note: 'Постановка, контроль и сопровождение задач', icon: FolderKanban },
]

export default function WelcomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [roleLabel, setRoleLabel] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

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
        setStaffRole((json.staffRole as StaffRole | null) || null)
        setRoleLabel((json.roleLabel as string | null) || null)
        setDisplayName((json.displayName as string | null) || null)

        if (json.isSuperAdmin) {
          router.replace('/')
          return
        }

        if (json.staffRole !== 'manager' && json.staffRole !== 'marketer') {
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
    if (staffRole === 'manager') {
      return {
        title: 'Добро пожаловать, руководитель',
        description: 'У вас открыт доступ только к ключевым операционным и финансовым разделам.',
        checklist: [
          'Проверьте график смен и расставьте операторов на текущую неделю.',
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
  }, [staffRole])

  if (loading) {
    return (
      <div className="app-shell-layout">
        <Sidebar />
        <main className="app-main">
          <div className="app-page flex min-h-[60vh] items-center justify-center">
            <Card className="w-full max-w-xl border-white/10 bg-slate-950/70 p-6 text-white">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                Подготавливаем ваш рабочий раздел...
              </div>
            </Card>
          </div>
        </main>
      </div>
    )
  }

  if (isSuperAdmin) {
    return null
  }

  return (
    <div className="app-shell-layout">
      <Sidebar />
      <main className="app-main">
        <div className="app-page space-y-6">
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.18),transparent_34%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.32)] sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200">
                    {roleLabel || 'Рабочий контур'}
                  </span>
                  {displayName ? (
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-medium text-slate-300">
                      {displayName}
                    </span>
                  ) : null}
                </div>
                <div className="mb-4 inline-flex rounded-2xl bg-violet-500/12 p-4">
                  <ShieldCheck className="h-7 w-7 text-violet-300" />
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

          <div className={`grid gap-4 ${welcomeConfig.actions.length === 1 ? 'md:max-w-xl' : 'xl:grid-cols-2'}`}>
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
      </main>
    </div>
  )
}
