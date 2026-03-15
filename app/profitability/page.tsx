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
  kaspi_qr_turnover: number; kaspi_qr_rate: number; kaspi_gold_turnover: number; kaspi_gold_rate: number
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
const closedMonthDefaults = () => { const lastClosed = shiftMonth(currentMonth(), -1); return { from: shiftMonth(lastClosed, -3), to: lastClosed } }
const toNumber = (value: string) => { const n = Number(value.replace(',', '.').trim() || 0); return Number.isFinite(n) ? Math.max(0, n) : 0 }
const draftFromRow = (row?: ProfitabilityInputRow | null): Draft => ({
  kaspi_qr_turnover: String(row?.kaspi_qr_turnover || ''), kaspi_qr_rate: String(row?.kaspi_qr_rate || ''),
  kaspi_gold_turnover: String(row?.kaspi_gold_turnover || ''), kaspi_gold_rate: String(row?.kaspi_gold_rate || ''),
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
  const defaults = useMemo(closedMonthDefaults, [])
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
    const kaspiQrTurnover = Number(manual?.kaspi_qr_turnover || 0)
    const kaspiQrRate = Number(manual?.kaspi_qr_rate || 0)
    const kaspiGoldTurnover = Number(manual?.kaspi_gold_turnover || 0)
    const kaspiGoldRate = Number(manual?.kaspi_gold_rate || 0)
    const legacyQrGoldTurnover = Number(manual?.qr_gold_turnover || 0)
    const legacyQrGoldRate = Number(manual?.qr_gold_rate || 0)
    const otherCardsTurnover = Number(manual?.other_cards_turnover || 0)
    const otherCardsRate = Number(manual?.other_cards_rate || 0)
    const kaspiRedTurnover = Number(manual?.kaspi_red_turnover || 0)
    const kaspiRedRate = Number(manual?.kaspi_red_rate || 0)
    const kaspiKreditTurnover = Number(manual?.kaspi_kredit_turnover || 0)
    const kaspiKreditRate = Number(manual?.kaspi_kredit_rate || 0)
    const hasSplitQrAndGold = kaspiQrTurnover > 0 || kaspiGoldTurnover > 0
    const legacyQrGoldCommission = hasSplitQrAndGold ? 0 : legacyQrGoldTurnover * legacyQrGoldRate / 100
    const kaspiQrCommission = kaspiQrTurnover * kaspiQrRate / 100
    const kaspiGoldCommission = kaspiGoldTurnover * kaspiGoldRate / 100
    const otherCardsCommission = otherCardsTurnover * otherCardsRate / 100
    const kaspiRedCommission = kaspiRedTurnover * kaspiRedRate / 100
    const kaspiKreditCommission = kaspiKreditTurnover * kaspiKreditRate / 100
    const posTurnover = kaspiQrTurnover + kaspiGoldTurnover + otherCardsTurnover + kaspiRedTurnover + kaspiKreditTurnover + (hasSplitQrAndGold ? 0 : legacyQrGoldTurnover)
    const posCommission = kaspiQrCommission + kaspiGoldCommission + otherCardsCommission + kaspiRedCommission + kaspiKreditCommission + legacyQrGoldCommission
    const payroll = Number(manual?.payroll_amount || 0), payrollTaxes = Number(manual?.payroll_taxes_amount || 0), otherOperating = Number(manual?.other_operating_amount || 0)
    const depreciation = Number(manual?.depreciation_amount || 0), amortization = Number(manual?.amortization_amount || 0), incomeTax = Number(manual?.income_tax_amount || 0)
    const ebitda = income.revenue - journalExpenses - posCommission - payroll - payrollTaxes - otherOperating
    const operatingProfit = ebitda - depreciation - amortization
    const netProfit = operatingProfit - incomeTax
    return {
      month,
      label: monthLabel(month),
      revenue: income.revenue,
      cashRevenue: income.cash,
      cashlessRevenue: income.cashless,
      journalExpenses,
      posTurnover,
      posCommission,
      kaspiQrTurnover,
      kaspiQrRate,
      kaspiQrCommission,
      kaspiGoldTurnover,
      kaspiGoldRate,
      kaspiGoldCommission,
      otherCardsTurnover,
      otherCardsRate,
      otherCardsCommission,
      kaspiRedTurnover,
      kaspiRedRate,
      kaspiRedCommission,
      kaspiKreditTurnover,
      kaspiKreditRate,
      kaspiKreditCommission,
      legacyQrGoldTurnover,
      legacyQrGoldRate,
      legacyQrGoldCommission,
      payroll,
      payrollTaxes,
      otherOperating,
      ebitda,
      depreciation,
      amortization,
      operatingProfit,
      incomeTax,
      netProfit,
      notes: manual?.notes || null,
    }
  }), [expenses, incomes, inputs, months])

  const selected = useMemo(() => rows.find((row) => row.month === selectedMonth) || rows[rows.length - 1] || null, [rows, selectedMonth])
  const totals = useMemo(() => rows.reduce((acc, row) => ({ revenue: acc.revenue + row.revenue, ebitda: acc.ebitda + row.ebitda, operatingProfit: acc.operatingProfit + row.operatingProfit, netProfit: acc.netProfit + row.netProfit }), { revenue: 0, ebitda: 0, operatingProfit: 0, netProfit: 0 }), [rows])
  const periodLabel = `${monthStart(monthFrom)} - ${monthEnd(monthTo)}`
  const draftPreview = useMemo(() => {
    if (!selected) return null

    const kaspiQrTurnover = toNumber(draft.kaspi_qr_turnover || '')
    const kaspiQrRate = toNumber(draft.kaspi_qr_rate || '')
    const kaspiGoldTurnover = toNumber(draft.kaspi_gold_turnover || '')
    const kaspiGoldRate = toNumber(draft.kaspi_gold_rate || '')
    const otherCardsTurnover = toNumber(draft.other_cards_turnover || '')
    const otherCardsRate = toNumber(draft.other_cards_rate || '')
    const kaspiRedTurnover = toNumber(draft.kaspi_red_turnover || '')
    const kaspiRedRate = toNumber(draft.kaspi_red_rate || '')
    const kaspiKreditTurnover = toNumber(draft.kaspi_kredit_turnover || '')
    const kaspiKreditRate = toNumber(draft.kaspi_kredit_rate || '')
    const payroll = toNumber(draft.payroll_amount || '')
    const payrollTaxes = toNumber(draft.payroll_taxes_amount || '')
    const incomeTax = toNumber(draft.income_tax_amount || '')
    const depreciation = toNumber(draft.depreciation_amount || '')
    const amortization = toNumber(draft.amortization_amount || '')
    const otherOperating = toNumber(draft.other_operating_amount || '')

    const posCommission =
      kaspiQrTurnover * kaspiQrRate / 100 +
      kaspiGoldTurnover * kaspiGoldRate / 100 +
      otherCardsTurnover * otherCardsRate / 100 +
      kaspiRedTurnover * kaspiRedRate / 100 +
      kaspiKreditTurnover * kaspiKreditRate / 100

    const ebitda = selected.revenue - selected.journalExpenses - posCommission - payroll - payrollTaxes - otherOperating
    const operatingProfit = ebitda - depreciation - amortization
    const netProfit = operatingProfit - incomeTax

    return {
      posCommission,
      payroll,
      payrollTaxes,
      otherOperating,
      ebitda,
      operatingProfit,
      netProfit,
    }
  }, [draft, selected])

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
                <div>
                  <h1 className="text-3xl font-semibold text-white">ОПиУ и EBITDA</h1>
                  <p className="text-sm text-slate-300">Выручка берётся только из журнала доходов. Ручные поля ниже нужны для комиссий Kaspi POS, зарплат, налогов и прочих корректировок прибыли.</p>
                  <p className="mt-1 text-xs text-slate-400">По умолчанию показываем 4 закрытых полных месяца без текущего незакрытого месяца.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
                  <CalendarDays className="h-4 w-4 text-emerald-300" />
                  <input type="month" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} className="bg-transparent outline-none" />
                  <span className="text-slate-500">—</span>
                  <input type="month" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} className="bg-transparent outline-none" />
                </div>
                <Button variant="outline" size="sm" onClick={() => { const closed = closedMonthDefaults(); setMonthFrom(closed.from); setMonthTo(closed.to) }} className="border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]">4 закрытых месяца</Button>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
              Период расчёта: <span className="font-medium text-white">{periodLabel}</span>
            </div>
            {error ? <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
            {success ? <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">Фактическая выручка</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.revenue)}</p><p className="mt-1 text-xs text-slate-500">Только по журналу доходов за {periodLabel}</p></div><TrendingUp className="h-5 w-5 text-emerald-300" /></div></Card>
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">EBITDA за период</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.ebitda)}</p></div><Calculator className="h-5 w-5 text-cyan-300" /></div></Card>
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">Опер. прибыль</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.operatingProfit)}</p></div><Wallet className="h-5 w-5 text-amber-300" /></div></Card>
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">Чистая прибыль</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.netProfit)}</p></div><TrendingDown className="h-5 w-5 text-rose-300" /></div></Card>
          </div>

          <Card className="border border-white/10 bg-white/[0.03] p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-white">Справка по терминам</h2>
              <p className="text-sm text-slate-400">Короткие объяснения, что именно считается в этой странице и как читать итоговые показатели.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">Что такое выручка</div>
                <p className="mt-2 text-sm text-slate-300">Это только доходы из журнала: наличные, Kaspi POS, online и карта. Ручные комиссии Kaspi не добавляют выручку, а уменьшают прибыль.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">Оборот POS</div>
                <p className="mt-2 text-sm text-slate-300">Это объём оплат, прошедших через терминал или сервис Kaspi по конкретному типу оплаты. Он нужен только для расчёта комиссии банка.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">Комиссия POS</div>
                <p className="mt-2 text-sm text-slate-300">Это удержание банка за эквайринг. Она не увеличивает выручку и не заменяет расходы из журнала, а отдельно уменьшает прибыль месяца.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">Что такое EBITDA</div>
                <p className="mt-2 text-sm text-slate-300">EBITDA = выручка минус расходы из журнала, комиссия POS, фонд оплаты труда, налоги на зарплату и прочие операционные расходы. Без износа, амортизации и налога на прибыль.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">Операционная прибыль</div>
                <p className="mt-2 text-sm text-slate-300">Это EBITDA после вычета износа и амортизации. Показывает, сколько бизнес зарабатывает после основных операционных затрат и учёта износа активов.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">Чистая прибыль</div>
                <p className="mt-2 text-sm text-slate-300">Это итог после всех расходов, комиссий, зарплат, амортизации и налога на прибыль или условного 3%. Именно этот показатель ближе всего к реальному результату месяца.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">ФОТ, налоги и амортизация</div>
                <p className="mt-2 text-sm text-slate-300">ФОТ — зарплаты за месяц. Налоги на зарплату — обязательные начисления на ФОТ. Износ и амортизация — постепенное списание стоимости оборудования и других активов.</p>
              </div>
            </div>
          </Card>

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
                    <Card className="border border-white/10 bg-slate-950/60 p-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white"><CreditCard className="h-4 w-4 text-emerald-300" />POS и безнал</div>
                      <div className="space-y-2 text-sm text-slate-300">
                        <div className="flex justify-between"><span>Безналичная выручка</span><span>{money(selected.cashlessRevenue)}</span></div>
                        <div className="flex justify-between"><span>Kaspi QR</span><span>{money(selected.kaspiQrTurnover)} / {money(selected.kaspiQrCommission)}</span></div>
                        <div className="flex justify-between"><span>Kaspi Gold</span><span>{money(selected.kaspiGoldTurnover)} / {money(selected.kaspiGoldCommission)}</span></div>
                        <div className="flex justify-between"><span>Другие карты</span><span>{money(selected.otherCardsTurnover)} / {money(selected.otherCardsCommission)}</span></div>
                        <div className="flex justify-between"><span>Kaspi Red</span><span>{money(selected.kaspiRedTurnover)} / {money(selected.kaspiRedCommission)}</span></div>
                        <div className="flex justify-between"><span>Kaspi Kredit</span><span>{money(selected.kaspiKreditTurnover)} / {money(selected.kaspiKreditCommission)}</span></div>
                        {selected.legacyQrGoldTurnover > 0 ? <div className="flex justify-between text-amber-300"><span>Старый общий QR/Gold</span><span>{money(selected.legacyQrGoldTurnover)} / {money(selected.legacyQrGoldCommission)}</span></div> : null}
                        <div className="flex justify-between border-t border-white/10 pt-2 font-medium text-white"><span>Итого комиссия POS</span><span>{money(selected.posCommission)}</span></div>
                      </div>
                    </Card>
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="mb-2 text-sm font-medium text-white">Комментарий месяца</div><p className="text-sm text-slate-300">{selected.notes || 'Комментарий не заполнен. Здесь можно фиксировать изменения по ставкам Kaspi и ручные допущения месяца.'}</p></Card>
                  </div>
                  {selected.legacyQrGoldTurnover > 0 ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">Для этого месяца найдены старые объединённые данные QR/Gold. Лучше переписать их отдельно в полях Kaspi QR и Kaspi Gold, чтобы комиссия считалась точнее.</div> : null}
                </div>
              ) : null}
            </Card>

            <Card className="border border-white/10 bg-white/[0.03] p-6">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-white">Ручные месячные вводы</h2>
                <p className="text-sm text-slate-400">Здесь вы вносите комиссии и расходы, которых нет в основном журнале. Выручка сверху от этого не растёт, меняется только прибыль.</p>
              </div>
              <div className="mt-6 space-y-4">
                {[
                  ['kaspi_qr_turnover', 'kaspi_qr_rate', 'Kaspi QR'],
                  ['kaspi_gold_turnover', 'kaspi_gold_rate', 'Kaspi Gold'],
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
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                  <div className="font-medium text-white">Как заполнять комиссии POS</div>
                  <ul className="mt-2 space-y-1">
                    <li>Kaspi QR: оборот оплат по QR и ставка комиссии именно для QR.</li>
                    <li>Kaspi Gold: оборот оплат картой Gold и ставка комиссии именно для Gold.</li>
                    <li>Другие карты: все остальные банковские карты.</li>
                    <li>Kaspi Red и Kaspi Kredit: указывайте отдельно, если по ним другая ставка банка.</li>
                  </ul>
                </div>
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
                {selected && draftPreview ? (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                      <Calculator className="h-4 w-4 text-emerald-300" />
                      Предварительный расчёт для {monthLabel(selectedMonth)}
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Сейчас сохранено</div>
                        <div className="space-y-2 text-sm text-slate-300">
                          <div className="flex justify-between"><span>Комиссия POS</span><span>{money(selected.posCommission)}</span></div>
                          <div className="flex justify-between"><span>EBITDA</span><span>{money(selected.ebitda)}</span></div>
                          <div className="flex justify-between"><span>Опер. прибыль</span><span>{money(selected.operatingProfit)}</span></div>
                          <div className="flex justify-between font-medium text-white"><span>Чистая прибыль</span><span>{money(selected.netProfit)}</span></div>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-emerald-500/20 bg-slate-950/60 p-4">
                        <div className="mb-2 text-xs uppercase tracking-wide text-emerald-300">Будет после сохранения</div>
                        <div className="space-y-2 text-sm text-slate-200">
                          <div className="flex justify-between"><span>Комиссия POS</span><span>{money(draftPreview.posCommission)}</span></div>
                          <div className="flex justify-between"><span>EBITDA</span><span>{money(draftPreview.ebitda)}</span></div>
                          <div className="flex justify-between"><span>Опер. прибыль</span><span>{money(draftPreview.operatingProfit)}</span></div>
                          <div className="flex justify-between font-medium text-white"><span>Чистая прибыль</span><span>{money(draftPreview.netProfit)}</span></div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-emerald-100/80">
                      Калькулятор работает сразу по введённым полям. Пока вы не нажмёте сохранить, это только предварительный расчёт.
                    </div>
                  </div>
                ) : null}
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
