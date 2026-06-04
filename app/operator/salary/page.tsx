'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Award,
  Calendar,
  CreditCard,
  Loader2,
  Minus,
  Moon,
  Package,
  RefreshCw,
  Sun,
  TrendingDown,
  Wallet,
} from 'lucide-react'

import {
  OperatorEmptyState,
  OperatorMetricCard,
  OperatorPanel,
  OperatorPill,
  OperatorSectionHeading,
} from '@/components/operator/operator-mobile-ui'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'
import { cn } from '@/lib/utils'

type ShiftBreakdown = {
  date: string
  shift: 'day' | 'night'
  companyName: string | null
  totalIncome: number
  cash: number
  kaspi: number
  online: number
  card: number
  baseSalary: number
  seniorityBonus: number
  seniorityPercent: number
  autoBonus: number
  roleBonus: number
  salary: number
}

type DebtItem = {
  id: string
  itemName: string
  barcode: string | null
  quantity: number
  unitPrice: number
  totalAmount: number
  clientName: string | null
  comment: string | null
  weekStart: string | null
  createdAt: string | null
  companyName: string | null
}

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
    seniorityBonusTotal?: number
    autoBonusTotal?: number
    shiftsCount?: number
    shifts?: ShiftBreakdown[]
    allocations: Array<{
      companyId: string
      companyName: string | null
      companyCode: string | null
      accruedAmount: number
      netAmount: number
      shareRatio: number
      details: { bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number } | null
    }>
    payments: Array<{ id: string; payment_date: string; cash_amount: number; kaspi_amount: number; total_amount: number; comment: string | null }>
    adjustments: Array<{ id: string; date: string; amount: number; kind: 'bonus' | 'fine' | 'advance'; comment: string | null; companyName: string | null }>
    debts: Array<{ id: string; amount: number; comment: string | null; companyName: string | null; date: string | null }>
  }
  debtItems?: DebtItem[]
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

// Строка бухгалтерской ведомости: метка ····· сумма (моно, выровнено справа).
function LedgerRow({
  label,
  value,
  sign,
  hint,
  strong,
}: {
  label: string
  value: number
  sign: 'plus' | 'minus' | 'total'
  hint?: string
  strong?: boolean
}) {
  const color = sign === 'minus' ? 'text-rose-400' : sign === 'total' ? 'text-amber-400' : 'text-zinc-100'
  const prefix = sign === 'minus' ? '−' : sign === 'plus' ? '+' : ''
  return (
    <div className={cn('flex items-baseline gap-2', strong && 'mt-1 border-t border-[#23262b] pt-3')}>
      <div className="shrink-0">
        <span className={cn('font-mono text-[13px] uppercase tracking-wide', strong ? 'font-semibold text-zinc-100' : 'text-zinc-400')}>{label}</span>
        {hint ? <div className="font-mono text-[10px] normal-case tracking-normal text-zinc-600">{hint}</div> : null}
      </div>
      <div className="min-w-0 flex-1 -translate-y-1 border-b border-dotted border-[#2c2f35]" aria-hidden />
      <span className={cn('shrink-0 font-mono tabular-nums', strong ? 'text-lg font-bold' : 'text-[15px] font-medium', color)}>
        {prefix}
        {formatMoney(value)}
      </span>
    </div>
  )
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
      bonuses: list.filter((i) => i.kind === 'bonus').reduce((s, i) => s + i.amount, 0),
      fines: list.filter((i) => i.kind === 'fine').reduce((s, i) => s + i.amount, 0),
      advances: list.filter((i) => i.kind === 'advance').reduce((s, i) => s + i.amount, 0),
    }
  }, [data?.week.adjustments])

  const debtItems = useMemo(() => data?.debtItems || [], [data?.debtItems])
  const debtItemsTotal = useMemo(() => debtItems.reduce((s, i) => s + (i.totalAmount || 0), 0), [debtItems])
  const shifts = useMemo(() => data?.week.shifts || [], [data?.week.shifts])
  const baseTotal = useMemo(() => {
    const gross = data?.week.grossAmount || 0
    const seniority = data?.week.seniorityBonusTotal || 0
    const role = shifts.reduce((s, x) => s + (x.roleBonus || 0), 0)
    return Math.max(0, gross - seniority - role)
  }, [data?.week.grossAmount, data?.week.seniorityBonusTotal, shifts])
  const roleTotal = useMemo(() => shifts.reduce((s, x) => s + (x.roleBonus || 0), 0), [shifts])
  const turnoverTotal = useMemo(() => shifts.reduce((s, x) => s + (x.totalIncome || 0), 0), [shifts])

  const paidPct = data && data.week.netAmount > 0 ? Math.min(100, Math.max(0, (data.week.paidAmount / data.week.netAmount) * 100)) : 0

  return (
    <div className="space-y-3">
      {/* Навигация по неделям — сегментированный контрол */}
      <div className="flex items-stretch border border-[#23262b]">
        <button type="button" onClick={() => setWeekStart(addDaysISO(weekStart, -7))} className="flex-1 border-r border-[#23262b] py-2.5 font-mono text-[11px] uppercase tracking-wide text-zinc-400 transition hover:bg-white/[0.03] hover:text-zinc-100">
          ← Прошлая
        </button>
        <button type="button" onClick={() => setWeekStart(currentWeek())} className="flex-1 border-r border-[#23262b] py-2.5 font-mono text-[11px] uppercase tracking-wide text-zinc-400 transition hover:bg-white/[0.03] hover:text-zinc-100">
          Текущая
        </button>
        <button type="button" onClick={() => setWeekStart(addDaysISO(weekStart, 7))} className="flex-1 py-2.5 font-mono text-[11px] uppercase tracking-wide text-zinc-400 transition hover:bg-white/[0.03] hover:text-zinc-100">
          Следующая →
        </button>
      </div>

      {error ? <OperatorPanel className="border-rose-500/40 text-sm text-rose-300">{error}</OperatorPanel> : null}

      {loading ? (
        <OperatorPanel>
          <div className="flex items-center gap-3 font-mono text-[13px] uppercase tracking-wide text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка расчёта…
          </div>
        </OperatorPanel>
      ) : null}

      {!loading && data ? (
        <>
          {/* Герой — К выплате */}
          <OperatorPanel accent="amber">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                  К выплате · {formatRuDate(weekStart)} — {formatRuDate(addDaysISO(weekStart, 6))}
                </div>
                <div className="mt-2 font-mono text-[2.6rem] font-bold leading-none tracking-tight tabular-nums text-amber-400 sm:text-6xl">{formatMoney(data.week.remainingAmount)}</div>
                <div className="mt-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                  Начислено {formatMoney(data.week.netAmount)} · Выплачено {formatMoney(data.week.paidAmount)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="border border-[#23262b] px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-zinc-300">{weekStatusLabel(data.week.status)}</span>
                <button type="button" onClick={() => void load()} className="border border-[#23262b] p-2 text-zinc-500 transition hover:text-zinc-100" aria-label="Обновить">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-4 h-1 w-full bg-[#1c1e22]">
              <div className="h-full bg-amber-400 transition-all" style={{ width: `${paidPct}%` }} />
            </div>
          </OperatorPanel>

          {/* Метрики */}
          <div className="grid gap-3 sm:grid-cols-3">
            <OperatorMetricCard label="Выплачено" value={formatMoney(data.week.paidAmount)} icon={CreditCard} tone="emerald" hint={`из ${formatMoney(data.week.netAmount)}`} />
            <OperatorMetricCard label="Смен" value={String(data.week.shiftsCount ?? shifts.length)} icon={Calendar} hint={turnoverTotal > 0 ? `оборот ${formatMoney(turnoverTotal)}` : undefined} />
            <OperatorMetricCard label="Долг всего" value={formatMoney(debtItemsTotal)} icon={TrendingDown} tone="red" hint={`позиций ${debtItems.length}`} />
          </div>

          {/* Ведомость — из чего складывается */}
          <OperatorPanel accent="amber">
            <OperatorSectionHeading title="Из чего складывается" description="Начисления плюс, удержания минус, итог — к выплате." />
            <div className="mt-4 space-y-3">
              <LedgerRow label="Начислено за смены" value={data.week.grossAmount} sign="plus" hint={`база ${formatMoney(baseTotal)}${(data.week.seniorityBonusTotal || 0) > 0 ? ` · стаж ${formatMoney(data.week.seniorityBonusTotal || 0)}` : ''}${roleTotal > 0 ? ` · роль ${formatMoney(roleTotal)}` : ''}`} />
              {(data.week.autoBonusTotal || 0) > 0 ? <LedgerRow label="Бонус за оборот" value={data.week.autoBonusTotal || 0} sign="plus" hint="за выполнение порога выручки" /> : null}
              {data.week.bonusAmount > 0 ? <LedgerRow label="Премии" value={data.week.bonusAmount} sign="plus" /> : null}
              {data.week.fineAmount > 0 ? <LedgerRow label="Штрафы" value={data.week.fineAmount} sign="minus" /> : null}
              {data.week.debtAmount > 0 ? <LedgerRow label="Долг (вычет)" value={data.week.debtAmount} sign="minus" hint="списано в счёт долга за товар" /> : null}
              {data.week.advanceAmount > 0 ? <LedgerRow label="Аванс" value={data.week.advanceAmount} sign="minus" hint="выдано ранее" /> : null}
              <LedgerRow label="К выплате" value={data.week.netAmount} sign="total" strong />
            </div>
          </OperatorPanel>

          {/* По сменам */}
          <OperatorPanel>
            <OperatorSectionHeading title="По сменам" description="Оборот точки и из чего вышла оплата за смену." />
            <div className="mt-4 grid gap-2 xl:grid-cols-2">
              {shifts.length === 0 ? (
                <OperatorEmptyState title="Смен пока нет" description="За эту неделю по вам ещё нет отработанных смен с оборотом." />
              ) : (
                shifts.map((s, i) => (
                  <div key={`${s.date}-${s.shift}-${i}`} className="border border-[#23262b] bg-[#0b0c0d] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('flex h-7 w-7 items-center justify-center border', s.shift === 'night' ? 'border-indigo-500/40 text-indigo-300' : 'border-amber-500/40 text-amber-300')}>
                          {s.shift === 'night' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                        </span>
                        <div>
                          <div className="font-mono text-[13px] font-semibold text-zinc-100">{formatRuDate(s.date, 'full')}</div>
                          <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">{s.shift === 'night' ? 'Ночь' : 'День'}{s.companyName ? ` · ${s.companyName}` : ''}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[15px] font-bold tabular-nums text-amber-400">{formatMoney(s.salary)}</div>
                        <div className="font-mono text-[9px] uppercase tracking-wide text-zinc-600">за смену</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-px border border-[#23262b] bg-[#23262b] font-mono text-[11px] tabular-nums">
                      <div className="bg-[#0b0c0d] px-2.5 py-1.5 text-zinc-400">Оборот <span className="float-right text-zinc-100">{formatMoney(s.totalIncome)}</span></div>
                      <div className="bg-[#0b0c0d] px-2.5 py-1.5 text-zinc-400">База <span className="float-right text-zinc-100">{formatMoney(s.baseSalary)}</span></div>
                      {s.autoBonus > 0 ? <div className="bg-[#0b0c0d] px-2.5 py-1.5 text-zinc-400">Бонус <span className="float-right text-emerald-400">{formatMoney(s.autoBonus)}</span></div> : null}
                      {s.seniorityBonus > 0 ? <div className="bg-[#0b0c0d] px-2.5 py-1.5 text-zinc-400">Стаж{s.seniorityPercent ? ` ${s.seniorityPercent}%` : ''} <span className="float-right text-zinc-100">{formatMoney(s.seniorityBonus)}</span></div> : null}
                      {s.roleBonus > 0 ? <div className="bg-[#0b0c0d] px-2.5 py-1.5 text-zinc-400">Роль <span className="float-right text-zinc-100">{formatMoney(s.roleBonus)}</span></div> : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </OperatorPanel>

          {/* Что взято в долг */}
          <OperatorPanel accent="amber">
            <OperatorSectionHeading title="Что взято в долг" description="Товары, взятые в долг (все активные записи). Постепенно удерживается из зарплаты." />
            <div className="mt-3 flex flex-wrap gap-2">
              <OperatorPill tone="red">Долг {formatMoney(debtItemsTotal)}</OperatorPill>
              <OperatorPill tone="amber">Позиций {debtItems.length}</OperatorPill>
            </div>
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {debtItems.length === 0 ? (
                <OperatorEmptyState title="Долгов по товарам нет" description="За вами не числится товаров, взятых в долг." />
              ) : (
                debtItems.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 border border-[#23262b] bg-[#0b0c0d] p-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-amber-500/40 text-amber-300">
                        <Package className="h-3 w-3" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[13px] text-zinc-100">{item.itemName}</div>
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-500 tabular-nums">
                          {item.quantity} × {formatMoney(item.unitPrice)}{item.createdAt ? ` · ${formatRuDate(item.createdAt)}` : ''}{item.companyName ? ` · ${item.companyName}` : ''}
                        </div>
                        {item.clientName ? <div className="font-mono text-[10px] text-zinc-600">Клиент: {item.clientName}</div> : null}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-[14px] font-semibold tabular-nums text-amber-400">{formatMoney(item.totalAmount)}</div>
                  </div>
                ))
              )}
            </div>
          </OperatorPanel>

          {/* По точкам */}
          {data.week.allocations.length > 0 ? (
            <OperatorPanel>
              <OperatorSectionHeading title="По точкам" description="Раскладка недельной суммы по компаниям." />
              <div className="mt-4 space-y-2">
                {data.week.allocations.map((item) => (
                  <div key={item.companyId} className="border border-[#23262b] bg-[#0b0c0d] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] text-zinc-100">{item.companyName || 'Точка'}</div>
                        <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 tabular-nums">доля {Math.round((item.shareRatio || 0) * 100)}%</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[14px] font-semibold tabular-nums text-zinc-100">{formatMoney(item.netAmount)}</div>
                        <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 tabular-nums">нач. {formatMoney(item.accruedAmount)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </OperatorPanel>
          ) : null}

          {/* Штрафы/премии/авансы + Выплаты */}
          <div className="grid gap-3 sm:grid-cols-2">
            <OperatorPanel>
              <OperatorSectionHeading title="Штрафы · премии · авансы" description="Корректировки недели с причиной." />
              <div className="mt-3 flex flex-wrap gap-2">
                <OperatorPill tone="emerald">Премии {formatMoney(adjustmentSummary.bonuses)}</OperatorPill>
                <OperatorPill tone="red">Штрафы {formatMoney(adjustmentSummary.fines)}</OperatorPill>
                <OperatorPill tone="amber">Авансы {formatMoney(adjustmentSummary.advances)}</OperatorPill>
              </div>
              <div className="mt-4 space-y-2">
                {data.week.adjustments.length === 0 ? (
                  <OperatorEmptyState title="Корректировок нет" description="На этой неделе не было штрафов, премий или авансов." />
                ) : null}
                {data.week.adjustments.map((item) => (
                  <div key={item.id} className="border border-[#23262b] bg-[#0b0c0d] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('flex h-6 w-6 items-center justify-center border', item.kind === 'fine' ? 'border-rose-500/40 text-rose-300' : item.kind === 'advance' ? 'border-amber-500/40 text-amber-300' : 'border-emerald-500/40 text-emerald-300')}>
                          {item.kind === 'fine' ? <Minus className="h-3 w-3" /> : item.kind === 'advance' ? <Wallet className="h-3 w-3" /> : <Award className="h-3 w-3" />}
                        </span>
                        <div>
                          <div className="font-mono text-[12px] uppercase tracking-wide text-zinc-100">{item.kind === 'bonus' ? 'Премия' : item.kind === 'advance' ? 'Аванс' : 'Штраф'}</div>
                          <div className="font-mono text-[10px] text-zinc-500">{formatRuDate(item.date, 'full')}{item.companyName ? ` · ${item.companyName}` : ''}</div>
                        </div>
                      </div>
                      <div className={cn('font-mono text-[14px] font-semibold tabular-nums', item.kind === 'bonus' ? 'text-emerald-400' : 'text-rose-400')}>{formatMoney(item.amount)}</div>
                    </div>
                    {item.comment ? <div className="mt-2 text-[12px] leading-4 text-zinc-500">Причина: {item.comment}</div> : null}
                  </div>
                ))}
              </div>
            </OperatorPanel>

            <OperatorPanel>
              <OperatorSectionHeading title="Выплаты" description="Фактические выплаты по неделе." />
              <div className="mt-4 space-y-2">
                {data.week.payments.length === 0 ? (
                  <OperatorEmptyState title="Выплат пока нет" description="Когда по этой неделе появятся выплаты, они будут здесь." />
                ) : (
                  data.week.payments.map((payment) => (
                    <div key={payment.id} className="border border-emerald-500/20 bg-[#0b0c0d] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-[13px] text-zinc-100">{formatRuDate(payment.payment_date, 'full')}</div>
                          <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 tabular-nums">нал {formatMoney(payment.cash_amount)} · kaspi {formatMoney(payment.kaspi_amount)}</div>
                        </div>
                        <div className="font-mono text-[15px] font-bold tabular-nums text-emerald-400">{formatMoney(payment.total_amount)}</div>
                      </div>
                      {payment.comment ? <div className="mt-2 text-[12px] leading-4 text-zinc-500">{payment.comment}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </OperatorPanel>
          </div>

          {/* История */}
          <OperatorPanel>
            <OperatorSectionHeading title="История по неделям" description="Нажмите неделю, чтобы открыть расчёт." />
            <div className="mt-4 space-y-1.5">
              {data.recentWeeks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setWeekStart(item.weekStart)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 border px-3 py-2.5 text-left transition',
                    item.weekStart === weekStart ? 'border-amber-400/50 bg-amber-400/[0.06]' : 'border-[#23262b] bg-[#0b0c0d] hover:border-zinc-600',
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] text-zinc-100 tabular-nums">{formatRuDate(item.weekStart)} — {formatRuDate(item.weekEnd)}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 tabular-nums">выплат {item.paymentsCount}{item.lastPaymentDate ? ` · посл. ${formatRuDate(item.lastPaymentDate)}` : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[13px] font-semibold tabular-nums text-zinc-100">{formatMoney(item.remainingAmount)}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">{weekStatusLabel(item.status)}</div>
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
