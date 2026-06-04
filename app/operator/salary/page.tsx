'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Award,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Coins,
  CreditCard,
  DollarSign,
  Loader2,
  Minus,
  Moon,
  Package,
  Plus,
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
import { Button } from '@/components/ui/button'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'

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

// Строка расшифровки «из чего складывается зарплата»
function BreakdownRow({
  label,
  value,
  sign,
  hint,
  strong,
}: {
  label: string
  value: number
  sign: 'plus' | 'minus' | 'sum'
  hint?: string
  strong?: boolean
}) {
  const color =
    sign === 'minus' ? 'text-rose-300' : sign === 'plus' ? 'text-emerald-300' : 'text-white'
  const Icon = sign === 'minus' ? Minus : sign === 'plus' ? Plus : null
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        sign === 'sum' ? 'mt-1 border-t border-white/10 pt-3' : ''
      }`}
    >
      <div className="min-w-0">
        <div className={`text-sm ${strong ? 'font-semibold text-white' : 'text-slate-200'}`}>{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div> : null}
      </div>
      <div className={`flex items-center gap-1 text-sm font-semibold ${color} ${strong ? 'text-base' : ''}`}>
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {sign === 'minus' && value === 0 ? '' : null}
        {formatMoney(value)}
      </div>
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
      bonuses: list.filter((item) => item.kind === 'bonus').reduce((sum, item) => sum + item.amount, 0),
      fines: list.filter((item) => item.kind === 'fine').reduce((sum, item) => sum + item.amount, 0),
      advances: list.filter((item) => item.kind === 'advance').reduce((sum, item) => sum + item.amount, 0),
    }
  }, [data?.week.adjustments])

  const debtItems = useMemo(() => data?.debtItems || [], [data?.debtItems])
  const debtItemsTotal = useMemo(
    () => debtItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0),
    [debtItems],
  )
  const shifts = useMemo(() => data?.week.shifts || [], [data?.week.shifts])
  // База за смены = начислено − надбавка за стаж (грубо), для подписи
  const baseTotal = useMemo(() => {
    const gross = data?.week.grossAmount || 0
    const seniority = data?.week.seniorityBonusTotal || 0
    const role = shifts.reduce((s, x) => s + (x.roleBonus || 0), 0)
    return Math.max(0, gross - seniority - role)
  }, [data?.week.grossAmount, data?.week.seniorityBonusTotal, shifts])
  const roleTotal = useMemo(() => shifts.reduce((s, x) => s + (x.roleBonus || 0), 0), [shifts])

  return (
    <div className="space-y-4">
      <OperatorPanel accent="amber">
        <OperatorSectionHeading
          title={`${formatRuDate(weekStart)} - ${formatRuDate(addDaysISO(weekStart, 6))}`}
          description="Полная расшифровка зарплаты за неделю: из чего складывается, по сменам, какие товары взяты в долг, штрафы и бонусы."
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <OperatorMetricCard label="К выплате" value={formatMoney(data.week.remainingAmount)} icon={DollarSign} tone="emerald" hint={`Статус недели: ${weekStatusLabel(data.week.status)}`} />
            <OperatorMetricCard label="Выплачено" value={formatMoney(data.week.paidAmount)} icon={CreditCard} tone="blue" hint={`Начислено за неделю: ${formatMoney(data.week.netAmount)}`} />
            <OperatorMetricCard label="Смен отработано" value={String(data.week.shiftsCount ?? shifts.length)} icon={Calendar} tone="violet" hint={shifts.length ? `Оборот: ${formatMoney(shifts.reduce((s, x) => s + x.totalIncome, 0))}` : undefined} />
            <OperatorMetricCard label="Долг (всего)" value={formatMoney(debtItemsTotal)} icon={TrendingDown} tone="red" hint={`Позиций: ${debtItems.length}`} />
          </div>

          {/* ── Из чего складывается зарплата ─────────────────────────────── */}
          <OperatorPanel accent="emerald">
            <OperatorSectionHeading title="Из чего складывается" description="Прозрачный расчёт: начисления плюс, удержания минус, итог — к выплате." />
            <div className="mt-4 space-y-3">
              <BreakdownRow label="Начислено за смены" value={data.week.grossAmount} sign="plus" hint={`База ${formatMoney(baseTotal)}${(data.week.seniorityBonusTotal || 0) > 0 ? ` · стаж ${formatMoney(data.week.seniorityBonusTotal || 0)}` : ''}${roleTotal > 0 ? ` · роль ${formatMoney(roleTotal)}` : ''}`} />
              {(data.week.autoBonusTotal || 0) > 0 ? (
                <BreakdownRow label="Бонусы за оборот" value={data.week.autoBonusTotal || 0} sign="plus" hint="Авто-бонус за выполнение порога выручки" />
              ) : null}
              {data.week.bonusAmount > 0 ? (
                <BreakdownRow label="Премии" value={data.week.bonusAmount} sign="plus" hint="Ручные премии" />
              ) : null}
              {data.week.fineAmount > 0 ? (
                <BreakdownRow label="Штрафы" value={data.week.fineAmount} sign="minus" />
              ) : null}
              {data.week.debtAmount > 0 ? (
                <BreakdownRow label="Долг (вычет из ЗП)" value={data.week.debtAmount} sign="minus" hint="Списано из зарплаты в счёт долга за товар" />
              ) : null}
              {data.week.advanceAmount > 0 ? (
                <BreakdownRow label="Аванс" value={data.week.advanceAmount} sign="minus" hint="Выдано авансом ранее" />
              ) : null}
              <BreakdownRow label="К выплате" value={data.week.netAmount} sign="sum" strong />
            </div>
          </OperatorPanel>

          {/* ── По сменам ─────────────────────────────────────────────────── */}
          <OperatorPanel>
            <OperatorSectionHeading title="По сменам" description="Каждая смена: оборот точки и из чего вышла оплата за смену." />
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {shifts.length === 0 ? (
                <OperatorEmptyState title="Смен пока нет" description="За эту неделю по вам ещё нет отработанных смен с оборотом." />
              ) : (
                shifts.map((s, i) => (
                  <div key={`${s.date}-${s.shift}-${i}`} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${s.shift === 'night' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-amber-500/20 text-amber-300'}`}>
                          {s.shift === 'night' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                        </span>
                        <div>
                          <div className="text-sm font-medium text-white">{formatRuDate(s.date, 'full')}</div>
                          <div className="text-xs text-slate-400">{s.shift === 'night' ? 'Ночная' : 'Дневная'}{s.companyName ? ` · ${s.companyName}` : ''}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-emerald-300">{formatMoney(s.salary)}</div>
                        <div className="text-[11px] text-slate-500">оплата за смену</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">Оборот: <span className="font-medium text-white">{formatMoney(s.totalIncome)}</span></div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">База: {formatMoney(s.baseSalary)}</div>
                      {s.autoBonus > 0 ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-emerald-200">Бонус: {formatMoney(s.autoBonus)}</div> : null}
                      {s.seniorityBonus > 0 ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">Стаж{s.seniorityPercent ? ` ${s.seniorityPercent}%` : ''}: {formatMoney(s.seniorityBonus)}</div> : null}
                      {s.roleBonus > 0 ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">Роль: {formatMoney(s.roleBonus)}</div> : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </OperatorPanel>

          {/* ── Что взято в долг (по товарам) ─────────────────────────────── */}
          <OperatorPanel accent="amber">
            <OperatorSectionHeading
              title="Что взято в долг"
              description="Список товаров, взятых в долг (все активные записи). Это то, что числится за вами и постепенно удерживается из зарплаты."
            />
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <OperatorPill tone="red">Всего долг: {formatMoney(debtItemsTotal)}</OperatorPill>
              <OperatorPill tone="amber">Позиций: {debtItems.length}</OperatorPill>
            </div>
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {debtItems.length === 0 ? (
                <OperatorEmptyState title="Долгов по товарам нет" description="За вами не числится товаров, взятых в долг. Отлично!" />
              ) : (
                debtItems.map((item) => (
                  <div key={item.id} className="rounded-[1.2rem] border border-white/10 bg-slate-950/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                          <Package className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">{item.itemName}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {item.quantity} × {formatMoney(item.unitPrice)}
                            {item.createdAt ? ` · ${formatRuDate(item.createdAt)}` : ''}
                            {item.companyName ? ` · ${item.companyName}` : ''}
                          </div>
                          {item.clientName ? <div className="text-[11px] text-slate-500">Клиент: {item.clientName}</div> : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-semibold text-amber-200">{formatMoney(item.totalAmount)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </OperatorPanel>

          {/* ── По точкам ─────────────────────────────────────────────────── */}
          {data.week.allocations.length > 0 ? (
            <OperatorPanel>
              <OperatorSectionHeading title="По точкам" description="Как недельная сумма раскладывается по компаниям, где вы работали." />
              <div className="mt-4 space-y-3">
                {data.week.allocations.map((item) => (
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
                ))}
              </div>
            </OperatorPanel>
          ) : null}

          {/* ── Корректировки + Выплаты ──────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <OperatorPanel>
              <OperatorSectionHeading title="Штрафы, премии, авансы" description="Корректировки недели с причиной." />
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <OperatorPill tone="emerald">Премии: {formatMoney(adjustmentSummary.bonuses)}</OperatorPill>
                <OperatorPill tone="red">Штрафы: {formatMoney(adjustmentSummary.fines)}</OperatorPill>
                <OperatorPill tone="amber">Авансы: {formatMoney(adjustmentSummary.advances)}</OperatorPill>
              </div>
              <div className="mt-4 space-y-3">
                {data.week.adjustments.length === 0 ? (
                  <OperatorEmptyState title="Корректировок нет" description="На этой неделе не было штрафов, премий или авансов." />
                ) : null}
                {data.week.adjustments.map((item) => (
                  <div key={item.id} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${item.kind === 'fine' ? 'bg-rose-500/15 text-rose-300' : item.kind === 'advance' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                          {item.kind === 'fine' ? <Minus className="h-3.5 w-3.5" /> : item.kind === 'advance' ? <Wallet className="h-3.5 w-3.5" /> : <Award className="h-3.5 w-3.5" />}
                        </span>
                        <div>
                          <div className="text-sm font-medium text-white">{item.kind === 'bonus' ? 'Премия' : item.kind === 'advance' ? 'Аванс' : 'Штраф'}</div>
                          <div className="mt-0.5 text-xs text-slate-400">
                            {formatRuDate(item.date, 'full')}
                            {item.companyName ? ` · ${item.companyName}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className={`text-sm font-semibold ${item.kind === 'fine' || item.kind === 'advance' ? 'text-rose-300' : 'text-emerald-300'}`}>{formatMoney(item.amount)}</div>
                    </div>
                    {item.comment ? <div className="mt-2 text-xs text-slate-400">Причина: {item.comment}</div> : null}
                  </div>
                ))}
              </div>
            </OperatorPanel>

            <OperatorPanel>
              <OperatorSectionHeading title="Выплаты" description="Фактические выплаты по неделе с разбивкой по способу оплаты." />
              <div className="mt-4 space-y-3">
                {data.week.payments.length === 0 ? (
                  <OperatorEmptyState title="Выплат пока нет" description="Когда по этой неделе появятся выплаты, они будут здесь." />
                ) : (
                  data.week.payments.map((payment) => (
                    <div key={payment.id} className="rounded-[1.4rem] border border-emerald-500/15 bg-emerald-500/[0.06] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-white">{formatRuDate(payment.payment_date, 'full')}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            Нал: {formatMoney(payment.cash_amount)} · Kaspi: {formatMoney(payment.kaspi_amount)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-sm font-semibold text-emerald-300"><Coins className="h-3.5 w-3.5" />{formatMoney(payment.total_amount)}</div>
                      </div>
                      {payment.comment ? <div className="mt-2 text-xs text-slate-400">{payment.comment}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </OperatorPanel>
          </div>

          {/* ── История ───────────────────────────────────────────────────── */}
          <OperatorPanel>
            <OperatorSectionHeading title="История по неделям" description="Последние недели — нажмите, чтобы открыть расчёт." />
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
