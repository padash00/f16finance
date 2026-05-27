'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Printer } from 'lucide-react'

type Partner = { name: string; percent: number }

type ExpenseLine = {
  category: string
  amount: number
  cashAmount: number
  kaspiAmount: number
  count: number
  comments: string[]
  accountingGroup: string
}

type BranchReport = {
  company: { id: string; name: string; code: string | null }
  period: { from: string; to: string; fromDate: string; toDate: string }
  turnover: number
  turnoverTax: number
  turnoverTaxRate: number
  afterTax: number
  expenses: ExpenseLine[]
  expensesTotal: number
  netProfit: number
  payrollAccrued?: { staff: number; operators: number; total: number }
  capex: Array<{
    category: string
    amount: number
    comments: string[]
    count: number
    items?: Array<{ date: string; amount: number; comment: string }>
  }>
  capexTotal: number
}

const MONTH_NAMES_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

function fmtMoney(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value))
}

function fmtMonth(month: string): string {
  const [year, monthStr] = month.split('-')
  const monthNum = Number(monthStr)
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return month
  return `${MONTH_NAMES_RU[monthNum - 1]} ${year}`
}

function fmtPeriod(from: string, to: string): string {
  return from === to ? fmtMonth(from) : `${fmtMonth(from)} — ${fmtMonth(to)}`
}

export default function PrintClient() {
  const params = useSearchParams()
  const companyId = params.get('company_id') || ''
  const monthFrom = params.get('from') || ''
  const monthTo = params.get('to') || ''
  const partnersRaw = params.get('partners') || ''
  const includeCapex = params.get('capex') !== '0'
  // Ручной override ФОТ — если в URL пришёл ?payroll_staff или ?payroll_ops,
  // используем эти суммы вместо расчётных из API. Пустая строка = не задано.
  const overrideStaffRaw = params.get('payroll_staff')
  const overrideOpsRaw = params.get('payroll_ops')
  const note = (params.get('note') || '').trim()
  const overrideStaff = overrideStaffRaw != null && overrideStaffRaw !== ''
    ? Math.max(0, Math.round(Number(overrideStaffRaw)) || 0)
    : null
  const overrideOps = overrideOpsRaw != null && overrideOpsRaw !== ''
    ? Math.max(0, Math.round(Number(overrideOpsRaw)) || 0)
    : null

  const partners: Partner[] = useMemo(() => {
    if (!partnersRaw) return []
    try {
      const parsed = JSON.parse(decodeURIComponent(partnersRaw))
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((p: any) => ({
          name: String(p?.name || '').trim(),
          percent: Number(p?.percent || 0),
        }))
        .filter((p) => p.name && p.percent > 0)
    } catch {
      return []
    }
  }, [partnersRaw])

  const [report, setReport] = useState<BranchReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId || !monthFrom || !monthTo) {
      setError('Не указаны параметры отчёта')
      setLoading(false)
      return
    }
    const load = async () => {
      try {
        const res = await fetch(
          `/api/admin/profitability/branch-report?company_id=${encodeURIComponent(companyId)}&from=${encodeURIComponent(monthFrom)}&to=${encodeURIComponent(monthTo)}`,
          { cache: 'no-store' },
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        setReport(json.data)
      } catch (e: any) {
        setError(e?.message || 'Не удалось загрузить отчёт')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [companyId, monthFrom, monthTo])

  useEffect(() => {
    if (report && !loading && params.get('auto') === '1') {
      const timer = setTimeout(() => window.print(), 600)
      return () => clearTimeout(timer)
    }
  }, [report, loading, params])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-slate-900">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-slate-900">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <div className="font-semibold text-rose-700">Не удалось загрузить отчёт</div>
          <div className="mt-1 text-sm text-rose-600">{error || 'Неизвестная ошибка'}</div>
        </div>
      </div>
    )
  }

  // Управленческий учёт: payroll/payroll_advance из expenses заменяем
  // на синтетическую строку «Зарплата (начислено)» с суммой по начислениям,
  // а не по фактическим выплатам. payroll_tax остаётся как есть.
  // Если в URL передан ручной override — приоритет за ним.
  const apiPayroll = report.payrollAccrued || null
  const payrollAccrued = (overrideStaff !== null || overrideOps !== null)
    ? {
        staff: overrideStaff !== null ? overrideStaff : (apiPayroll?.staff ?? 0),
        operators: overrideOps !== null ? overrideOps : (apiPayroll?.operators ?? 0),
        total:
          (overrideStaff !== null ? overrideStaff : (apiPayroll?.staff ?? 0)) +
          (overrideOps !== null ? overrideOps : (apiPayroll?.operators ?? 0)),
      }
    : apiPayroll
  const isPayrollGroup = (group: string) => group === 'payroll' || group === 'payroll_advance'
  const nonPayrollExpenses = report.expenses.filter((e) => !isPayrollGroup(e.accountingGroup))
  const accruedLine: ExpenseLine | null = payrollAccrued && payrollAccrued.total > 0
    ? {
        category: 'Зарплата (начислено)',
        amount: payrollAccrued.total,
        accountingGroup: 'payroll',
        cashAmount: 0,
        kaspiAmount: 0,
        count: 0,
        comments: [],
      }
    : null
  const displayedExpenses: ExpenseLine[] = (accruedLine
    ? [accruedLine, ...nonPayrollExpenses]
    : nonPayrollExpenses
  ).sort((a, b) => b.amount - a.amount)
  const displayedExpensesTotal = Math.round(displayedExpenses.reduce((s, e) => s + e.amount, 0))
  const displayedNetProfit = Math.round(report.turnover - report.turnoverTax - displayedExpensesTotal)

  const partnersPayouts = partners.map((p) => ({
    ...p,
    amount: Math.round((displayedNetProfit * p.percent) / 100),
  }))
  const partnersTotal = partnersPayouts.reduce((sum, p) => sum + p.amount, 0)
  const ownerProfit = displayedNetProfit - partnersTotal
  const ownerPercent = 100 - partnersPayouts.reduce((s, p) => s + p.percent, 0)

  // Метрики качества бизнеса для KPI-полоски.
  const profitMargin = report.turnover > 0 ? (displayedNetProfit / report.turnover) * 100 : 0
  const expensesShare = report.turnover > 0 ? (displayedExpensesTotal / report.turnover) * 100 : 0
  const taxShare = report.turnoverTaxRate * 100

  // Разбивка оборота для горизонтального бара.
  const turnoverBreakdown = [
    {
      key: 'profit',
      label: 'Прибыль',
      amount: Math.max(0, displayedNetProfit),
      color: displayedNetProfit >= 0 ? '#f59e0b' : '#94a3b8',
      percent: report.turnover > 0 ? (Math.max(0, displayedNetProfit) / report.turnover) * 100 : 0,
    },
    {
      key: 'expenses',
      label: 'Расходы',
      amount: displayedExpensesTotal,
      color: '#475569',
      percent: report.turnover > 0 ? (displayedExpensesTotal / report.turnover) * 100 : 0,
    },
    {
      key: 'tax',
      label: 'Налог',
      amount: report.turnoverTax,
      color: '#fb7185',
      percent: report.turnover > 0 ? (report.turnoverTax / report.turnover) * 100 : 0,
    },
  ]

  // Цвета точек для группы расходов.
  const groupColor = (group: string): string => {
    if (group === 'payroll' || group === 'payroll_advance' || group === 'payroll_tax') return '#3b82f6'
    if (group === 'income_tax') return '#fb923c'
    if (group === 'pos_commission' || group === 'financial') return '#a855f7'
    if (group === 'cogs') return '#10b981'
    if (group === 'non_operating') return '#fb7185'
    return '#64748b' // operating и пр.
  }
  const groupLabel = (group: string): string => {
    if (group === 'payroll' || group === 'payroll_advance') return 'ФОТ'
    if (group === 'payroll_tax') return 'Зарпл. налоги'
    if (group === 'income_tax') return 'Налоги'
    if (group === 'pos_commission') return 'POS'
    if (group === 'cogs') return 'Себестоимость'
    if (group === 'financial') return 'Финансы'
    if (group === 'non_operating') return 'Прочее'
    return 'Операционные'
  }

  // Максимум для масштабирования мини-bar внутри строк расходов.
  const expensesMax = displayedExpenses.reduce((m, e) => Math.max(m, e.amount), 0)

  // Множество ID топ-3 расходов для подсветки золотой полосой слева.
  const topThreeIds = new Set(displayedExpenses.slice(0, 3).map((e) => e.category))

  // Разделяем расходы на две колонки для печати: чередуем чтобы суммы балансировались.
  const expensesLeft = displayedExpenses.filter((_, i) => i % 2 === 0)
  const expensesRight = displayedExpenses.filter((_, i) => i % 2 === 1)

  return (
    <>
      <style jsx global>{`
        :root { color-scheme: light; }
        @media screen {
          .print-shell {
            padding: 24px 16px;
            background: #f3f4f6;
            min-height: 100vh;
          }
        }
        /* Глобальные виджеты root layout (AI-ассистент, тосты, ошибки) — скрыть на всей print-странице, не только при печати. */
        [data-claude-assistant],
        [data-global-assistant],
        [data-toaster],
        [data-sonner-toaster],
        .sonner-toaster,
        [data-radix-toast-viewport] {
          display: none !important;
        }
        @media print {
          .no-print { display: none !important; }
          html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 10mm; size: A4 portrait; }
          .print-shell { padding: 0 !important; background: white !important; }
          .doc-paper { box-shadow: none !important; max-width: none !important; width: 100% !important; }
          /* Маленькие секции (топ-блок, KPI, ФОТ, формула, партнёры) — не резать на странице. */
          .doc-paper .keep { page-break-inside: avoid; break-inside: avoid; }
          /* Длинные секции (расходы, капвложения) — пусть текут естественно, но строки внутри не рвём. */
          .doc-paper .capex-item,
          .doc-paper .capex-category { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>

      <div className="print-shell">
        {/* Toolbar — только на экране */}
        <div className="no-print mx-auto mb-4 flex max-w-[820px] items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
          <div className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{report.company.name}</span>
            {' · '}
            {fmtPeriod(report.period.from, report.period.to)}
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            <Printer className="h-3.5 w-3.5" />
            Печать / Save as PDF
          </button>
        </div>

        {/* Документ A4 */}
        <div className="doc-paper mx-auto max-w-[820px] bg-white text-slate-900 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="px-8 py-6 print:px-6 print:py-4">

            {/* Шапка */}
            <header className="flex items-end justify-between border-b-2 border-amber-500 pb-3 mb-4 keep">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-amber-700">
                  Управленческий отчёт · Orda Control
                </div>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight leading-none">
                  {report.company.name}
                </h1>
              </div>
              <div className="text-right">
                <div className="text-[15px] font-semibold capitalize text-slate-700">
                  {fmtPeriod(report.period.from, report.period.to)}
                </div>
                <div className="text-[9px] text-slate-400">
                  Сформирован {new Date().toLocaleDateString('ru-RU')}
                </div>
              </div>
            </header>

            {/* Топ-строка: оборот + налог + чистая прибыль */}
            <section className="grid grid-cols-3 gap-3 mb-4 keep">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">Оборот</div>
                <div className="mt-0.5 text-xl font-extrabold tabular-nums leading-tight">
                  {fmtMoney(report.turnover)} <span className="text-sm font-semibold text-emerald-700">₸</span>
                </div>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-rose-700">
                  Налог {(report.turnoverTaxRate * 100).toFixed(0)}%
                </div>
                <div className="mt-0.5 text-xl font-extrabold tabular-nums leading-tight">
                  −{fmtMoney(report.turnoverTax)} <span className="text-sm font-semibold text-rose-700">₸</span>
                </div>
              </div>
              <div className={
                'rounded-xl px-4 py-3 border-2 ' +
                (displayedNetProfit >= 0 ? 'border-amber-500 bg-amber-50' : 'border-rose-500 bg-rose-50')
              }>
                <div className={'text-[9px] font-bold uppercase tracking-wider ' + (displayedNetProfit >= 0 ? 'text-amber-800' : 'text-rose-700')}>
                  Чистая прибыль
                </div>
                <div className={'mt-0.5 text-xl font-extrabold tabular-nums leading-tight ' + (displayedNetProfit >= 0 ? 'text-amber-900' : 'text-rose-700')}>
                  {fmtMoney(displayedNetProfit)} <span className="text-sm font-semibold">₸</span>
                </div>
              </div>
            </section>

            {/* KPI-полоска */}
            <section className="grid grid-cols-3 gap-3 mb-3 keep">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <div className="text-[8.5px] font-semibold uppercase tracking-wider text-slate-500">Рентабельность</div>
                <div className={'text-[15px] font-bold tabular-nums leading-tight ' + (profitMargin >= 0 ? 'text-amber-700' : 'text-rose-700')}>
                  {profitMargin.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <div className="text-[8.5px] font-semibold uppercase tracking-wider text-slate-500">Доля расходов</div>
                <div className="text-[15px] font-bold tabular-nums leading-tight text-slate-700">
                  {expensesShare.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <div className="text-[8.5px] font-semibold uppercase tracking-wider text-slate-500">Налоговая нагрузка</div>
                <div className="text-[15px] font-bold tabular-nums leading-tight text-rose-700">
                  {taxShare.toFixed(1)}%
                </div>
              </div>
            </section>

            {/* Детализация ФОТ — по факту начисления, не по выплатам */}
            {payrollAccrued && payrollAccrued.total > 0 ? (
              <section className="mb-4 rounded-xl border border-blue-200 bg-blue-50/40 px-3 py-2 keep">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-700">
                    Фонд оплаты труда (начислено)
                  </h2>
                  <span className="text-[9px] text-slate-500">
                    по факту начисления за период
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-blue-200 bg-white px-3 py-1.5">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-blue-700">
                      Адм. сотрудники
                    </div>
                    <div className="mt-0.5 text-[15px] font-bold tabular-nums text-slate-900">
                      {fmtMoney(payrollAccrued.staff)} <span className="text-[10px] text-slate-500">₸</span>
                    </div>
                    <div className="text-[8.5px] text-slate-400">оклады с учётом дат изменений</div>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-white px-3 py-1.5">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-blue-700">
                      Операторы по сменам
                    </div>
                    <div className="mt-0.5 text-[15px] font-bold tabular-nums text-slate-900">
                      {fmtMoney(payrollAccrued.operators)} <span className="text-[10px] text-slate-500">₸</span>
                    </div>
                    <div className="text-[8.5px] text-slate-400">смены × ставки + премии − штрафы</div>
                  </div>
                  <div className="rounded-lg border-2 border-blue-400 bg-blue-100 px-3 py-1.5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-blue-800">
                      Итого ФОТ
                    </div>
                    <div className="mt-0.5 text-[15px] font-extrabold tabular-nums text-blue-900">
                      {fmtMoney(payrollAccrued.total)} <span className="text-[10px] font-semibold">₸</span>
                    </div>
                    <div className="text-[8.5px] text-blue-700">включено в расходы ниже</div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Разбивка оборота — горизонтальный bar */}
            <section className="mb-4 keep">
              <div className="mb-1 flex items-baseline justify-between text-[9px] uppercase tracking-wider text-slate-500">
                <span className="font-semibold">Куда ушёл оборот</span>
                <span>100% = {fmtMoney(report.turnover)} ₸</span>
              </div>
              <div className="flex h-5 overflow-hidden rounded-md ring-1 ring-slate-200">
                {turnoverBreakdown
                  .filter((b) => b.percent > 0)
                  .map((b) => (
                    <div
                      key={b.key}
                      style={{ width: `${b.percent}%`, background: b.color }}
                      className="flex items-center justify-center text-[9px] font-bold text-white"
                      title={`${b.label}: ${fmtMoney(b.amount)} ₸ (${b.percent.toFixed(1)}%)`}
                    >
                      {b.percent >= 8 ? `${b.percent.toFixed(1)}%` : ''}
                    </div>
                  ))}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]">
                {turnoverBreakdown.map((b) => (
                  <div key={b.key} className="flex items-baseline gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: b.color }} />
                    <span className="text-slate-600">{b.label}</span>
                    <span className="tabular-nums font-semibold text-slate-900">{fmtMoney(b.amount)} ₸</span>
                    <span className="tabular-nums text-slate-400">({b.percent.toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Расходы — две колонки */}
            <section className="mb-4 keep">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-700">
                  Расходы за период
                </h2>
                <div className="text-[10px] text-slate-500">
                  {displayedExpenses.length} {displayedExpenses.length === 1 ? 'категория' : 'категорий'}
                </div>
              </div>
              {displayedExpenses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-500">
                  Расходов за период не зафиксировано
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-0.5">
                    {[expensesLeft, expensesRight].map((col, colIdx) => (
                      <div key={colIdx} className="space-y-0.5">
                        {col.map((line) => {
                          const sharePercent = displayedExpensesTotal > 0 ? (line.amount / displayedExpensesTotal) * 100 : 0
                          const barWidth = expensesMax > 0 ? (line.amount / expensesMax) * 100 : 0
                          const isTopThree = topThreeIds.has(line.category)
                          const dotColor = groupColor(line.accountingGroup)
                          return (
                            <div
                              key={line.category}
                              className="border-b border-slate-100 py-0.5 text-[11px]"
                              style={isTopThree ? { borderLeft: '3px solid #f59e0b', paddingLeft: '6px' } : { paddingLeft: '0' }}
                            >
                              <div className="flex items-baseline justify-between">
                                <div className="flex items-center gap-1.5 truncate pr-2">
                                  <span
                                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ background: dotColor }}
                                    title={groupLabel(line.accountingGroup)}
                                  />
                                  <span className="font-medium text-slate-900 truncate">{line.category}</span>
                                </div>
                                <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                                  <span className="text-[9px] tabular-nums text-slate-400">{sharePercent.toFixed(1)}%</span>
                                  <span className="tabular-nums font-semibold text-slate-800">{fmtMoney(line.amount)}</span>
                                </div>
                              </div>
                              <div className="mt-0.5 h-[2px] w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${barWidth}%`, background: dotColor }}
                                />
                              </div>
                              {line.comments.length > 0 && line.comments[0] ? (
                                <div className="text-[9px] text-slate-400 truncate">{line.comments[0].slice(0, 70)}</div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                  {/* Легенда групп */}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[8.5px] text-slate-500">
                    {Array.from(new Set(displayedExpenses.map((e) => e.accountingGroup))).map((g) => (
                      <span key={g} className="inline-flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: groupColor(g) }} />
                        {groupLabel(g)}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-900 px-3 py-1.5 text-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider">Итого расходов</div>
                    <div className="text-base font-extrabold tabular-nums">
                      {fmtMoney(displayedExpensesTotal)} ₸
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* Формула расчёта */}
            <section className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-[10px] text-slate-600 keep">
              <span className="font-semibold tabular-nums">{fmtMoney(report.turnover)}</span>
              <span className="mx-1.5 text-slate-400">−</span>
              <span className="tabular-nums">{fmtMoney(report.turnoverTax)}</span>
              <span className="text-slate-400"> (налог)</span>
              <span className="mx-1.5 text-slate-400">−</span>
              <span className="tabular-nums">{fmtMoney(displayedExpensesTotal)}</span>
              <span className="text-slate-400"> (расходы)</span>
              <span className="mx-1.5 text-slate-400">=</span>
              <span className="font-bold tabular-nums text-slate-900">{fmtMoney(displayedNetProfit)} ₸</span>
            </section>

            {/* Распределение прибыли */}
            {partnersPayouts.length > 0 ? (
              <section className="mb-4 keep">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-700">
                  Распределение чистой прибыли
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {partnersPayouts.map((p) => (
                    <div key={p.name + p.percent} className="flex items-baseline justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11.5px]">
                      <div>
                        <span className="font-medium text-slate-900">{p.name}</span>
                        <span className="ml-1.5 text-[10px] text-slate-500">{p.percent}%</span>
                      </div>
                      <div className="tabular-nums font-bold text-slate-900">{fmtMoney(p.amount)} ₸</div>
                    </div>
                  ))}
                  {/* Остаток в бизнесе/владельцу — не показываем инвестору. */}
                </div>
              </section>
            ) : null}

            {/* Капитальные вложения — с детализацией каждой покупки. Длинный раздел, режется на страницы по строкам */}
            {includeCapex && report.capex.length > 0 ? (
              <section className="mb-3">
                <div className="mb-2 flex items-baseline justify-between capex-item">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-700">
                    Капитальные вложения
                  </h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-slate-500">
                    Справочно, вне P&L
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200">
                  {report.capex.map((line, idx) => {
                    const items = line.items || []
                    return (
                      <div key={line.category} className={idx > 0 ? 'border-t border-slate-200' : ''}>
                        <div className="capex-category flex items-baseline justify-between bg-slate-50 px-3 py-1.5 text-[11.5px]">
                          <div>
                            <span className="font-semibold text-slate-900">{line.category}</span>
                            <span className="ml-2 text-[9.5px] text-slate-500">
                              {line.count} {line.count === 1 ? 'позиция' : 'позиций'}
                            </span>
                          </div>
                          <div className="tabular-nums font-bold text-slate-900">{fmtMoney(line.amount)} ₸</div>
                        </div>
                        {items.length > 0 ? (
                          <div className="divide-y divide-slate-100">
                            {items.map((it, i) => (
                              <div key={i} className="capex-item flex items-start gap-2 px-3 py-1 text-[10.5px]">
                                <span className="w-[58px] shrink-0 font-mono text-[9px] text-slate-400">
                                  {it.date ? it.date.slice(5) : '—'}
                                </span>
                                <span className="flex-1 text-slate-700 break-words">
                                  {it.comment || <span className="text-slate-400">без комментария</span>}
                                </span>
                                <span className="tabular-nums whitespace-nowrap text-slate-800">
                                  {fmtMoney(it.amount)} ₸
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                  <div className="capex-item flex items-baseline justify-between border-t border-slate-200 bg-slate-100 px-3 py-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700">Итого вложений</div>
                    <div className="tabular-nums font-extrabold text-slate-900 text-[13px]">{fmtMoney(report.capexTotal)} ₸</div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Пояснение к отчёту — комментарий владельца (например, о ремонте зоны) */}
            {note ? (
              <section className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 keep">
                <h2 className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800">
                  Пояснение к отчёту
                </h2>
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-800">
                  {note}
                </p>
              </section>
            ) : null}

            {/* Подпись */}
            <footer className="border-t border-slate-100 pt-2 text-center text-[8.5px] text-slate-400">
              Orda Control · {new Date().toLocaleString('ru-RU')}
            </footer>
          </div>
        </div>
      </div>
    </>
  )
}
