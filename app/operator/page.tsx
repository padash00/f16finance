'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BadgeCheck, Briefcase, CalendarDays, Loader2, MapPin, Sparkles, Wallet } from 'lucide-react'

import { OperatorSectionCard } from '@/components/operator/operator-app-shell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatRuDate } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'

type OverviewData = {
  operator: { id: string; name: string; short_name: string | null }
  week: {
    weekStart: string
    weekEnd: string
    netAmount: number
    paidAmount: number
    remainingAmount: number
    debtAmount: number
    advanceAmount: number
    status: 'draft' | 'partial' | 'paid'
  }
  counters: {
    activeTasks: number
    reviewTasks: number
    activeDebts: number
    activeDebtAmount: number
    leadPoints: number
  }
  nextShift: { label: string } | null
  activeTasks: Array<{ id: string; title: string; status: string; priority: string; due_date: string | null }>
  recentDebts: Array<{ id: string; amount: number; comment: string | null; week_start: string | null; companyName: string | null }>
  leadAssignments: Array<{ id: string; companyId: string; companyName: string | null; companyCode: string | null; role: string; isPrimary: boolean }>
}

function statusLabel(status: OverviewData['week']['status']) {
  if (status === 'paid') return 'Неделя закрыта'
  if (status === 'partial') return 'Выплачено частично'
  return 'Неделя в работе'
}

export default function OperatorHomePage() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/operator/overview', { cache: 'no-store' })
        const json = await response.json().catch(() => null)
        if (!response.ok) throw new Error(json?.error || `Ошибка загрузки (${response.status})`)
        if (!cancelled) {
          setData(json)
          setError(null)
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Не удалось загрузить данные оператора')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const chips = useMemo(() => {
    if (!data) return []
    return [
      { label: 'Текущая неделя', value: `${formatRuDate(data.week.weekStart)} - ${formatRuDate(data.week.weekEnd)}` },
      { label: 'Статус', value: statusLabel(data.week.status) },
      { label: 'Новых задач', value: String(data.counters.activeTasks) },
    ]
  }, [data])

  if (loading) {
    return (
      <Card className="mt-4 border-white/10 bg-white/[0.045] p-6 text-slate-300">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
          Загружаю ваш рабочий день...
        </div>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className="mt-4 border-red-500/25 bg-red-500/10 p-6 text-sm text-red-200">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>{error || 'Не удалось загрузить операторский кабинет'}</div>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.16),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.05),_rgba(255,255,255,0.03))] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">Здравствуйте</div>
            <div className="mt-1 text-2xl font-semibold text-white">{data.operator.name}</div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Здесь видно всё важное по работе: ближайшую смену, новые задачи, долг и сумму к выплате за неделю.
            </p>
          </div>
          <div className="rounded-2xl bg-emerald-500/15 p-3 text-emerald-300">
            <Sparkles className="h-6 w-6" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <div key={chip.label} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300">
              {chip.label}: <span className="font-medium text-white">{chip.value}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-white/10 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-500/15 p-2.5 text-blue-300">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Следующая смена</div>
              <div className="mt-1 text-base font-semibold text-white">{data.nextShift?.label || 'Сейчас нет смен в графике'}</div>
            </div>
          </div>
          <Button asChild variant="outline" className="mt-4 w-full border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]">
            <Link href="/operator/shifts">Открыть график</Link>
          </Button>
        </Card>

        <Card className="border-white/10 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-500/15 p-2.5 text-amber-300">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">К выплате за неделю</div>
              <div className="mt-1 text-2xl font-semibold text-white">{formatMoney(data.week.remainingAmount)}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-slate-400">
              Начислено
              <div className="mt-1 text-sm font-semibold text-white">{formatMoney(data.week.netAmount)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-slate-400">
              Выплачено
              <div className="mt-1 text-sm font-semibold text-white">{formatMoney(data.week.paidAmount)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-slate-400">
              Долги
              <div className="mt-1 text-sm font-semibold text-white">{formatMoney(data.week.debtAmount)}</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-white/10 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-violet-500/15 p-2.5 text-violet-300">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Задачи</div>
              <div className="mt-1 text-2xl font-semibold text-white">{data.counters.activeTasks}</div>
            </div>
          </div>
          <div className="mt-3 text-sm text-slate-300">
            На проверке: <span className="font-medium text-white">{data.counters.reviewTasks}</span>
          </div>
        </Card>

        <Card className="border-white/10 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-red-500/15 p-2.5 text-red-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Долги</div>
              <div className="mt-1 text-2xl font-semibold text-white">{formatMoney(data.counters.activeDebtAmount)}</div>
            </div>
          </div>
          <div className="mt-3 text-sm text-slate-300">
            Активных записей: <span className="font-medium text-white">{data.counters.activeDebts}</span>
          </div>
        </Card>

        <Card className="border-white/10 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-500/15 p-2.5 text-emerald-300">
              <BadgeCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Точки ответственности</div>
              <div className="mt-1 text-2xl font-semibold text-white">{data.counters.leadPoints}</div>
            </div>
          </div>
          <div className="mt-3 text-sm text-slate-300">Если вы старший, здесь будут ваши закреплённые точки.</div>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <OperatorSectionCard
          eyebrow="Быстрый переход"
          title="Мои смены"
          description="Посмотреть текущую неделю, подтвердить график и сообщить о проблеме по конкретной смене."
          href="/operator/shifts"
        />
        <OperatorSectionCard
          eyebrow="Быстрый переход"
          title="Мои задачи"
          description="Открыть новые задачи, взять их в работу и быстро отправить комментарий руководителю."
          href="/operator/tasks"
        />
        <OperatorSectionCard
          eyebrow="Быстрый переход"
          title="Моя зарплата"
          description="Следить за начислением, авансами, долгами и фактическими выплатами по неделям."
          href="/operator/salary"
        />
        <OperatorSectionCard
          eyebrow="Быстрый переход"
          title="Мой профиль"
          description="Проверить контакты, закреплённые точки и перейти в настройки, если нужно обновить данные."
          href="/operator/profile"
        />
      </div>

      {(data.activeTasks.length > 0 || data.recentDebts.length > 0) && (
        <div className="grid gap-4">
          {data.activeTasks.length > 0 ? (
            <Card className="border-white/10 bg-white/[0.045] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">Что важно сделать сейчас</div>
                  <p className="mt-1 text-sm text-slate-400">Три ближайшие задачи, чтобы не пропустить рабочие поручения.</p>
                </div>
                <Button asChild variant="ghost" className="text-slate-300 hover:text-white">
                  <Link href="/operator/tasks">
                    Все задачи
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                {data.activeTasks.map((task) => (
                  <div key={task.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{task.title}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {task.due_date ? `Срок: ${formatRuDate(task.due_date, 'full')}` : 'Без дедлайна'}
                        </div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                        {task.priority}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {data.recentDebts.length > 0 ? (
            <Card className="border-white/10 bg-white/[0.045] p-5">
              <div className="text-lg font-semibold text-white">Свежие долги</div>
              <p className="mt-1 text-sm text-slate-400">Что уже попало в расчёт этой недели.</p>
              <div className="mt-4 space-y-3">
                {data.recentDebts.map((debt) => (
                  <div key={debt.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{debt.comment || 'Долг по товару'}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                          <MapPin className="h-3.5 w-3.5" />
                          {debt.companyName || 'Точка не указана'}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-red-300">{formatMoney(debt.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  )
}
