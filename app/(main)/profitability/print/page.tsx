'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Printer, TrendingUp, Banknote, Wallet, PiggyBank, Building2, Calendar } from 'lucide-react'

type Partner = { name: string; percent: number }

type BranchReport = {
  company: { id: string; name: string; code: string | null }
  period: { from: string; to: string; fromDate: string; toDate: string }
  turnover: number
  turnoverTax: number
  turnoverTaxRate: number
  afterTax: number
  expenses: Array<{
    category: string
    amount: number
    cashAmount: number
    kaspiAmount: number
    count: number
    comments: string[]
    accountingGroup: string
  }>
  expensesTotal: number
  netProfit: number
  capex: Array<{ category: string; amount: number; comments: string[]; count: number }>
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

export default function ProfitabilityPrintPage() {
  const params = useSearchParams()
  const companyId = params.get('company_id') || ''
  const monthFrom = params.get('from') || ''
  const monthTo = params.get('to') || ''
  const partnersRaw = params.get('partners') || ''
  const includeCapex = params.get('capex') !== '0'

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

  // Автоматический вызов диалога печати когда данные загружены.
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
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
          <div className="text-lg font-semibold text-rose-700">Не удалось загрузить отчёт</div>
          <div className="mt-2 text-sm text-rose-600">{error || 'Неизвестная ошибка'}</div>
        </div>
      </div>
    )
  }

  const partnersPayouts = partners.map((p) => ({
    ...p,
    amount: Math.round((report.netProfit * p.percent) / 100),
  }))
  const partnersTotal = partnersPayouts.reduce((sum, p) => sum + p.amount, 0)
  const ownerProfit = report.netProfit - partnersTotal

  return (
    <>
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { margin: 14mm; size: A4; }
        }
        @media screen {
          .print-shell { padding: 32px 24px; background: #f3f4f6; min-height: 100vh; }
        }
      `}</style>

      <div className="print-shell">
        {/* Toolbar — только на экране */}
        <div className="no-print mx-auto mb-6 flex max-w-[820px] items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="text-sm text-slate-600">
            Отчёт по точке <span className="font-semibold text-slate-900">{report.company.name}</span>
            {' · '}
            <span>{fmtPeriod(report.period.from, report.period.to)}</span>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            <Printer className="h-4 w-4" />
            Печать / Save as PDF
          </button>
        </div>

        {/* Документ */}
        <div className="mx-auto max-w-[820px] bg-white text-slate-900 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          {/* Шапка */}
          <header className="border-b-2 border-amber-500 px-10 pb-6 pt-10">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
                  Управленческий отчёт о прибыли
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Building2 className="h-6 w-6 text-slate-400" />
                  <h1 className="text-3xl font-bold tracking-tight">{report.company.name}</h1>
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                  <Calendar className="h-4 w-4" />
                  {fmtPeriod(report.period.from, report.period.to)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Orda Control</div>
                <div className="mt-1 text-[10px] text-slate-400">
                  Сформирован: {new Date().toLocaleDateString('ru-RU')}
                </div>
              </div>
            </div>
          </header>

          <main className="px-10 py-8 space-y-8">
            {/* Оборот */}
            <section>
              <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-6">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  <TrendingUp className="h-4 w-4" />
                  Общий оборот за период
                </div>
                <div className="mt-2 text-4xl font-bold tabular-nums">{fmtMoney(report.turnover)} ₸</div>
              </div>
            </section>

            {/* Налог с оборота */}
            <section>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Налог с оборота ({(report.turnoverTaxRate * 100).toFixed(0)}%)
                    </div>
                    <div className="mt-1 text-sm text-slate-500">Автоматически вычитается из оборота</div>
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-rose-700">− {fmtMoney(report.turnoverTax)} ₸</div>
                </div>
                <div className="mt-3 border-t border-slate-200 pt-3 flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-700">После налога</div>
                  <div className="text-xl font-semibold tabular-nums">{fmtMoney(report.afterTax)} ₸</div>
                </div>
              </div>
            </section>

            {/* Расходы */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Wallet className="h-5 w-5 text-slate-500" />
                <h2 className="text-lg font-bold">Расходы за период</h2>
                <span className="ml-auto text-sm text-slate-500">{report.expenses.length} категорий</span>
              </div>
              {report.expenses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Расходов за период не зафиксировано
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Категория</th>
                        <th className="px-4 py-3 text-right font-semibold">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.expenses.map((line) => (
                        <tr key={line.category} className="align-top">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{line.category}</div>
                            {line.comments.length > 0 ? (
                              <div className="mt-1 text-xs text-slate-500">
                                {line.comments.slice(0, 2).join(' · ')}
                              </div>
                            ) : null}
                            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                              {line.count} {line.count === 1 ? 'операция' : 'операций'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">
                            {fmtMoney(line.amount)} ₸
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-900 text-white">
                      <tr>
                        <td className="px-4 py-3 text-sm font-semibold">Итого расходов</td>
                        <td className="px-4 py-3 text-right text-base font-bold tabular-nums">
                          {fmtMoney(report.expensesTotal)} ₸
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>

            {/* Чистая прибыль */}
            <section>
              <div className={
                'rounded-2xl border-2 p-6 ' +
                (report.netProfit >= 0
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-rose-500 bg-rose-50')
              }>
                <div className={'flex items-center gap-2 text-xs font-bold uppercase tracking-widest ' + (report.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  <Banknote className="h-4 w-4" />
                  Чистая прибыль
                </div>
                <div className={'mt-2 text-5xl font-extrabold tabular-nums ' + (report.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {fmtMoney(report.netProfit)} ₸
                </div>
                <div className="mt-3 text-xs text-slate-600">
                  = {fmtMoney(report.turnover)} − {fmtMoney(report.turnoverTax)} (налог) − {fmtMoney(report.expensesTotal)} (расходы)
                </div>
              </div>
            </section>

            {/* Доли учредителей */}
            {partnersPayouts.length > 0 ? (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <PiggyBank className="h-5 w-5 text-slate-500" />
                  <h2 className="text-lg font-bold">Распределение чистой прибыли</h2>
                </div>
                <div className="space-y-2">
                  {partnersPayouts.map((p) => (
                    <div key={p.name + p.percent} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3">
                      <div>
                        <div className="font-medium text-slate-900">{p.name}</div>
                        <div className="text-xs text-slate-500">{p.percent}% от чистой прибыли</div>
                      </div>
                      <div className="tabular-nums text-lg font-semibold text-slate-900">{fmtMoney(p.amount)} ₸</div>
                    </div>
                  ))}
                  {ownerProfit > 0 ? (
                    <div className="flex items-center justify-between rounded-xl border-2 border-amber-400 bg-amber-50 px-5 py-3">
                      <div>
                        <div className="font-semibold text-amber-900">Остаётся владельцу</div>
                        <div className="text-xs text-amber-700">{(100 - partnersPayouts.reduce((s, p) => s + p.percent, 0)).toFixed(0)}% от чистой прибыли</div>
                      </div>
                      <div className="tabular-nums text-xl font-bold text-amber-900">{fmtMoney(ownerProfit)} ₸</div>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* Капитальные вложения */}
            {includeCapex && report.capex.length > 0 ? (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-slate-500" />
                  <h2 className="text-lg font-bold">Капитальные вложения</h2>
                  <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                    Справочно, вне P&L
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {report.capex.map((line) => (
                        <tr key={line.category}>
                          <td className="px-4 py-3">
                            <div className="font-medium">{line.category}</div>
                            {line.comments.length > 0 ? (
                              <div className="mt-1 text-xs text-slate-500">{line.comments.slice(0, 2).join(' · ')}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold">
                            {fmtMoney(line.amount)} ₸
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-100">
                      <tr>
                        <td className="px-4 py-3 text-sm font-semibold">Итого вложений</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums">{fmtMoney(report.capexTotal)} ₸</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            ) : null}

            {/* Подпись */}
            <footer className="pt-6 border-t border-slate-200 text-[10px] text-slate-400 text-center">
              Сформировано системой Orda Control · {new Date().toLocaleString('ru-RU')}
            </footer>
          </main>
        </div>
      </div>
    </>
  )
}
