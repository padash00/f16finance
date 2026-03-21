'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  CalendarDays,
  Loader2,
  MapPin,
  Sparkles,
  Wallet,
} from 'lucide-react'

import { OperatorSectionCard } from '@/components/operator/operator-app-shell'
import {
  OperatorEmptyState,
  OperatorMetricCard,
  OperatorPanel,
  OperatorPill,
  OperatorSectionHeading,
} from '@/components/operator/operator-mobile-ui'
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
      { label: 'Текущая неделя', value: `${formatRuDate(data.week.weekStart)} - ${formatRuDate(data.week.weekEnd)}`, tone: 'blue' as const },
      { label: 'Статус', value: statusLabel(data.week.status), tone: data.week.status === 'paid' ? ('emerald' as const) : data.week.status === 'partial' ? ('amber' as const) : ('default' as const) },
      { label: 'Новых задач', value: String(data.counters.activeTasks), tone: data.counters.activeTasks > 0 ? ('amber' as const) : ('default' as const) },
    ]
  }, [data])

  if (loading) {
    return (
      <OperatorPanel>
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Загружаю ваш рабочий день...
        </div>
      </OperatorPanel>
    )
  }

  if (error || !data) {
    return (
      <OperatorPanel className="border-red-500/25 bg-red-500/10">
        <div className="flex items-start gap-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>{error || 'Не удалось загрузить операторский кабинет'}</div>
        </div>
      </OperatorPanel>
    )
  }

  return (
    <div className="space-y-4">
      <OperatorPanel accent="emerald">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
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
            <OperatorPill key={chip.label} tone={chip.tone}>
              {chip.label}: <span className="ml-1 font-semibold">{chip.value}</span>
            </OperatorPill>
          ))}
        </div>
      </OperatorPanel>

      <div className="grid gap-4 sm:grid-cols-2">
        <OperatorMetricCard
          label="Следующая смена"
          value={data.nextShift?.label || 'Сейчас в графике нет смен'}
          icon={CalendarDays}
          tone="blue"
          hint="Если график уже опубликован, здесь всегда будет ближайшая смена."
        />
        <OperatorMetricCard
          label="К выплате за неделю"
          value={formatMoney(data.week.remainingAmount)}
          icon={Wallet}
          tone="amber"
          hint={`Начислено ${formatMoney(data.week.netAmount)} · Выплачено ${formatMoney(data.week.paidAmount)}`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <OperatorMetricCard label="Активные задачи" value={data.counters.activeTasks} icon={Briefcase} tone="violet" hint={`На проверке: ${data.counters.reviewTasks}`} />
        <OperatorMetricCard label="Долги" value={formatMoney(data.counters.activeDebtAmount)} icon={AlertTriangle} tone="red" hint={`Активных записей: ${data.counters.activeDebts}`} />
        <OperatorMetricCard label="Точки ответственности" value={data.counters.leadPoints} icon={BadgeCheck} tone="emerald" hint="Показывает закреплённые точки, если вы старший." />
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

      <OperatorPanel>
        <OperatorSectionHeading
          title="Фокус на сегодня"
          description="Короткая сводка по тому, что важно не пропустить."
          action={
            <Button asChild variant="ghost" className="text-slate-300 hover:text-white">
              <Link href="/operator/tasks">
                Все задачи
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          }
        />

        <div className="mt-4 space-y-3">
          {data.activeTasks.length === 0 ? (
            <OperatorEmptyState title="Новых задач нет" description="Когда появятся новые поручения, они сразу будут показаны здесь и в разделе задач." />
          ) : (
            data.activeTasks.map((task) => (
              <div key={task.id} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{task.title}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {task.due_date ? `Срок: ${formatRuDate(task.due_date, 'full')}` : 'Без дедлайна'}
                    </div>
                  </div>
                  <OperatorPill tone={task.priority === 'critical' || task.priority === 'high' ? 'amber' : 'default'}>{task.priority}</OperatorPill>
                </div>
              </div>
            ))
          )}
        </div>
      </OperatorPanel>

      <div className="grid gap-4">
        <OperatorPanel>
          <OperatorSectionHeading title="Свежие долги" description="Что уже попало в расчёт этой недели." />
          <div className="mt-4 space-y-3">
            {data.recentDebts.length === 0 ? (
              <OperatorEmptyState title="Свежих долгов нет" description="Если на этой неделе не было долгов по товарам, блок останется пустым." />
            ) : (
              data.recentDebts.map((debt) => (
                <div key={debt.id} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">{debt.comment || 'Долг по товару'}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        <MapPin className="h-3.5 w-3.5" />
                        {debt.companyName || 'Точка не указана'}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-red-300">{formatMoney(debt.amount)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </OperatorPanel>

        {data.leadAssignments.length > 0 ? (
          <OperatorPanel accent="blue">
            <OperatorSectionHeading title="Точки под вашей ответственностью" description="Показываем закреплённые точки, если вы работаете как старший." />
            <div className="mt-4 flex flex-wrap gap-2">
              {data.leadAssignments.map((assignment) => (
                <OperatorPill key={assignment.id} tone={assignment.isPrimary ? 'blue' : 'default'}>
                  {assignment.companyName || 'Точка'}{assignment.isPrimary ? ' · основная' : ''}
                </OperatorPill>
              ))}
            </div>
          </OperatorPanel>
        ) : null}
      </div>
    </div>
  )
}
