'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'
import { ArrowDown, ArrowUp, BarChart2, Calculator, CalendarDays, CreditCard, Landmark, Save, TrendingDown, TrendingUp, Wallet } from 'lucide-react'

type IncomeRow = { date: string; cash_amount: number | null; kaspi_amount: number | null; card_amount: number | null; online_amount: number | null }
type ExpenseRow = { date: string; category: string | null; cash_amount: number | null; kaspi_amount: number | null }
type ExpenseCategoryRow = { name: string; accounting_group: FinancialGroup | null }
type KaspiDailyDay = { date: string; total: number; isPrecise: boolean; warning: string | null }
type KaspiDailyPayload = { monthly?: Record<string, number>; days?: KaspiDailyDay[]; splitCompanyIds?: string[] }
type ProfitabilityInputRow = {
  month: string
  cash_revenue_override: number; pos_revenue_override: number
  kaspi_qr_turnover: number; kaspi_qr_rate: number; kaspi_gold_turnover: number; kaspi_gold_rate: number
  qr_gold_turnover: number; qr_gold_rate: number; other_cards_turnover: number; other_cards_rate: number
  kaspi_red_turnover: number; kaspi_red_rate: number; kaspi_kredit_turnover: number; kaspi_kredit_rate: number
  payroll_amount: number; payroll_taxes_amount: number; income_tax_amount: number
  depreciation_amount: number; amortization_amount: number; other_operating_amount: number; notes: string | null
}
type Draft = Record<string, string>

const INPUT_TABS = [
  { id: 'revenue', label: 'Выручка и платежи' },
  { id: 'payroll', label: 'ФОТ и налоги' },
  { id: 'other', label: 'Прочее' },
] as const
type InputTab = typeof INPUT_TABS[number]['id']

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
  cash_revenue_override: String(row?.cash_revenue_override || ''), pos_revenue_override: String(row?.pos_revenue_override || ''),
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
  const [expenseCategories, setExpenseCategories] = useState<Record<string, FinancialGroup>>({})
  const [inputs, setInputs] = useState<Record<string, ProfitabilityInputRow>>({})
  const [kaspiDaily, setKaspiDaily] = useState<KaspiDailyPayload | null>(null)
  const [draft, setDraft] = useState<Draft>(draftFromRow())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [inputTab, setInputTab] = useState<InputTab>('revenue')
  const [whatIf, setWhatIf] = useState({ revenueAdj: 0, expenseAdj: 0 })
  const [showWhatIf, setShowWhatIf] = useState(false)

  const months = useMemo(() => buildMonths(monthFrom, monthTo), [monthFrom, monthTo])

  useEffect(() => {
    if (!months.includes(selectedMonth)) setSelectedMonth(months[months.length - 1] || monthTo)
  }, [months, monthTo, selectedMonth])

  useEffect(() => {
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const [incomeRes, expenseRes, categoriesRes, inputsRes] = await Promise.all([
          fetch(`/api/admin/incomes?from=${monthStart(monthFrom)}&to=${monthEnd(monthTo)}`),
          fetch(`/api/admin/expenses?from=${monthStart(monthFrom)}&to=${monthEnd(monthTo)}&page_size=2000`),
          fetch('/api/admin/expense-categories'),
          fetch(`/api/admin/profitability?from=${monthFrom}&to=${monthTo}&includeKaspiDaily=1`),
        ])
        if (!incomeRes.ok) throw new Error((await incomeRes.json().catch(() => null))?.error || 'Не удалось загрузить доходы')
        if (!expenseRes.ok) throw new Error((await expenseRes.json().catch(() => null))?.error || 'Не удалось загрузить расходы')
        if (!categoriesRes.ok) throw new Error((await categoriesRes.json().catch(() => null))?.error || 'Не удалось загрузить категории')
        if (!inputsRes.ok) throw new Error((await inputsRes.json().catch(() => null))?.error || 'Не удалось загрузить месячные вводы')
        const incomePayload = (await incomeRes.json()) as { data?: IncomeRow[] }
        const expensePayload = (await expenseRes.json()) as { data?: ExpenseRow[] }
        const categoriesPayload = (await categoriesRes.json()) as { data?: ExpenseCategoryRow[] }
        const payload = (await inputsRes.json()) as { items?: ProfitabilityInputRow[]; kaspiDaily?: KaspiDailyPayload }
        setIncomes((incomePayload.data || []) as IncomeRow[])
        setExpenses((expensePayload.data || []) as ExpenseRow[])
        setExpenseCategories(
          Object.fromEntries(
            (((categoriesPayload.data || []) as ExpenseCategoryRow[]).map((row) => [
              String(row.name || '').trim().toLowerCase(),
              resolveFinancialGroup(row.name, row.accounting_group),
            ])),
          ) as Record<string, FinancialGroup>,
        )
        setKaspiDaily(payload.kaspiDaily || null)
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

  const kaspiDailyMonthly = useMemo(() => kaspiDaily?.monthly || {}, [kaspiDaily])
  const kaspiDailyWarningsByMonth = useMemo(() => {
    const warnings = new Map<string, string[]>()
    for (const item of kaspiDaily?.days || []) {
      if (item.isPrecise) continue
      const key = item.date.slice(0, 7)
      const bucket = warnings.get(key) || []
      if (item.warning && !bucket.includes(item.warning)) bucket.push(item.warning)
      warnings.set(key, bucket)
    }
    return warnings
  }, [kaspiDaily])

  const rows = useMemo(() => months.map((month) => {
    const income = incomes.filter((row) => row.date.startsWith(month)).reduce((acc, row) => {
      const cash = Number(row.cash_amount || 0), kaspi = Number(row.kaspi_amount || 0), card = Number(row.card_amount || 0), online = Number(row.online_amount || 0)
      acc.rawRevenue += cash + kaspi + card + online
      acc.cash += cash
      acc.rawKaspi += kaspi
      acc.card += card
      acc.online += online
      acc.rawCashless += kaspi + card + online
      return acc
    }, { rawRevenue: 0, cash: 0, rawKaspi: 0, card: 0, online: 0, rawCashless: 0 })
    const journalSplit = expenses.filter((row) => row.date.startsWith(month)).reduce((acc, row) => {
      const amount = Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0)
      const normalizedCategory = String(row.category || '').trim().toLowerCase()
      const group = resolveFinancialGroup(row.category, expenseCategories[normalizedCategory] || null)

      acc.total += amount
      if (group === 'cogs') acc.cogs += amount
      else if (group === 'payroll' || group === 'payroll_advance') acc.payroll += amount
      else if (group === 'payroll_tax') acc.payrollTaxes += amount
      else if (group === 'income_tax') acc.incomeTax += amount
      else if (group === 'non_operating' || group === 'financial_expenses') acc.nonOperating += amount
      else if (group === 'depreciation') acc.depreciation += amount
      else if (group === 'capex') acc.capex += amount  // не входит в P&L, только справочно
      else acc.operating += amount

      return acc
    }, { total: 0, cogs: 0, operating: 0, payroll: 0, payrollTaxes: 0, incomeTax: 0, nonOperating: 0, depreciation: 0, capex: 0 })
    const manual = inputs[month]
    const correctedKaspi = Number(kaspiDailyMonthly[month] ?? income.rawKaspi)
    const journalRevenue = income.cash + correctedKaspi + income.card + income.online
    const journalCashlessRevenue = correctedKaspi + income.card + income.online
    const kaspiDailyAdjustment = correctedKaspi - income.rawKaspi
    const kaspiDailyWarnings = kaspiDailyWarningsByMonth.get(month) || []
    const cashRevenueOverride = Number(manual?.cash_revenue_override || 0)
    const posRevenueOverride = Number(manual?.pos_revenue_override || 0)
    const hasRevenueOverride = cashRevenueOverride > 0 || posRevenueOverride > 0
    const revenue = hasRevenueOverride ? cashRevenueOverride + posRevenueOverride : journalRevenue
    const cashRevenue = hasRevenueOverride ? cashRevenueOverride : income.cash
    const cashlessRevenue = hasRevenueOverride ? posRevenueOverride : journalCashlessRevenue
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
    const payrollManual = Number(manual?.payroll_amount || 0)
    const payrollTaxesManual = Number(manual?.payroll_taxes_amount || 0)
    const incomeTaxManual = Number(manual?.income_tax_amount || 0)
    const otherOperating = Number(manual?.other_operating_amount || 0)
    const depreciationManual = Number(manual?.depreciation_amount || 0)
    const amortization = Number(manual?.amortization_amount || 0)
    const depreciation = depreciationManual > 0 ? depreciationManual : journalSplit.depreciation
    const payroll = payrollManual > 0 ? payrollManual : journalSplit.payroll
    const payrollTaxes = payrollTaxesManual > 0 ? payrollTaxesManual : journalSplit.payrollTaxes
    const incomeTax = incomeTaxManual > 0 ? incomeTaxManual : journalSplit.incomeTax
    const cogs = journalSplit.cogs
    const grossProfit = revenue - cogs
    const journalOperatingExpenses = journalSplit.operating
    const nonOperatingJournalExpenses = journalSplit.nonOperating
    const ebitda = grossProfit - journalOperatingExpenses - posCommission - payroll - payrollTaxes - otherOperating
    const operatingProfit = ebitda - depreciation - amortization
    const netProfit = operatingProfit - nonOperatingJournalExpenses - incomeTax
    return {
      month,
      label: monthLabel(month),
      revenue,
      cashRevenue,
      cashlessRevenue,
      journalRevenue,
      journalCashRevenue: income.cash,
      journalCashlessRevenue,
      rawJournalRevenue: income.rawRevenue,
      rawJournalCashlessRevenue: income.rawCashless,
      rawKaspiRevenue: income.rawKaspi,
      correctedKaspiRevenue: correctedKaspi,
      kaspiDailyAdjustment,
      hasKaspiDailyAdjustment: Math.abs(kaspiDailyAdjustment) >= 0.01,
      hasKaspiDailyWarnings: kaspiDailyWarnings.length > 0,
      kaspiDailyWarnings,
      cashRevenueOverride,
      posRevenueOverride,
      hasRevenueOverride,
      cogs,
      grossProfit,
      journalExpenses: journalSplit.total,
      journalCogs: journalSplit.cogs,
      journalOperatingExpenses,
      journalPayrollExpenses: journalSplit.payroll,
      journalPayrollTaxes: journalSplit.payrollTaxes,
      journalIncomeTax: journalSplit.incomeTax,
      journalDepreciation: journalSplit.depreciation,
      journalCapex: journalSplit.capex,
      depreciationManual,
      nonOperatingJournalExpenses,
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
      payrollManual,
      payrollTaxes,
      payrollTaxesManual,
      otherOperating,
      ebitda,
      depreciation,
      amortization,
      operatingProfit,
      incomeTax,
      incomeTaxManual,
      netProfit,
      notes: manual?.notes || null,
    }
  }), [expenseCategories, expenses, incomes, inputs, kaspiDailyMonthly, kaspiDailyWarningsByMonth, months])

  const selected = useMemo(() => rows.find((row) => row.month === selectedMonth) || rows[rows.length - 1] || null, [rows, selectedMonth])
  const totals = useMemo(() => rows.reduce((acc, row) => ({ revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, grossProfit: acc.grossProfit + row.grossProfit, ebitda: acc.ebitda + row.ebitda, operatingProfit: acc.operatingProfit + row.operatingProfit, netProfit: acc.netProfit + row.netProfit }), { revenue: 0, cogs: 0, grossProfit: 0, ebitda: 0, operatingProfit: 0, netProfit: 0 }), [rows])
  const periodLabel = `${monthStart(monthFrom)} - ${monthEnd(monthTo)}`
  const draftPreview = useMemo(() => {
    if (!selected) return null

    const cashRevenueOverride = toNumber(draft.cash_revenue_override || '')
    const posRevenueOverride = toNumber(draft.pos_revenue_override || '')
    const hasRevenueOverride = cashRevenueOverride > 0 || posRevenueOverride > 0
    const revenue = hasRevenueOverride ? cashRevenueOverride + posRevenueOverride : selected.journalRevenue
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
    const payrollManual = toNumber(draft.payroll_amount || '')
    const payrollTaxesManual = toNumber(draft.payroll_taxes_amount || '')
    const incomeTaxManual = toNumber(draft.income_tax_amount || '')
    const depreciationManual = toNumber(draft.depreciation_amount || '')
    const depreciation = depreciationManual > 0 ? depreciationManual : selected.journalDepreciation
    const amortization = toNumber(draft.amortization_amount || '')
    const otherOperating = toNumber(draft.other_operating_amount || '')

    const posCommission =
      kaspiQrTurnover * kaspiQrRate / 100 +
      kaspiGoldTurnover * kaspiGoldRate / 100 +
      otherCardsTurnover * otherCardsRate / 100 +
      kaspiRedTurnover * kaspiRedRate / 100 +
      kaspiKreditTurnover * kaspiKreditRate / 100

    const payroll = payrollManual > 0 ? payrollManual : selected.journalPayrollExpenses
    const payrollTaxes = payrollTaxesManual > 0 ? payrollTaxesManual : selected.journalPayrollTaxes
    const incomeTax = incomeTaxManual > 0 ? incomeTaxManual : selected.journalIncomeTax
    const cogs = selected.cogs
    const grossProfit = revenue - cogs
    const ebitda = grossProfit - selected.journalOperatingExpenses - posCommission - payroll - payrollTaxes - otherOperating
    const operatingProfit = ebitda - depreciation - amortization
    const netProfit = operatingProfit - selected.nonOperatingJournalExpenses - incomeTax

    return {
      revenue,
      cogs,
      grossProfit,
      cashRevenue: hasRevenueOverride ? cashRevenueOverride : selected.journalCashRevenue,
      posRevenue: hasRevenueOverride ? posRevenueOverride : selected.journalCashlessRevenue,
      hasRevenueOverride,
      posCommission,
      payroll,
      payrollTaxes,
      incomeTax,
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
    <>
        <div className="app-page max-w-7xl space-y-6">
          <Card className="border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 via-slate-950/90 to-gray-950 p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3"><Landmark className="h-7 w-7 text-emerald-300" /></div>
                <div>
                  <h1 className="text-3xl font-semibold text-white">ОПиУ и EBITDA</h1>
                  <p className="text-sm text-slate-300">По умолчанию выручка берётся из журнала доходов. При необходимости вы можете вручную задать общую выручку по POS и общую наличку за месяц, а ниже внести комиссии и корректировки прибыли.</p>
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
            <Card className="border border-white/10 bg-white/[0.03] p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">Выручка за период</p><p className="mt-2 text-2xl font-semibold text-white">{money(totals.revenue)}</p><p className="mt-1 text-xs text-slate-500">С учётом ручных верхних вводов, если они заполнены</p></div><TrendingUp className="h-5 w-5 text-emerald-300" /></div></Card>
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
                <p className="mt-2 text-sm text-slate-300">По умолчанию это доходы из журнала: наличные, Kaspi POS, online и карта. Если вы сверху заполнили общую выручку по POS и общую наличку, страница возьмёт именно их как базу месяца.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">Что теперь идёт из журнала автоматически</div>
                <p className="mt-2 text-sm text-slate-300">Если у категории расхода задана финансовая группа, страница сама разносит журнал на операционные расходы, ФОТ, налоги на зарплату и налог 3%. Ручные поля ниже нужны только если надо переопределить или дополнить журнал.</p>
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
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="text-xs uppercase tracking-wide text-slate-500">EBITDA</div><div className="mt-2 text-xl font-semibold text-white">{money(selected.ebitda)}</div><div className="mt-1 text-xs text-slate-400">{pct(ebitdaMargin)}</div></Card>
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="text-xs uppercase tracking-wide text-slate-500">Опер. прибыль</div><div className="mt-2 text-xl font-semibold text-white">{money(selected.operatingProfit)}</div><div className="mt-1 text-xs text-slate-400">{selected.label}</div></Card>
                    <Card className="border border-white/10 bg-slate-950/60 p-4"><div className="text-xs uppercase tracking-wide text-slate-500">Чистая прибыль</div><div className="mt-2 text-xl font-semibold text-white">{money(selected.netProfit)}</div><div className="mt-1 text-xs text-slate-400">{pct(netMargin)}</div></Card>
                    {selected.journalCapex > 0 && <Card className="border border-amber-500/20 bg-amber-500/5 p-4"><div className="text-xs uppercase tracking-wide text-amber-500">FCF (после CAPEX)</div><div className={`mt-2 text-xl font-semibold ${(selected.netProfit - selected.journalCapex) >= 0 ? 'text-amber-300' : 'text-rose-300'}`}>{money(selected.netProfit - selected.journalCapex)}</div><div className="mt-1 text-xs text-amber-600">CAPEX {money(selected.journalCapex)}</div></Card>}
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-white/10">
                    <table className="w-full text-sm"><tbody>
                      {[
                        ['Выручка', selected.revenue],
                        ...(selected.cogs > 0 ? [['COGS (Себестоимость)', -selected.cogs], ['Валовая прибыль', selected.grossProfit]] : []),
                        ['Операционные расходы из журнала', -selected.journalOperatingExpenses],
                        ['Комиссия Kaspi POS', -selected.posCommission],
                        ['Фонд оплаты труда', -selected.payroll],
                        ['Налоги на зарплату', -selected.payrollTaxes],
                        ['Прочие операционные', -selected.otherOperating],
                        ['EBITDA', selected.ebitda],
                        ['Износ', -selected.depreciation],
                        ['Амортизация', -selected.amortization],
                        ['Операционная прибыль', selected.operatingProfit],
                        ['Неоперационные расходы из журнала', -selected.nonOperatingJournalExpenses],
                        ['Налог на прибыль / 3%', -selected.incomeTax],
                        ['Чистая прибыль', selected.netProfit],
                      ].map(([label, value]) => <tr key={String(label)} className="border-b border-white/5 last:border-b-0"><td className="px-4 py-3 text-slate-300">{label}</td><td className={`px-4 py-3 text-right font-medium ${(Number(value) >= 0) ? 'text-emerald-300' : 'text-rose-300'}`}>{money(Number(value))}</td></tr>)}
                      {selected.journalCapex > 0 && <>
                        <tr className="border-t-2 border-amber-500/20"><td colSpan={2} className="px-4 py-2 text-xs uppercase tracking-wide text-amber-500/70">Справочно — инвестиции (не в P&L)</td></tr>
                        <tr className="border-b border-white/5"><td className="px-4 py-3 text-slate-400">CAPEX (покупка активов)</td><td className="px-4 py-3 text-right font-medium text-amber-400">−{money(selected.journalCapex)}</td></tr>
                        <tr><td className="px-4 py-3 text-slate-300">FCF (свободный денежный поток)</td><td className={`px-4 py-3 text-right font-semibold ${(selected.netProfit - selected.journalCapex) >= 0 ? 'text-amber-300' : 'text-rose-300'}`}>{money(selected.netProfit - selected.journalCapex)}</td></tr>
                      </>}
                    </tbody></table>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Card className="border border-white/10 bg-slate-950/60 p-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white"><CreditCard className="h-4 w-4 text-emerald-300" />POS и безнал</div>
                      <div className="space-y-2 text-sm text-slate-300">
                        <div className="flex justify-between"><span>Общая наличка</span><span>{money(selected.cashRevenue)}</span></div>
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
                    <Card className="border border-white/10 bg-slate-950/60 p-4">
                      <div className="mb-2 text-sm font-medium text-white">Автоматическая раскладка журнала</div>
                      <div className="space-y-2 text-sm text-slate-300">
                        <div className="flex justify-between"><span>Операционные</span><span>{money(selected.journalOperatingExpenses)}</span></div>
                        <div className="flex justify-between"><span>ФОТ</span><span>{money(selected.journalPayrollExpenses)}</span></div>
                        <div className="flex justify-between"><span>Налоги на зарплату</span><span>{money(selected.journalPayrollTaxes)}</span></div>
                        <div className="flex justify-between"><span>Налог 3% / прибыль</span><span>{money(selected.journalIncomeTax)}</span></div>
                        <div className="flex justify-between"><span>Финансовые расходы</span><span>{money(selected.nonOperatingJournalExpenses)}</span></div>
                        {selected.journalDepreciation > 0 ? <div className="flex justify-between"><span>Амортизация (авто){selected.depreciationManual > 0 ? <span className="ml-1 text-xs text-amber-300">перекрыто вручную</span> : null}</span><span>{money(selected.journalDepreciation)}</span></div> : null}
                        {selected.journalCapex > 0 ? <div className="flex justify-between text-slate-400"><span>CAPEX (справочно, не в P&L)</span><span>{money(selected.journalCapex)}</span></div> : null}
                        <div className="border-t border-white/10 pt-2 text-xs text-slate-400">
                          Общая сумма журнала: {money(selected.journalExpenses)}
                        </div>
                        <div className="border-t border-white/10 pt-2">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Комментарий месяца</div>
                          <div className="mt-1 text-sm text-slate-300">
                            {selected.notes || 'Комментарий не заполнен. Здесь можно фиксировать изменения по ставкам Kaspi и ручные допущения месяца.'}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                  {selected.hasRevenueOverride ? <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">Для этого месяца выручка считается от ручных верхних вводов: наличка {money(selected.cashRevenueOverride)} и POS {money(selected.posRevenueOverride)}. Если очистить эти поля и сохранить, страница снова возьмёт выручку из журнала доходов.</div> : null}
                  {selected.hasKaspiDailyAdjustment && !selected.hasRevenueOverride ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">Kaspi за этот месяц взят по календарным суткам. Коррекция относительно обычной сменной суммы: {selected.kaspiDailyAdjustment > 0 ? '+' : ''}{money(selected.kaspiDailyAdjustment)}. В журнале по сменам было {money(selected.rawKaspiRevenue)}, после суточной сверки в ОПиУ попало {money(selected.correctedKaspiRevenue)}.</div> : null}
                  {selected.hasKaspiDailyWarnings && !selected.hasRevenueOverride ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">Для части ночных смен в этом месяце нет разделения Kaspi до и после полуночи, поэтому суточная сверка может быть неполной.</div> : null}
                  {selected.legacyQrGoldTurnover > 0 ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">Для этого месяца найдены старые объединённые данные QR/Gold. Лучше переписать их отдельно в полях Kaspi QR и Kaspi Gold, чтобы комиссия считалась точнее.</div> : null}
                </div>
              ) : null}
            </Card>

            <Card className="border border-white/10 bg-white/[0.03] p-6">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-white">Ручные месячные вводы</h2>
                <p className="text-sm text-slate-400">Сначала при необходимости задайте общую выручку по POS и общую наличку за месяц. Ниже внесите комиссии и только те суммы, которые должны переопределить или дополнить автоматическую раскладку журнала.</p>
              </div>
              <div className="mt-6 space-y-4">
                {/* Input Tabs */}
                <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                  {INPUT_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setInputTab(tab.id)}
                      className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all ${inputTab === tab.id ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab: Выручка и платежи */}
                {inputTab === 'revenue' && (
                  <>
                    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-white">Общая наличная выручка за месяц</label>
                        <Input type="number" min="0" step="100" value={draft.cash_revenue_override} onChange={(e) => setDraft((prev) => ({ ...prev, cash_revenue_override: e.target.value }))} placeholder="Если пусто, возьмём из журнала доходов" className="border-white/10 bg-slate-950/70 text-white" />
                        <div className="text-xs text-cyan-100/80">Это вся наличка месяца. Поле необязательно.</div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-white">Общая выручка по POS за месяц</label>
                        <Input type="number" min="0" step="100" value={draft.pos_revenue_override} onChange={(e) => setDraft((prev) => ({ ...prev, pos_revenue_override: e.target.value }))} placeholder="Если пусто, возьмём безнал из журнала доходов" className="border-white/10 bg-slate-950/70 text-white" />
                        <div className="text-xs text-cyan-100/80">Это общая сумма по терминалу и Kaspi-сервисам за месяц. Поле необязательно.</div>
                      </div>
                      <div className="text-xs text-cyan-100/80 md:col-span-2">
                        Если заполнили хотя бы одно из этих двух полей, страница возьмёт выручку месяца из них: <span className="font-medium text-white">наличка + POS</span>. Если оба поля пустые, база останется из журнала доходов.
                      </div>
                    </div>
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
                  </>
                )}

                {/* Tab: ФОТ и налоги */}
                {inputTab === 'payroll' && (
                  <>
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                      <div className="font-medium text-white">Как теперь работают ФОТ и налоги</div>
                      <div className="mt-2 space-y-1">
                        <div>Если категория расхода привязана к финансовой группе, страница сама подтянет ФОТ и налоги из журнала.</div>
                        <div>Ручные поля ниже нужны только если вы хотите переопределить сумму из журнала для конкретного месяца.</div>
                      </div>
                    </div>
                    {[
                      ['payroll_amount', 'ФОТ вручную (если нужно переопределить журнал)'],
                      ['payroll_taxes_amount', 'Налоги на зарплату вручную'],
                      ['income_tax_amount', 'Налог на прибыль / 3% вручную'],
                    ].map(([key, label]) => (
                      <div key={String(key)} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px] md:items-center">
                        <label className="text-sm text-white">{label}</label>
                        <Input type="number" min="0" step="100" value={draft[key]} onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))} placeholder="0" className="border-white/10 bg-slate-950/70 text-white" />
                      </div>
                    ))}
                  </>
                )}

                {/* Tab: Прочее */}
                {inputTab === 'other' && (
                  <>
                    {[
                      ['depreciation_amount', 'Износ'],
                      ['amortization_amount', 'Амортизация'],
                      ['other_operating_amount', 'Прочие операционные'],
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
                  </>
                )}
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
                          <div className="flex justify-between"><span>Выручка</span><span>{money(selected.revenue)}</span></div>
                          <div className="flex justify-between"><span>Наличка</span><span>{money(selected.cashRevenue)}</span></div>
                          <div className="flex justify-between"><span>POS / безнал</span><span>{money(selected.cashlessRevenue)}</span></div>
                          <div className="flex justify-between"><span>Опер. журнал</span><span>{money(selected.journalOperatingExpenses)}</span></div>
                          <div className="flex justify-between"><span>ФОТ</span><span>{money(selected.payroll)}</span></div>
                          <div className="flex justify-between"><span>Комиссия POS</span><span>{money(selected.posCommission)}</span></div>
                          <div className="flex justify-between"><span>EBITDA</span><span>{money(selected.ebitda)}</span></div>
                          <div className="flex justify-between"><span>Опер. прибыль</span><span>{money(selected.operatingProfit)}</span></div>
                          <div className="flex justify-between font-medium text-white"><span>Чистая прибыль</span><span>{money(selected.netProfit)}</span></div>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-emerald-500/20 bg-slate-950/60 p-4">
                        <div className="mb-2 text-xs uppercase tracking-wide text-emerald-300">Будет после сохранения</div>
                        <div className="space-y-2 text-sm text-slate-200">
                          <div className="flex justify-between"><span>Выручка</span><span>{money(draftPreview.revenue)}</span></div>
                          <div className="flex justify-between"><span>Наличка</span><span>{money(draftPreview.cashRevenue)}</span></div>
                          <div className="flex justify-between"><span>POS / безнал</span><span>{money(draftPreview.posRevenue)}</span></div>
                          <div className="flex justify-between"><span>Опер. журнал</span><span>{money(selected.journalOperatingExpenses)}</span></div>
                          <div className="flex justify-between"><span>ФОТ</span><span>{money(draftPreview.payroll)}</span></div>
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

                {/* What-if section */}
                <div className="rounded-2xl border border-white/10 bg-slate-950/60">
                  <button
                    onClick={() => setShowWhatIf((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-white"
                  >
                    <span className="flex items-center gap-2"><BarChart2 className="w-4 h-4" />What-if моделирование</span>
                    <span className="text-slate-400">{showWhatIf ? '▲' : '▼'}</span>
                  </button>
                  {showWhatIf && selected && (
                    <div className="border-t border-white/10 px-4 pb-4 pt-3 space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <label className="text-slate-300">Изменение выручки ±%</label>
                          <span className={`font-medium tabular-nums ${whatIf.revenueAdj > 0 ? 'text-emerald-300' : whatIf.revenueAdj < 0 ? 'text-rose-300' : 'text-slate-400'}`}>{whatIf.revenueAdj > 0 ? '+' : ''}{whatIf.revenueAdj}%</span>
                        </div>
                        <input type="range" min={-50} max={50} step={1} value={whatIf.revenueAdj} onChange={(e) => setWhatIf((prev) => ({ ...prev, revenueAdj: Number(e.target.value) }))} className="w-full accent-emerald-500" />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <label className="text-slate-300">Изменение расходов ±%</label>
                          <span className={`font-medium tabular-nums ${whatIf.expenseAdj > 0 ? 'text-rose-300' : whatIf.expenseAdj < 0 ? 'text-emerald-300' : 'text-slate-400'}`}>{whatIf.expenseAdj > 0 ? '+' : ''}{whatIf.expenseAdj}%</span>
                        </div>
                        <input type="range" min={-50} max={50} step={1} value={whatIf.expenseAdj} onChange={(e) => setWhatIf((prev) => ({ ...prev, expenseAdj: Number(e.target.value) }))} className="w-full accent-rose-500" />
                      </div>
                      {(() => {
                        const base = selected
                        const adjRevenue = base.revenue * (1 + whatIf.revenueAdj / 100)
                        const expMultiplier = 1 + whatIf.expenseAdj / 100
                        const adjOperating = base.journalOperatingExpenses * expMultiplier
                        const adjPayroll = base.payroll * expMultiplier
                        const adjPayrollTaxes = base.payrollTaxes * expMultiplier
                        const adjOtherOp = base.otherOperating * expMultiplier
                        const adjEbitda = adjRevenue - adjOperating - base.posCommission - adjPayroll - adjPayrollTaxes - adjOtherOp
                        const adjOperatingProfit = adjEbitda - base.depreciation - base.amortization
                        const adjNetProfit = adjOperatingProfit - base.nonOperatingJournalExpenses - base.incomeTax
                        return (
                          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 space-y-2 text-sm">
                            <div className="text-xs uppercase tracking-wide text-emerald-300 font-medium">Прогнозные результаты</div>
                            <div className="flex justify-between"><span className="text-slate-300">Выручка</span><span className="font-medium text-white">{money(adjRevenue)}</span></div>
                            <div className="flex justify-between"><span className="text-slate-300">EBITDA</span><span className={`font-medium ${adjEbitda >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(adjEbitda)}</span></div>
                            <div className="flex justify-between"><span className="text-slate-300">Чистая прибыль</span><span className={`font-semibold ${adjNetProfit >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{money(adjNetProfit)}</span></div>
                            <div className="border-t border-white/10 pt-2 text-xs text-slate-400">
                              vs факт: EBITDA {adjEbitda - base.ebitda >= 0 ? '+' : ''}{money(adjEbitda - base.ebitda)}, чистая {adjNetProfit - base.netProfit >= 0 ? '+' : ''}{money(adjNetProfit - base.netProfit)}
                            </div>
                          </div>
                        )
                      })()}
                      <button onClick={() => setWhatIf({ revenueAdj: 0, expenseAdj: 0 })} className="text-xs text-slate-400 hover:text-white">Сбросить</button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <Card className="border border-white/10 bg-white/[0.03] p-6">
            <div className="mb-4"><h2 className="text-xl font-semibold text-white">Помесячная таблица прибыли</h2><p className="text-sm text-slate-400">Факт из системы объединён с ручными месячными вводами по комиссиям и корректировкам.</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-400"><th className="px-3 py-3">Месяц</th><th className="px-3 py-3 text-right">Выручка</th>{rows.some(r => r.cogs > 0) && <><th className="px-3 py-3 text-right text-orange-400">COGS</th><th className="px-3 py-3 text-right text-orange-300">Вал. прибыль</th></>}<th className="px-3 py-3 text-right">Опер. журнал</th><th className="px-3 py-3 text-right">POS</th><th className="px-3 py-3 text-right">EBITDA</th><th className="px-3 py-3 text-right">Опер. прибыль</th><th className="px-3 py-3 text-right">Чистая прибыль</th><th className="px-3 py-3 text-right text-slate-500">vs пред. месяц</th></tr></thead>
                <tbody>{rows.map((row) => {
                  const prevMonth = shiftMonth(row.month, -1)
                  const prevRow = rows.find((r) => r.month === prevMonth)
                  const deltaNetProfit = prevRow ? row.netProfit - prevRow.netProfit : null
                  const deltaEbitda = prevRow ? row.ebitda - prevRow.ebitda : null
                  const deltaPct = (prevRow && prevRow.netProfit !== 0) ? ((row.netProfit - prevRow.netProfit) / Math.abs(prevRow.netProfit)) * 100 : null
                  const hasCogs = rows.some(r => r.cogs > 0)
                  return (
                    <tr key={row.month} onClick={() => setSelectedMonth(row.month)} className={`cursor-pointer border-b border-white/5 text-slate-200 transition hover:bg-white/[0.05] ${row.month === selectedMonth ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/20' : ''}`}>
                      <td className="px-3 py-3 font-medium">{row.label}{row.month === selectedMonth ? <span className="ml-2 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">выбран</span> : null}</td>
                      <td className="px-3 py-3 text-right">{money(row.revenue)}</td>
                      {hasCogs && <><td className="px-3 py-3 text-right text-orange-300">{row.cogs > 0 ? money(row.cogs) : '—'}</td><td className={`px-3 py-3 text-right font-medium ${row.grossProfit >= 0 ? 'text-orange-200' : 'text-rose-300'}`}>{money(row.grossProfit)}</td></>}
                      <td className="px-3 py-3 text-right">{money(row.journalOperatingExpenses)}</td>
                      <td className="px-3 py-3 text-right">{money(row.posCommission)}</td>
                      <td className={`px-3 py-3 text-right font-medium ${row.ebitda >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(row.ebitda)}</td>
                      <td className={`px-3 py-3 text-right font-medium ${row.operatingProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(row.operatingProfit)}</td>
                      <td className={`px-3 py-3 text-right font-semibold ${row.netProfit >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{money(row.netProfit)}</td>
                      <td className="px-3 py-3 text-right">
                        {deltaNetProfit !== null ? (
                          <div className={`flex items-center justify-end gap-0.5 text-xs font-medium ${deltaNetProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {deltaNetProfit >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                            {deltaNetProfit >= 0 ? '+' : ''}{money(deltaNetProfit)}
                            {deltaPct !== null ? <span className="ml-1 text-slate-400">({deltaPct >= 0 ? '↑' : '↓'}{Math.abs(deltaPct).toFixed(1)}%)</span> : null}
                          </div>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          </Card>
        </div>
    </>
  )
}
