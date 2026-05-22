'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

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

// Понедельник недели, в которую попадает дата
function mondayOf(d: Date) {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7 // 0 = понедельник
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtHuman(isoStr: string) {
  return new Date(isoStr + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export default function WeeklyActPage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [data, setData] = useState<ActData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = iso(weekStart)
  const toDate = new Date(weekStart)
  toDate.setDate(toDate.getDate() + 6)
  const to = iso(toDate)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/weekly-act?from=${from}&to=${to}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || 'Ошибка загрузки')
      setData(j.data as ActData)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const shiftWeek = (deltaWeeks: number) => {
    const x = new Date(weekStart)
    x.setDate(x.getDate() + deltaWeeks * 7)
    setWeekStart(mondayOf(x))
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      {/* Панель управления — не печатается */}
      <div className="no-print flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-white mr-auto">Недельный акт</h1>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 text-sm text-slate-300 whitespace-nowrap">
            {fmtHuman(from)} — {fmtHuman(to)}
          </span>
          <Button variant="outline" size="sm" onClick={() => shiftWeek(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(mondayOf(new Date()))}>
            Текущая
          </Button>
        </div>
        <Button size="sm" onClick={() => window.print()} disabled={loading || !data}>
          <Printer className="h-4 w-4" />
          Печать
        </Button>
      </div>

      {error && (
        <Card className="no-print border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</Card>
      )}

      {loading ? (
        <Card className="border-white/10 p-10 text-center text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </Card>
      ) : !data ? null : (
        <ActSheet data={data} from={from} to={to} />
      )}
    </div>
  )
}

function ActSheet({ data, from, to }: { data: ActData; from: string; to: string }) {
  const t = data.totals
  return (
    <Card className="border-white/10 bg-white/[0.02] p-6 print:border-0 print:bg-white print:p-0">
      {/* Шапка акта */}
      <div className="mb-5 border-b border-white/10 pb-4 text-center print:border-black">
        <div className="text-lg font-bold tracking-wide text-white print:text-black">
          АКТ ЗА НЕДЕЛЮ
        </div>
        <div className="mt-1 text-sm text-slate-400 print:text-black">
          {fmtHuman(from)} — {fmtHuman(to)} {new Date(to + 'T00:00:00').getFullYear()}
        </div>
      </div>

      {data.companies.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">Нет данных за неделю</div>
      ) : (
        <div className="space-y-6">
          {data.companies.map((c) => (
            <CompanySection key={c.id} block={c} />
          ))}

          {/* Общий итог */}
          {t && data.companies.length > 1 && (
            <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/[0.04] p-4 print:border-black">
              <div className="mb-2 text-sm font-bold uppercase tracking-wider text-emerald-300 print:text-black">
                Итого по всем точкам
              </div>
              <SummaryRows
                income={t.income}
                expenses={t.expenses}
                expenseTotal={t.expense_total}
                net={t.net}
                bold
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-between text-[11px] text-slate-500 print:text-black">
        <span>Сформировано: {new Date().toLocaleString('ru-RU')}</span>
        <span>Orda Control</span>
      </div>
    </Card>
  )
}

function CompanySection({ block }: { block: CompanyBlock }) {
  return (
    <div className="rounded-lg border border-white/10 p-4 print:border-black" style={{ pageBreakInside: 'avoid' }}>
      <div className="mb-3 flex items-baseline justify-between border-b border-white/5 pb-2 print:border-black">
        <span className="text-base font-semibold text-white print:text-black">{block.name}</span>
        {block.code && (
          <span className="text-xs text-slate-500 print:text-black">{block.code}</span>
        )}
      </div>
      <SummaryRows
        income={block.income}
        expenses={block.expenses}
        expenseTotal={block.expense_total}
        net={block.net}
      />
    </div>
  )
}

function SummaryRows({
  income,
  expenses,
  expenseTotal,
  net,
  bold,
}: {
  income: IncomeAgg
  expenses: ExpenseCat[]
  expenseTotal: number
  net: number
  bold?: boolean
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Доход */}
      <div>
        <div className="mb-1 text-xs uppercase tracking-wider text-emerald-300/80 print:text-black">
          Доход
        </div>
        <Row label="Наличные" value={income.cash} />
        <Row label="Безналичные" value={income.kaspi + income.online + income.card} />
        <div className="my-1 border-t border-white/10 print:border-black" />
        <Row label="Всего доход" value={income.total} strong />
      </div>

      {/* Расход по категориям */}
      <div>
        <div className="mb-1 text-xs uppercase tracking-wider text-rose-300/80 print:text-black">
          Расход по категориям
        </div>
        {expenses.length === 0 ? (
          <div className="text-xs text-slate-500 print:text-black">Расходов нет</div>
        ) : (
          expenses.map((e) => <Row key={e.category} label={e.category} value={e.amount} />)
        )}
        <div className="my-1 border-t border-white/10 print:border-black" />
        <Row label="Всего расход" value={expenseTotal} strong />
      </div>

      {/* Net на всю ширину */}
      <div className="md:col-span-2 mt-1 rounded-md bg-white/[0.03] px-3 py-2 print:bg-transparent">
        <div className="flex items-center justify-between">
          <span className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} text-white print:text-black`}>
            Чистыми (доход − расход)
          </span>
          <span
            className={`font-mono text-lg font-bold tabular-nums ${
              net >= 0 ? 'text-emerald-300' : 'text-rose-300'
            } print:text-black`}
          >
            {net >= 0 ? '' : '−'}
            {fmt(Math.abs(net))} ₸
          </span>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className={`${strong ? 'font-semibold text-white' : 'text-slate-300'} print:text-black`}>
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${strong ? 'font-semibold text-white' : 'text-slate-200'} print:text-black`}
      >
        {fmt(value)} ₸
      </span>
    </div>
  )
}
