'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Printer, X } from 'lucide-react'

type IncomeAgg = { cash: number; kaspi: number; online: number; card: number; total: number }
type ExpenseCat = { category: string; amount: number }
type CompanyBlock = {
  id: string
  name: string
  code: string | null
  income: IncomeAgg
  expenses: ExpenseCat[]
  expense_total: number
  net: number
}
type ActData = {
  from: string
  to: string
  companies: CompanyBlock[]
  totals: {
    income: IncomeAgg
    expenses: ExpenseCat[]
    expense_total: number
    net: number
  } | null
}

function fmt(n: number) {
  return Math.round(Number(n || 0)).toLocaleString('ru-RU')
}
function fmtHuman(isoStr: string) {
  return new Date(isoStr + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/**
 * Печатный недельный акт. Открывается из недельного отчёта.
 * Тянет агрегацию с /api/admin/weekly-act, показывает бело-чёрное превью
 * (стиль акта ревизии) и печатает только его — остальная страница скрыта.
 */
export function WeeklyActPrint({
  from,
  to,
  onClose,
}: {
  from: string
  to: string
  onClose: () => void
}) {
  const [data, setData] = useState<ActData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/weekly-act?from=${from}&to=${to}`, { cache: 'no-store' })
        const j = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(j?.error || 'Ошибка загрузки')
        setData(j.data as ActData)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [from, to])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      id="weekly-act-print-root"
      className="fixed inset-0 z-[300] grid place-items-start justify-center overflow-auto bg-black/70 p-4 print:static print:block print:bg-white print:p-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-[800px] rounded-2xl bg-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none">
        {/* Тулбар — не печатается */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 print:hidden">
          <h3 className="text-sm font-semibold text-slate-900">Недельный акт</h3>
          <div className="flex gap-1">
            <button
              onClick={() => window.print()}
              disabled={loading || !!error}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" /> Печать
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Тело акта */}
        <div className="p-6 text-black print:p-8">
          {loading ? (
            <div className="py-10 text-center text-slate-500">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="py-6 text-center text-rose-600">{error}</div>
          ) : !data ? null : (
            <ActBody data={data} />
          )}
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body > *:not(#weekly-act-print-root) {
            display: none !important;
          }
          #weekly-act-print-root {
            position: static !important;
            overflow: visible !important;
          }
          @page {
            size: A4;
            margin: 12mm;
          }
        }
      `}</style>
    </div>,
    document.body,
  )
}

function ActBody({ data }: { data: ActData }) {
  const t = data.totals
  const year = new Date(data.to + 'T00:00:00').getFullYear()
  return (
    <div>
      <div className="mb-5 border-b-2 border-black pb-3 text-center">
        <div className="text-xl font-bold tracking-wide">АКТ ЗА НЕДЕЛЮ</div>
        <div className="mt-1 text-sm">
          {fmtHuman(data.from)} — {fmtHuman(data.to)} {year}
        </div>
      </div>

      {data.companies.length === 0 ? (
        <div className="py-6 text-center text-slate-500">Нет данных за неделю</div>
      ) : (
        <div className="space-y-5">
          {data.companies.map((c) => (
            <div key={c.id} className="border border-slate-300 p-4" style={{ pageBreakInside: 'avoid' }}>
              <div className="mb-3 flex items-baseline justify-between border-b border-slate-300 pb-2">
                <span className="text-base font-bold">{c.name}</span>
                {c.code && <span className="text-xs text-slate-600">{c.code}</span>}
              </div>
              <ActRows
                income={c.income}
                expenses={c.expenses}
                expenseTotal={c.expense_total}
                net={c.net}
              />
            </div>
          ))}

          {t && data.companies.length > 1 && (
            <div className="border-2 border-black p-4" style={{ pageBreakInside: 'avoid' }}>
              <div className="mb-2 text-sm font-bold uppercase tracking-wider">Итого по всем точкам</div>
              <ActRows income={t.income} expenses={t.expenses} expenseTotal={t.expense_total} net={t.net} />
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-between text-[11px] text-slate-600">
        <span>Сформировано: {new Date().toLocaleString('ru-RU')}</span>
        <span>Orda Control</span>
      </div>
    </div>
  )
}

function ActRows({
  income,
  expenses,
  expenseTotal,
  net,
}: {
  income: IncomeAgg
  expenses: ExpenseCat[]
  expenseTotal: number
  net: number
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2 print:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider">Доход</div>
        <Line label="Наличные" value={income.cash} />
        <Line label="Безналичные" value={income.kaspi + income.online + income.card} />
        <div className="my-1 border-t border-slate-400" />
        <Line label="Всего доход" value={income.total} strong />
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider">Расход по категориям</div>
        {expenses.length === 0 ? (
          <div className="text-xs text-slate-500">Расходов нет</div>
        ) : (
          expenses.map((e) => <Line key={e.category} label={e.category} value={e.amount} />)
        )}
        <div className="my-1 border-t border-slate-400" />
        <Line label="Всего расход" value={expenseTotal} strong />
      </div>

      <div className="md:col-span-2 print:col-span-2 mt-1 border-t-2 border-black pt-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">Чистыми (доход − расход)</span>
          <span className="font-mono text-lg font-bold tabular-nums">
            {net >= 0 ? '' : '−'}
            {fmt(Math.abs(net))} ₸
          </span>
        </div>
      </div>
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className={strong ? 'font-semibold' : ''}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? 'font-semibold' : ''}`}>{fmt(value)} ₸</span>
    </div>
  )
}
