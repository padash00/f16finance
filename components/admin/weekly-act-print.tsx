'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Printer, X } from 'lucide-react'

type IncomeAgg = { cash: number; kaspi: number; online: number; card: number; total: number }
type ExpenseCat = { category: string; amount: number }
type DailyRow = { date: string; income: number; expense: number; net: number }
type ExpenseRow = { date: string; category: string; payee: string; amount: number }
type CompanyBlock = {
  id: string
  name: string
  code: string | null
  income: IncomeAgg
  expenses: ExpenseCat[]
  expense_total: number
  net: number
  daily: DailyRow[]
  expense_rows: ExpenseRow[]
}
type ActData = {
  from: string
  to: string
  days: string[]
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
function dayShort(isoStr: string) {
  const d = new Date(isoStr + 'T00:00:00')
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' })
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${wd}`
}

/**
 * Детальный недельный акт для печати. Тянет /api/admin/weekly-act,
 * показывает бело-чёрное превью (по каждой точке: разбивка по дням +
 * построчные расходы) и печатает только его (остальная страница скрыта).
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
      <div className="w-full max-w-[860px] rounded-2xl bg-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 print:hidden">
          <h3 className="text-sm font-semibold text-slate-900">Недельный акт</h3>
          <div className="flex gap-1">
            <button
              onClick={() => window.print()}
              disabled={loading || !!error}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" /> Печать
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-6 text-black print:p-6">
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
            margin: 10mm;
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
    <div className="text-[12px] leading-tight">
      <div className="mb-4 border-b-2 border-black pb-2 text-center">
        <div className="text-lg font-bold tracking-wide">АКТ ЗА НЕДЕЛЮ</div>
        <div className="mt-0.5 text-xs">
          {fmtHuman(data.from)} — {fmtHuman(data.to)} {year}
        </div>
      </div>

      {data.companies.length === 0 ? (
        <div className="py-6 text-center text-slate-500">Нет данных за неделю</div>
      ) : (
        <div className="space-y-5">
          {data.companies.map((c) => (
            <CompanyAct key={c.id} block={c} />
          ))}

          {t && data.companies.length > 1 && (
            <div className="border-2 border-black p-3" style={{ pageBreakInside: 'avoid' }}>
              <div className="mb-2 text-sm font-bold uppercase">Итого по всем точкам</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Big label="Доход" value={t.income.total} />
                <Big label="Расход" value={t.expense_total} />
                <Big label="Чистыми" value={t.net} accent />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-between text-[10px] text-slate-600">
        <span>Сформировано: {new Date().toLocaleString('ru-RU')}</span>
        <span>Orda Control</span>
      </div>
    </div>
  )
}

function CompanyAct({ block }: { block: CompanyBlock }) {
  return (
    <div className="border border-black" style={{ pageBreakInside: 'avoid' }}>
      {/* Заголовок точки + сводка */}
      <div className="flex items-baseline justify-between border-b border-black bg-slate-100 px-3 py-1.5 print:bg-slate-100">
        <span className="text-sm font-bold">{block.name}</span>
        <span className="text-xs">
          Доход <b>{fmt(block.income.total)}</b> · Расход <b>{fmt(block.expense_total)}</b> · Чистыми{' '}
          <b>{block.net >= 0 ? '' : '−'}{fmt(Math.abs(block.net))}</b> ₸
        </span>
      </div>

      <div className="grid md:grid-cols-2 print:grid-cols-2">
        {/* По дням */}
        <div className="border-b border-black p-2 md:border-b-0 md:border-r print:border-b-0 print:border-r">
          <div className="mb-1 text-[11px] font-semibold uppercase">По дням</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-slate-400 text-left">
                <th className="py-0.5 font-medium">День</th>
                <th className="py-0.5 text-right font-medium">Доход</th>
                <th className="py-0.5 text-right font-medium">Расход</th>
                <th className="py-0.5 text-right font-medium">Чистыми</th>
              </tr>
            </thead>
            <tbody>
              {block.daily.map((d) => (
                <tr key={d.date} className="border-b border-slate-200">
                  <td className="py-0.5 whitespace-nowrap">{dayShort(d.date)}</td>
                  <td className="py-0.5 text-right font-mono tabular-nums">{d.income ? fmt(d.income) : '—'}</td>
                  <td className="py-0.5 text-right font-mono tabular-nums">{d.expense ? fmt(d.expense) : '—'}</td>
                  <td className="py-0.5 text-right font-mono tabular-nums">
                    {d.net ? `${d.net < 0 ? '−' : ''}${fmt(Math.abs(d.net))}` : '—'}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-black font-bold">
                <td className="py-0.5">Итого</td>
                <td className="py-0.5 text-right font-mono tabular-nums">{fmt(block.income.total)}</td>
                <td className="py-0.5 text-right font-mono tabular-nums">{fmt(block.expense_total)}</td>
                <td className="py-0.5 text-right font-mono tabular-nums">
                  {block.net < 0 ? '−' : ''}{fmt(Math.abs(block.net))}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Доход: нал/безнал */}
          <div className="mt-2 flex justify-between text-[10px] text-slate-600">
            <span>Наличные: {fmt(block.income.cash)} ₸</span>
            <span>Безнал: {fmt(block.income.kaspi + block.income.online + block.income.card)} ₸</span>
          </div>
        </div>

        {/* Расходы построчно */}
        <div className="p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase">Расходы ({block.expense_rows.length})</div>
          {block.expense_rows.length === 0 ? (
            <div className="text-[11px] text-slate-500">Расходов нет</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-400 text-left">
                  <th className="py-0.5 font-medium">Дата</th>
                  <th className="py-0.5 font-medium">Категория</th>
                  <th className="py-0.5 font-medium">Кому / за что</th>
                  <th className="py-0.5 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {block.expense_rows.map((e, i) => (
                  <tr key={i} className="border-b border-slate-200 align-top">
                    <td className="py-0.5 whitespace-nowrap">{e.date.slice(8, 10)}.{e.date.slice(5, 7)}</td>
                    <td className="py-0.5">{e.category}</td>
                    <td className="py-0.5">{e.payee}</td>
                    <td className="py-0.5 text-right font-mono tabular-nums">{fmt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function Big({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={accent ? 'rounded border border-black py-1' : 'py-1'}>
      <div className="text-[10px] uppercase text-slate-600">{label}</div>
      <div className="font-mono text-base font-bold tabular-nums">
        {value < 0 ? '−' : ''}
        {fmt(Math.abs(value))} ₸
      </div>
    </div>
  )
}
