'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Printer } from 'lucide-react'

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

export default function PrintClient() {
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

  const partnersPayouts = partners.map((p) => ({
    ...p,
    amount: Math.round((report.netProfit * p.percent) / 100),
  }))
  const partnersTotal = partnersPayouts.reduce((sum, p) => sum + p.amount, 0)
  const ownerProfit = report.netProfit - partnersTotal
  const ownerPercent = 100 - partnersPayouts.reduce((s, p) => s + p.percent, 0)

  // Разделяем расходы на две колонки для печати: чередуем чтобы суммы балансировались.
  const expensesLeft = report.expenses.filter((_, i) => i % 2 === 0)
  const expensesRight = report.expenses.filter((_, i) => i % 2 === 1)

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
        @media print {
          .no-print { display: none !important; }
          html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 10mm; size: A4 portrait; }
          .print-shell { padding: 0 !important; background: white !important; }
          .doc-paper { box-shadow: none !important; max-width: none !important; width: 100% !important; }
          .doc-paper section, .doc-paper .keep { page-break-inside: avoid; break-inside: avoid; }
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
                (report.netProfit >= 0 ? 'border-amber-500 bg-amber-50' : 'border-rose-500 bg-rose-50')
              }>
                <div className={'text-[9px] font-bold uppercase tracking-wider ' + (report.netProfit >= 0 ? 'text-amber-800' : 'text-rose-700')}>
                  Чистая прибыль
                </div>
                <div className={'mt-0.5 text-xl font-extrabold tabular-nums leading-tight ' + (report.netProfit >= 0 ? 'text-amber-900' : 'text-rose-700')}>
                  {fmtMoney(report.netProfit)} <span className="text-sm font-semibold">₸</span>
                </div>
              </div>
            </section>

            {/* Расходы — две колонки */}
            <section className="mb-4 keep">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-700">
                  Расходы за период
                </h2>
                <div className="text-[10px] text-slate-500">
                  {report.expenses.length} {report.expenses.length === 1 ? 'категория' : 'категорий'}
                </div>
              </div>
              {report.expenses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-500">
                  Расходов за период не зафиксировано
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                    {[expensesLeft, expensesRight].map((col, colIdx) => (
                      <div key={colIdx} className="space-y-0.5">
                        {col.map((line) => (
                          <div key={line.category} className="flex items-baseline justify-between border-b border-slate-100 py-1 text-[11.5px]">
                            <div className="truncate pr-2">
                              <span className="font-medium text-slate-900">{line.category}</span>
                              {line.comments.length > 0 && line.comments[0] ? (
                                <span className="ml-1 text-[9.5px] text-slate-400">· {line.comments[0].slice(0, 50)}</span>
                              ) : null}
                            </div>
                            <div className="tabular-nums font-semibold text-slate-800 whitespace-nowrap">
                              {fmtMoney(line.amount)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-900 px-3 py-1.5 text-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider">Итого расходов</div>
                    <div className="text-base font-extrabold tabular-nums">
                      {fmtMoney(report.expensesTotal)} ₸
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
              <span className="tabular-nums">{fmtMoney(report.expensesTotal)}</span>
              <span className="text-slate-400"> (расходы)</span>
              <span className="mx-1.5 text-slate-400">=</span>
              <span className="font-bold tabular-nums text-slate-900">{fmtMoney(report.netProfit)} ₸</span>
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
                  {ownerProfit !== 0 && ownerPercent > 0 ? (
                    <div className="flex items-baseline justify-between rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-1.5 text-[11.5px]">
                      <div>
                        <span className="font-bold text-amber-900">Владельцу</span>
                        <span className="ml-1.5 text-[10px] text-amber-700">{ownerPercent.toFixed(0)}%</span>
                      </div>
                      <div className="tabular-nums font-extrabold text-amber-900">{fmtMoney(ownerProfit)} ₸</div>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* Капитальные вложения */}
            {includeCapex && report.capex.length > 0 ? (
              <section className="mb-3 keep">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-700">
                    Капитальные вложения
                  </h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-slate-500">
                    Справочно, вне P&L
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200">
                  {report.capex.map((line, idx) => (
                    <div key={line.category} className={'flex items-baseline justify-between px-3 py-1.5 text-[11.5px] ' + (idx > 0 ? 'border-t border-slate-100' : '')}>
                      <div>
                        <span className="font-medium text-slate-900">{line.category}</span>
                        {line.comments.length > 0 && line.comments[0] ? (
                          <span className="ml-1.5 text-[9.5px] text-slate-400">· {line.comments[0].slice(0, 50)}</span>
                        ) : null}
                      </div>
                      <div className="tabular-nums font-semibold text-slate-800">{fmtMoney(line.amount)} ₸</div>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between border-t border-slate-200 bg-slate-50 px-3 py-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700">Итого вложений</div>
                    <div className="tabular-nums font-extrabold text-slate-900 text-[13px]">{fmtMoney(report.capexTotal)} ₸</div>
                  </div>
                </div>
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
