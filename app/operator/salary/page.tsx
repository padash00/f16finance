'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CreditCard, DollarSign, Loader2, RefreshCw, TrendingDown, Wallet } from 'lucide-react'

import {
  OperatorEmptyState,
  OperatorMetricCard,
  OperatorPanel,
  OperatorPill,
  OperatorSectionHeading,
} from '@/components/operator/operator-mobile-ui'
import { Button } from '@/components/ui/button'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'

type SalaryData = {
  operator: { id: string; name: string; short_name: string | null }
  week: {
    id: string
    weekStart: string
    weekEnd: string
    grossAmount: number
    bonusAmount: number
    fineAmount: number
    debtAmount: number
    advanceAmount: number
    netAmount: number
    paidAmount: number
    remainingAmount: number
    status: 'draft' | 'partial' | 'paid'
    allocations: Array<{
      companyId: string
      companyName: string | null
      companyCode: string | null
      accruedAmount: number
      netAmount: number
      shareRatio: number
      details: {
        bonusAmount: number
        fineAmount: number
        debtAmount: number
        advanceAmount: number
      } | null
    }>
    payments: Array<{
      id: string
      payment_date: string
      cash_amount: number
      kaspi_amount: number
      total_amount: number
      comment: string | null
    }>
    adjustments: Array<{
      id: string
      date: string
      amount: number
      kind: 'bonus' | 'fine' | 'advance'
      comment: string | null
      companyName: string | null
    }>
    debts: Array<{
      id: string
      amount: number
      comment: string | null
      companyName: string | null
      date: string | null
    }>
  }
  recentWeeks: Array<{
    id: string
    weekStart: string
    weekEnd: string
    netAmount: number
    paidAmount: number
    remainingAmount: number
    status: 'draft' | 'partial' | 'paid'
    lastPaymentDate: string | null
    paymentsCount: number
  }>
}

const currentWeek = () => toISODateLocal(mondayOfDate(new Date()))

function weekStatusLabel(status: SalaryData['week']['status']) {
  if (status === 'paid') return 'Выплачено'
  if (status === 'partial') return 'Частично'
  return 'В работе'
}

export default function OperatorSalaryMobilePage() {
  const [weekStart, setWeekStart] = useState(currentWeek())
  const [data, setData] = useState<SalaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/operator/salary?weekStart=${encodeURIComponent(weekStart)}`, { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка загрузки (${response.status})`)
      setData(json)
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить зарплату')
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => {
    void load()
  }, [load])

  const adjustmentSummary = useMemo(() => {
    const list = data?.week.adjustments || []
    return {
      bonuses: list.filter((item) => item.kind === 'bonus').reduce((sum, item) => sum + item.amount, 0),
      fines: list.filter((item) => item.kind === 'fine').reduce((sum, item) => sum + item.amount, 0),
      advances: list.filter((item) => item.kind === 'advance').reduce((sum, item) => sum + item.amount, 0),
    }
  }, [data?.week.adjustments])

  return (
    <div className="space-y-4">
      <OperatorPanel accent="amber">
        <OperatorSectionHeading
          title={`${formatRuDate(weekStart)} - ${formatRuDate(addDaysISO(weekStart, 6))}`}
          description="Здесь видно начисление за неделю, долги, авансы и фактические выплаты без похода в админский контур."
          action={
            <Button type="button" variant="ghost" className="text-slate-300 hover:text-white" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]" onClick={() => setWeekStart(addDaysISO(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
            Прошлая
          </Button>
          <Button type="button" variant="outline" className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]" onClick={() => setWeekStart(currentWeek())}>
            Текущая
          </Button>
          <Button type="button" variant="outline" className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]" onClick={() => setWeekStart(addDaysISO(weekStart, 7))}>
            Следующая
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </OperatorPanel>

      {error ? <OperatorPanel className="border-red-500/25 bg-red-500/10 text-sm text-red-200">{error}</OperatorPanel> : null}

      {loading ? (
        <OperatorPanel>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <Loader2 className="h-5 w-5 animate-spin" />
            Загружаю недельный расчёт...
          </div>
        </OperatorPanel>
      ) : null}

      {!loading && data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <OperatorMetricCard label="К выплате" value={formatMoney(data.week.remainingAmount)} icon={DollarSign} tone="emerald" hint={`Статус недели: ${weekStatusLabel(data.week.status)}`} />
            <OperatorMetricCard label="Выплачено" value={formatMoney(data.week.paidAmount)} icon={CreditCard} tone="blue" hint={`Начислено: ${formatMoney(data.week.netAmount)}`} />
            <OperatorMetricCard label="Авансы" value={formatMoney(data.week.advanceAmount)} icon={Wallet} tone="amber" />
            <OperatorMetricCard label="Долги" value={formatMoney(data.week.debtAmount)} icon={TrendingDown} tone="red" />
          </div>

          <OperatorPanel>
            <OperatorSectionHeading title="По точкам" description="Как недельная сумма раскладывается по компаниям, где вы работали." />
            <div className="mt-4 space-y-3">
              {data.week.allocations.length === 0 ? (
                <OperatorEmptyState title="Разбивки по точкам пока нет" description="На этой неделе пока не появилось начислений, которые можно разложить по компаниям." />
              ) : (
                data.week.allocations.map((item) => (
                  <div key={item.companyId} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{item.companyName || 'Точка'}</div>
                        <div className="mt-1 text-xs text-slate-400">Доля недели: {Math.round((item.shareRatio || 0) * 100)}%</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-white">{formatMoney(item.netAmount)}</div>
                        <div className="mt-1 text-xs text-slate-400">Начислено: {formatMoney(item.accruedAmount)}</div>
                      </div>
                    </div>
                    {item.details ? (
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">Бонусы: {formatMoney(item.details.bonusAmount)}</div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">Штрафы: {formatMoney(item.details.fineAmount)}</div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">Долги: {formatMoney(item.details.debtAmount)}</div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">Авансы: {formatMoney(item.details.advanceAmount)}</div>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </OperatorPanel>

          <div className="grid gap-4 sm:grid-cols-2">
            <OperatorPanel>
              <OperatorSectionHeading title="Выплаты" description="Фактические выплаты по неделе с разбивкой по способу оплаты." />
              <div className="mt-4 space-y-3">
                {data.week.payments.length === 0 ? (
                  <OperatorEmptyState title="Выплат пока нет" description="Когда по этой неделе появятся выплаты, они будут отображаться здесь." />
                ) : (
                  data.week.payments.map((payment) => (
                    <div key={payment.id} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-white">{formatRuDate(payment.payment_date, 'full')}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            Нал: {formatMoney(payment.cash_amount)} · Kaspi: {formatMoney(payment.kaspi_amount)}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-white">{formatMoney(payment.total_amount)}</div>
                      </div>
                      {payment.comment ? <div className="mt-2 text-xs text-slate-400">{payment.comment}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </OperatorPanel>

            <OperatorPanel>
              <OperatorSectionHeading title="Корректировки недели" description="Бонусы, штрафы, авансы и долги, которые влияют на итог." />

              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <OperatorPill tone="emerald">Бонусы: {formatMoney(adjustmentSummary.bonuses)}</OperatorPill>
                <OperatorPill tone="red">Штрафы: {formatMoney(adjustmentSummary.fines)}</OperatorPill>
                <OperatorPill tone="amber">Авансы: {formatMoney(adjustmentSummary.advances)}</OperatorPill>
              </div>

              <div className="mt-4 space-y-3">
                {[...data.week.adjustments, ...data.week.debts].length === 0 ? (
                  <OperatorEmptyState title="Корректировок нет" description="На этой неделе не было бонусов, штрафов, авансов или долгов." />
                ) : null}

                {data.week.adjustments.map((item) => (
                  <div key={item.id} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{item.kind === 'bonus' ? 'Бонус' : item.kind === 'advance' ? 'Аванс' : 'Штраф'}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {formatRuDate(item.date, 'full')}
                          {item.companyName ? ` · ${item.companyName}` : ''}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-white">{formatMoney(item.amount)}</div>
                    </div>
                    {item.comment ? <div className="mt-2 text-xs text-slate-400">{item.comment}</div> : null}
                  </div>
                ))}

                {data.week.debts.map((item) => (
                  <div key={item.id} className="rounded-[1.4rem] border border-red-500/20 bg-red-500/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">Долг</div>
                        <div className="mt-1 text-xs text-red-100/80">
                          {item.date ? formatRuDate(item.date, 'full') : 'Дата не указана'}
                          {item.companyName ? ` · ${item.companyName}` : ''}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-red-100">{formatMoney(item.amount)}</div>
                    </div>
                    {item.comment ? <div className="mt-2 text-xs text-red-100/80">{item.comment}</div> : null}
                  </div>
                ))}
              </div>
            </OperatorPanel>
          </div>

          <OperatorPanel>
            <OperatorSectionHeading title="История по неделям" description="Последние недели, чтобы быстро понимать динамику выплат." />
            <div className="mt-4 space-y-3">
              {data.recentWeeks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setWeekStart(item.weekStart)}
                  className={`w-full rounded-[1.4rem] border p-4 text-left transition ${
                    item.weekStart === weekStart ? 'border-amber-400/30 bg-amber-400/10' : 'border-white/10 bg-slate-950/40 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">
                        {formatRuDate(item.weekStart)} - {formatRuDate(item.weekEnd)}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        Выплат: {item.paymentsCount}
                        {item.lastPaymentDate ? ` · Последняя ${formatRuDate(item.lastPaymentDate)}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-white">{formatMoney(item.remainingAmount)}</div>
                      <div className="mt-1 text-xs text-slate-400">{weekStatusLabel(item.status)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </OperatorPanel>
        </>
      ) : null}
    </div>
  )
}
