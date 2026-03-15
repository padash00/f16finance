'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabaseClient'
import { Calculator, CalendarDays, CreditCard, Landmark, Save, TrendingDown, TrendingUp, Wallet } from 'lucide-react'

type IncomeRow = { date: string; cash_amount: number | null; kaspi_amount: number | null; card_amount: number | null; online_amount: number | null }
type ExpenseRow = { date: string; cash_amount: number | null; kaspi_amount: number | null }
type ProfitabilityInputRow = {
  month: string
  qr_gold_turnover: number; qr_gold_rate: number; other_cards_turnover: number; other_cards_rate: number
  kaspi_red_turnover: number; kaspi_red_rate: number; kaspi_kredit_turnover: number; kaspi_kredit_rate: number
  payroll_amount: number; payroll_taxes_amount: number; income_tax_amount: number
  depreciation_amount: number; amortization_amount: number; other_operating_amount: number; notes: string | null
}
type Draft = Record<string, string>

const money = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₸`
const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toFixed(2)}%`
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const shiftMonth = (month: string, offset: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + offset, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleString('ru-RU', { month: 'long', year: 'numeric' })
const monthStart = (month: string) => `${month}-01`
const monthEnd = (month: string) => { const d = new Date(`${month}-01T12:00:00`); d.setMonth(d.getMonth() + 1, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const toNumber = (value: string) => { const n = Number(value.replace(',', '.').trim() || 0); return Number.isFinite(n) ? Math.max(0, n) : 0 }
const draftFromRow = (row?: ProfitabilityInputRow | null): Draft => ({
  qr_gold_turnover: String(row?.qr_gold_turnover || ''), qr_gold_rate: String(row?.qr_gold_rate || ''),
  other_cards_turnover: String(row?.other_cards_turnover || ''), other_cards_rate: String(row?.other_cards_rate || ''),
  kaspi_red_turnover: String(row?.kaspi_red_turnover || ''), kaspi_red_rate: String(row?.kaspi_red_rate || ''),
  kaspi_kredit_turnover: String(row?.kaspi_kredit_turnover || ''), kaspi_kredit_rate: String(row?.kaspi_kredit_rate || ''),
  payroll_amount: String(row?.payroll_amount || ''), payroll_taxes_amount: String(row?.payroll_taxes_amount || ''),
  income_tax_amount: String(row?.income_tax_amount || ''), depreciation_amount: String(row?.depreciation_amount || ''),
  amortization_amount: String(row?.amortization_amount || ''), other_operating_amount: String(row?.other_operating_amount || ''),
  notes: row?.notes || '',
})

function buildMonths(from: string, to: string) {
  const result: string[] = []
  const cursor = new Date(`${from}-01T12:00:00`)
  const end = new Date(`${to}-01T12:00:00`)
  while (cursor <= end) {
    result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return result
}

export default function ProfitabilityPage() {
  const defaults = useMemo(() => { const now = currentMonth(); return { from: shiftMonth(now, -5), to: now } }, [])
  const [monthFrom, setMonthFrom] = useState(defaults.from)
  const [monthTo, setMonthTo] = useState(defaults.to)
  const [selectedMonth, setSelectedMonth] = useState(defaults.to)
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [inputs, setInputs] = useState<Record<string, ProfitabilityInputRow>>({})
  const [draft, setDraft] = useState<Draft>(draftFromRow())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const months = useMemo(() => buildMonths(monthFrom, monthTo), [monthFrom, monthTo])

  useEffect(() => {
    if (!months.includes(selectedMonth)) setSelectedMonth(months[months.length - 1] || monthTo)
  }, [months, monthTo, selectedMonth])

  useEffect(() => {
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const [incomeRes, expenseRes, inputsRes] = await Promise.all([
          supabase.from('incomes').select('date,cash_amount,kaspi_amount,card_amount,online_amount').gte('date', monthStart(monthFrom)).lte('date', monthEnd(monthTo)).order('date'),
          supabase.from('expenses').select('date,cash_amount,kaspi_amount').gte('date', monthStart(monthFrom)).lte('date', monthEnd(monthTo)).order('date'),
          fetch(`/api/admin/profitability?from=${monthFrom}&to=${monthTo}`),
        ])
        if (incomeRes.error) throw incomeRes.error
        if (expenseRes.error) throw expenseRes.error
        if (!inputsRes.ok) throw new Error((await inputsRes.json().catch(() => null))?.error || 'Не удалось загрузить месячные вводы')
        const payload = (await inputsRes.json()) as { items?: ProfitabilityInputRow[] }
        setIncomes((incomeRes.data || []) as IncomeRow[])
        setExpenses((expenseRes.data || []) as ExpenseRow[])
        setInputs(Object.fromEntries((payload.items || []).map((row) => [row.month.slice(0, 7), row])) as Record<string, ProfitabilityInputRow>)
      } catch (e: any) {
        setError(e?.message || 'Не удалось загрузить страницу прибыли')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [monthFrom, monthTo])

  useEffect(() => { setDraft(draftFromRow(inputs[selectedMonth])); setSuccess(null) }, [inputs, selectedMonth])

  const rows = useMemo(() => months.map((month) => {
    const income = incomes.filter((row) => row.date.startsWith(month)).reduce((acc, row) => {
      const cash = Number(row.cash_amount || 0), kaspi = Number(row.kaspi_amount || 0), card = Number(row.card_amount || 0), online = Number(row.online_amount || 0)
      acc.revenue += cash + kaspi + card + online; acc.cash += cash; acc.cashless += kaspi + card + online; return acc
    }, { revenue: 0, cash: 0, cashless: 0 })
    const journalExpenses = expenses.filter((row) => row.date.startsWith(month)).reduce((acc, row) => acc + Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0), 0)
    const manual = inputs[month]
    const posTurnover = Number(manual?.qr_gold_turnover || 0) + Number(manual?.other_cards_turnover || 0) + Number(manual?.kaspi_red_turnover || 0) + Number(manual?.kaspi_kredit_turnover || 0)
    const posCommission =
      Number(manual?.qr_gold_turnover || 0) * Number(manual?.qr_gold_rate || 0) / 100 +
      Number(manual?.other_cards_turnover || 0) * Number(manual?.other_cards_rate || 0) / 100 +
      Number(manual?.kaspi_red_turnover || 0) * Number(manual?.kaspi_red_rate || 0) / 100 +
      Number(manual?.kaspi_kredit_turnover || 0) * Number(manual?.kaspi_kredit_rate || 0) / 100
    const payroll = Number(manual?.payroll_amount || 0), payrollTaxes = Number(manual?.payroll_taxes_amount || 0), otherOperating = Number(manual?.other_operating_amount || 0)
    const depreciation = Number(manual?.depreciation_amount || 0), amortization = Number(manual?.amortization_amount || 0), incomeTax = Number(manual?.income_tax_amount || 0)
    const ebitda = income.revenue - journalExpenses - posCommission - payroll - payrollTaxes - otherOperating
    const operatingProfit = ebitda - depreciation - amortization
    const netProfit = operatingProfit - incomeTax
    return { month, label: monthLabel(month), revenue: income.revenue, cashRevenue: income.cash, cashlessRevenue: income.cashless, journalExpenses, posTurnover, posCommission, payroll, payrollTaxes, otherOperating, ebitda, depreciation, amortization, operatingProfit, incomeTax, netProfit, notes: manual?.notes || null }
  }), [expenses, incomes, inputs, months])

  const selected = useMemo(() => rows.find((row) => row.month === selectedMonth) || rows[rows.length - 1] || null, [rows, selectedMonth])
  const totals = useMemo(() => rows.reduce((acc, row) => ({ revenue: acc.revenue + row.revenue, ebitda: acc.ebitda + row.ebitda, operatingProfit: acc.operatingProfit + row.operatingProfit, netProfit: acc.netProfit + row.netProfit }), { revenue: 0, ebitda: 0, operatingProfit: 0, netProfit: 0 }), [rows])

  const save = async () => {
    setSaving(true); setError(null); setSuccess(null)
    try {
      const res = await fetch('/api/admin/profitability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth, payload: Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, key === 'notes' ? value : toNumber(value)])) }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Не удалось сохранить месячные вводы')
      const item = payload?.item as ProfitabilityInputRow | undefined
      if (item) setInputs((prev) => ({ ...prev, [item.month.slice(0, 7)]: item }))
      setSuccess(`Сохранено для ${monthLabel(selectedMonth)}`)
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить месячные вводы')
    } finally {
      setSaving(false)
    }
  }

  const netMargin = selected?.revenue ? (selected.netProfit / selected.revenue) * 100 : 0
  const ebitdaMargin = selected?.revenue ? (selected.ebitda / selected.revenue) * 100 : 0

  return (
    <div className="app-shell-layout bg-gradient-to-br from-gray-950 via-slate-950 to-emerald-950 text-foreground">
      <Sidebar />
      <main className="app-main">
        <div className="app-page max-w-7xl space-y-6">
          <Card className="border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 via-slate-950/90 to-gray-950 p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3"><Landmark className="h-7 w-7 text-emerald-300" /></div>
                <div><h1 className="text-3xl font-semibold text-white">ОПиУ и EBITDA</h1><p className="text-sm text-slate-300">Факт из доходов и расходов плюс ручные месячные комиссии POS, зарплата и корректировки.</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
                  <CalendarDays className="h-4 w-4 text-emerald-300" />
                  <input type="month" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} className="bg-transparent outline-none" />
                  <span className="text-slate-500">—</span>
                  <input type="month" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} className="bg-transparent outline-none" />
                </div>
                <Button variant="outline" size="sm" onClick={() => { const now = currentMonth(); setMonthFrom(shiftMonth(now, -5)); setMonthTo(now) }} className="border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]">6 месяцев</Button>
              </div>
            </div>
            {error ? <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
            {success ? <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">Выручка за период</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.revenue)}</p></div><TrendingUp className="h-5 w-5 text-emerald-300" /></div></Card>
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">EBITDA за период</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.ebitda)}</p></div><Calculator className="h-5 w-5 text-cyan-300" /></div></Card>
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">Опер. прибыль</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.operatingProfit)}</p></div><Wallet className="h-5 w-5 text-amber-300" /></div></Card>
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">Чистая прибыль</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.netProfit)}</p></div><TrendingDown className="h-5 w-5 text-rose-300" /></div></Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1fr]">
            <Card className="border border-white/10 bg-white/[0.03] p-6">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div><h2 className="text-xl font-semibold text-white">Разбор месяца</h2><p className="text-sm text-slate-400">ОПиУ-структура по выбранному месяцу.</p></div>
                <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none">{months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select>
              </div>
              {loading ? <div className="text-sm text-slate-400">Загружаем расчёт прибыли...</div> : selected ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="text-xs uppercase tracking-wide text-slate-500">EBITDA</div><div className="mt-2 text-xl font-semibold text-white">{money(selected.ebitda)}</div><div className="mt-1 text-xs text-slate-400">{pct(ebitdaMargin)}</div></Card>
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="text-xs uppercase tracking-wide text-slate-500">Опер. прибыль</div><div className="mt-2 text-xl font-semibold text-white">{money(selected.operatingProfit)}</div><div className="mt-1 text-xs text-slate-400">{selected.label}</div></Card>
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="text-xs uppercase tracking-wide text-slate-500">Чистая прибыль</div><div className="mt-2 text-xl font-semibold text-white">{money(selected.netProfit)}</div><div className="mt-1 text-xs text-slate-400">{pct(netMargin)}</div></Card>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-white/10">
                    <table className="w-full text-sm"><tbody>
                      {[
                        ['Выручка', selected.revenue], ['Расходы из журнала', -selected.journalExpenses], ['Комиссия Kaspi POS', -selected.posCommission],
                        ['Фонд оплаты труда', -selected.payroll], ['Налоги на зарплату', -selected.payrollTaxes], ['Прочие операционные', -selected.otherOperating],
                        ['EBITDA', selected.ebitda], ['Износ', -selected.depreciation], ['Амортизация', -selected.amortization],
                        ['Операционная прибыль', selected.operatingProfit], ['Налог на прибыль / 3%', -selected.incomeTax], ['Чистая прибыль', selected.netProfit],
                      ].map(([label, value]) => <tr key={String(label)} className="border-b border-white/5 last:border-b-0"><td className="px-4 py-3 text-slate-300">{label}</td><td className={`px-4 py-3 text-right font-medium ${(Number(value) >= 0) ? 'text-emerald-300' : 'text-rose-300'}`}>{money(Number(value))}</td></tr>)}
                    </tbody></table>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium text-white"><CreditCard className="h-4 w-4 text-emerald-300" />POS и безнал</div><div className="space-y-2 text-sm text-slate-300"><div className="flex justify-between"><span>Безналичная выручка</span><span>{money(selected.cashlessRevenue)}</span></div><div className="flex justify-between"><span>Ручной оборот POS</span><span>{money(selected.posTurnover)}</span></div><div className="flex justify-between"><span>Комиссия POS</span><span>{money(selected.posCommission)}</span></div></div></Card>
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="mb-2 text-sm font-medium text-white">Комментарий месяца</div><p className="text-sm text-slate-300">{selected.notes || 'Комментарий не заполнен. Здесь можно фиксировать изменения по ставкам Kaspi и ручные допущения месяца.'}</p></Card>
                  </div>
                </div>
              ) : null}
            </Card>

            <Card className="border border-white/10 bg-white/[0.03] p-6">
              <div className="space-y-1"><h2 className="text-xl font-semibold text-white">Ручные месячные вводы</h2><p className="text-sm text-slate-400">Разбивка по Kaspi POS и корректировки прибыли, которых нет в основном журнале.</p></div>
              <div className="mt-6 space-y-4">
                {[
                  ['qr_gold_turnover', 'qr_gold_rate', 'Kaspi QR / Gold'],
                  ['other_cards_turnover', 'other_cards_rate', 'Другие карты'],
                  ['kaspi_red_turnover', 'kaspi_red_rate', 'Kaspi Red'],
                  ['kaspi_kredit_turnover', 'kaspi_kredit_rate', 'Kaspi Kredit'],
                ].map(([turnoverKey, rateKey, label]) => (
                  <div key={String(label)} className="grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 md:grid-cols-[1fr_180px_120px] md:items-center">
                    <div className="text-sm font-medium text-white">{label}</div>
                    <Input type="number" min="0" step="100" value={draft[turnoverKey]} onChange={(e) => setDraft((prev) => ({ ...prev, [turnoverKey]: e.target.value }))} placeholder="Оборот, ₸" className="border-white/10 bg-black/20 text-white" />
                    <Input type="number" min="0" step="0.01" value={draft[rateKey]} onChange={(e) => setDraft((prev) => ({ ...prev, [rateKey]: e.target.value }))} placeholder="%" className="border-white/10 bg-black/20 text-white" />
                  </div>
                ))}
                {[
                  ['payroll_amount', 'ФОТ за месяц'], ['payroll_taxes_amount', 'Налоги на зарплату'], ['income_tax_amount', 'Налог на прибыль / 3%'],
                  ['depreciation_amount', 'Износ'], ['amortization_amount', 'Амортизация'], ['other_operating_amount', 'Прочие операционные'],
                ].map(([key, label]) => (
                  <div key={String(key)} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px] md:items-center">
                    <label className="text-sm text-white">{label}</label>
                    <Input type="number" min="0" step="100" value={draft[key]} onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))} placeholder="0" className="border-white/10 bg-slate-950/70 text-white" />
                  </div>
                ))}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white">Комментарий по месяцу</label>
                  <Textarea value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Например: изменился договор с Kaspi или была разовая корректировка прибыли." className="min-h-28 border-white/10 bg-slate-950/70 text-white" />
                </div>
                <Button onClick={save} disabled={saving || !selectedMonth} className="w-full bg-emerald-600 text-white hover:bg-emerald-500"><Save className="mr-2 h-4 w-4" />{saving ? 'Сохраняем...' : `Сохранить ${monthLabel(selectedMonth)}`}</Button>
              </div>
            </Card>
          </div>

          <Card className="border border-white/10 bg-white/[0.03] p-6">
            <div className="mb-4"><h2 className="text-xl font-semibold text-white">Помесячная таблица прибыли</h2><p className="text-sm text-slate-400">Факт из системы объединён с ручными месячными вводами по комиссиям и корректировкам.</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-400"><th className="px-3 py-3">Месяц</th><th className="px-3 py-3 text-right">Выручка</th><th className="px-3 py-3 text-right">Расходы</th><th className="px-3 py-3 text-right">POS</th><th className="px-3 py-3 text-right">EBITDA</th><th className="px-3 py-3 text-right">Опер. прибыль</th><th className="px-3 py-3 text-right">Чистая прибыль</th></tr></thead>
                <tbody>{rows.map((row) => <tr key={row.month} className="border-b border-white/5 text-slate-200 hover:bg-white/[0.03]"><td className="px-3 py-3 font-medium">{row.label}</td><td className="px-3 py-3 text-right">{money(row.revenue)}</td><td className="px-3 py-3 text-right">{money(row.journalExpenses)}</td><td className="px-3 py-3 text-right">{money(row.posCommission)}</td><td className={`px-3 py-3 text-right font-medium ${row.ebitda >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(row.ebitda)}</td><td className={`px-3 py-3 text-right font-medium ${row.operatingProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(row.operatingProfit)}</td><td className={`px-3 py-3 text-right font-semibold ${row.netProfit >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{money(row.netProfit)}</td></tr>)}</tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
