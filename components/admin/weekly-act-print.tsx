'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Loader2, Printer, X } from 'lucide-react'

import { nextWeekMondayISO } from '@/components/admin/weekly-purchase-plan'

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
  expense_cash: number
  expense_kaspi: number
  net: number
  remain_cash: number
  remain_kaspi: number
  daily: DailyRow[]
  expense_rows: ExpenseRow[]
}
export type ActData = {
  from: string
  to: string
  days: string[]
  companies: CompanyBlock[]
  totals: {
    income: IncomeAgg
    expenses: ExpenseCat[]
    expense_total: number
    expense_cash: number
    expense_kaspi: number
    net: number
    remain_cash: number
    remain_kaspi: number
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
  const [downloading, setDownloading] = useState(false)

  const downloadPdf = async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/admin/weekly-act/pdf?from=${from}&to=${to}&plan_week=${nextWeekMondayISO(to)}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || `Ошибка ${res.status}`)
      }
      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = `Akt_${from}_${to}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objUrl)
    } catch (e: any) {
      alert(e?.message || 'Не удалось скачать PDF')
    } finally {
      setDownloading(false)
    }
  }

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
      <div className="w-full max-w-[1140px] rounded-2xl bg-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 print:hidden">
          <h3 className="text-sm font-semibold text-slate-900">Недельный акт</h3>
          <div className="flex gap-1">
            <button
              onClick={downloadPdf}
              disabled={loading || !!error || downloading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading ? 'Готовим…' : 'Скачать PDF'}
            </button>
            <button
              onClick={() => window.print()}
              disabled={loading || !!error}
              className="inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm text-foreground hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-transparent disabled:opacity-50"
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
            size: A4 landscape;
            margin: 8mm;
          }
        }
      `}</style>
    </div>,
    document.body,
  )
}

export function ActBody({ data }: { data: ActData }) {
  const t = data.totals
  const year = new Date(data.to + 'T00:00:00').getFullYear()
  return (
    <div className="text-[10px] leading-tight">
      <div className="mb-2 border-b-2 border-black pb-1 text-center">
        <div className="text-base font-bold tracking-wide">АКТ ЗА НЕДЕЛЮ</div>
        <div className="text-[10px]">
          {fmtHuman(data.from)} — {fmtHuman(data.to)} {year}
        </div>
      </div>

      {data.companies.length === 0 ? (
        <div className="py-6 text-center text-slate-500">Нет данных за неделю</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 print:grid-cols-2">
            {data.companies.map((c) => (
              <div key={c.id} style={{ breakInside: 'avoid' }}>
                <CompanyAct block={c} />
              </div>
            ))}
          </div>

          {t && data.companies.length > 1 && (
            <div className="mt-3 border-2 border-black p-2" style={{ pageBreakInside: 'avoid' }}>
              <div className="mb-1 text-xs font-bold uppercase">Итого по всем точкам</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Big label="Доход" value={t.income.total} />
                <Big label="Расход" value={t.expense_total} />
                <Big label="Чистыми" value={t.net} accent />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-black pt-2 text-center">
                <Big label="Осталось нал" value={t.remain_cash} />
                <Big label="Осталось безнал" value={t.remain_kaspi} />
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex justify-between text-[10px] text-slate-600">
        <span>Сформировано: {new Date().toLocaleString('ru-RU')}</span>
        <span>Orda Control</span>
      </div>
    </div>
  )
}

function CompanyAct({ block }: { block: CompanyBlock }) {
  return (
    <div className="border border-black">
      {/* Заголовок точки + сводка */}
      <div className="flex items-baseline justify-between border-b border-black bg-slate-100 px-2 py-0 print:bg-slate-100">
        <span className="text-xs font-bold">{block.name}</span>
        <span className="text-[10px]">
          Доход <b>{fmt(block.income.total)}</b> · Расход <b>{fmt(block.expense_total)}</b> · Чистыми{' '}
          <b>{block.net >= 0 ? '' : '−'}{fmt(Math.abs(block.net))}</b> ₸
        </span>
      </div>

      <div>
        {/* По дням */}
        <div className="border-b border-black p-1.5">
          <div className="text-[10px] font-semibold uppercase">По дням</div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-slate-400 text-left">
                <th className="py-0 font-medium">День</th>
                <th className="py-0 text-right font-medium">Доход</th>
                <th className="py-0 text-right font-medium">Расход</th>
                <th className="py-0 text-right font-medium">Чистыми</th>
              </tr>
            </thead>
            <tbody>
              {block.daily.map((d) => (
                <tr key={d.date} className="border-b border-slate-200">
                  <td className="py-0 whitespace-nowrap">{dayShort(d.date)}</td>
                  <td className="py-0 text-right font-mono tabular-nums">{d.income ? fmt(d.income) : '—'}</td>
                  <td className="py-0 text-right font-mono tabular-nums">{d.expense ? fmt(d.expense) : '—'}</td>
                  <td className="py-0 text-right font-mono tabular-nums">
                    {d.net ? `${d.net < 0 ? '−' : ''}${fmt(Math.abs(d.net))}` : '—'}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-black font-bold">
                <td className="py-0">Итого</td>
                <td className="py-0 text-right font-mono tabular-nums">{fmt(block.income.total)}</td>
                <td className="py-0 text-right font-mono tabular-nums">{fmt(block.expense_total)}</td>
                <td className="py-0 text-right font-mono tabular-nums">
                  {block.net < 0 ? '−' : ''}{fmt(Math.abs(block.net))}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Доход: нал/безнал */}
          <div className="mt-2 flex justify-between text-[10px] text-slate-600">
            <span>Доход нал: {fmt(block.income.cash)} ₸</span>
            <span>Доход безнал: {fmt(block.income.kaspi + block.income.online + block.income.card)} ₸</span>
          </div>
          {/* Осталось по типам оплаты */}
          <div className="mt-1 border-t border-black pt-1">
            <div className="text-[11px] font-semibold uppercase">Осталось</div>
            <div className="flex justify-between text-[11px]">
              <span>
                Нал: <b className="font-mono">{block.remain_cash < 0 ? '−' : ''}{fmt(Math.abs(block.remain_cash))} ₸</b>
              </span>
              <span>
                Безнал: <b className="font-mono">{block.remain_kaspi < 0 ? '−' : ''}{fmt(Math.abs(block.remain_kaspi))} ₸</b>
              </span>
            </div>
          </div>
        </div>

        {/* Расходы по категориям */}
        <div className="p-1.5">
          <div className="text-[10px] font-semibold uppercase">Расходы по категориям</div>
          {block.expenses.length === 0 ? (
            <div className="text-[10px] text-slate-500">Расходов нет</div>
          ) : (
            <table className="w-full text-[10px]">
              <tbody>
                {block.expenses.map((e, i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-0">{e.category}</td>
                    <td className="py-0 text-right font-mono tabular-nums">{fmt(e.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-black font-bold">
                  <td className="py-0">Всего расход</td>
                  <td className="py-0 text-right font-mono tabular-nums">{fmt(block.expense_total)}</td>
                </tr>
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
    <div className={accent ? 'rounded border border-black py-0.5' : 'py-0.5'}>
      <div className="text-[9px] uppercase text-slate-600">{label}</div>
      <div className="font-mono text-sm font-bold tabular-nums">
        {value < 0 ? '−' : ''}
        {fmt(Math.abs(value))} ₸
      </div>
    </div>
  )
}
