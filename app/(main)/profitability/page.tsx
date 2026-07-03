'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { useCompanies } from '@/hooks/use-companies'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'
import { ArrowDown, ArrowUp, BarChart2, Calculator, CalendarDays, ChevronDown, ChevronUp, Download, Info, Landmark, Lightbulb, Save, Settings2, Sparkles, Target, TrendingUp, Wallet } from 'lucide-react'

type IncomeRow = { date: string; company_id: string; cash_amount: number | null; kaspi_amount: number | null; card_amount: number | null; online_amount: number | null }
type ExpenseRow = { date: string; company_id: string; category: string | null; cash_amount: number | null; kaspi_amount: number | null }
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
  const cashLabels = useCashlessLabels()
  const { can } = useCapabilities()
  const canEdit = can('profitability.edit')
  const { companies } = useCompanies()

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
  const [tab, setTab] = useState<'overview' | 'monthly' | 'points' | 'reports' | 'settings'>('overview')

  const months = useMemo(() => buildMonths(monthFrom, monthTo), [monthFrom, monthTo])

  useEffect(() => {
    if (!months.includes(selectedMonth)) setSelectedMonth(months[months.length - 1] || monthTo)
  }, [months, monthTo, selectedMonth])

  useEffect(() => {
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const incBase = `/api/admin/incomes?from=${monthStart(monthFrom)}&to=${monthEnd(monthTo)}`
        const expBase = `/api/admin/expenses?from=${monthStart(monthFrom)}&to=${monthEnd(monthTo)}`
        // db-max-rows режет до 1000 строк за запрос — поэтому догружаем ВСЕ страницы,
        // иначе при большом периоде расчёт идёт по неполным данным.
        const fetchAllPages = async (base: string): Promise<any[]> => {
          const all: any[] = []
          let page = 0
          while (true) {
            const res = await fetch(`${base}&page=${page}&page_size=1000`)
            if (!res.ok) {
              const body = await res.json().catch(() => ({}))
              throw new Error(body?.error || `Загрузка не удалась (HTTP ${res.status})`)
            }
            const body = await res.json()
            const chunk = (body.data || []) as any[]
            all.push(...chunk)
            if (chunk.length < 1000) break
            page += 1
          }
          return all
        }
        const [incomesAll, expensesAll, categoriesRes, inputsRes] = await Promise.all([
          fetchAllPages(incBase),
          fetchAllPages(expBase),
          fetch('/api/admin/expense-categories'),
          fetch(`/api/admin/profitability?from=${monthFrom}&to=${monthTo}&includeKaspiDaily=1`),
        ])
        if (!categoriesRes.ok) throw new Error(`Категории: HTTP ${categoriesRes.status}`)
        if (!inputsRes.ok) throw new Error(`Профит-инпуты: HTTP ${inputsRes.status}`)
        const categoriesPayload = (await categoriesRes.json()) as { data?: ExpenseCategoryRow[] }
        const payload = (await inputsRes.json()) as { items?: ProfitabilityInputRow[]; kaspiDaily?: KaspiDailyPayload }
        setIncomes(incomesAll as IncomeRow[])
        setExpenses(expensesAll as ExpenseRow[])
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
      else if (group === 'pos_commission') acc.posCommissionJournal += amount
      else if (group === 'payroll' || group === 'payroll_advance') acc.payroll += amount
      else if (group === 'payroll_tax') acc.payrollTaxes += amount
      else if (group === 'income_tax') acc.incomeTax += amount
      else if (group === 'financial_expenses') acc.financial += amount
      else if (group === 'non_operating') acc.nonOperating += amount
      else if (group === 'depreciation') acc.depreciation += amount
      else if (group === 'capex') acc.capex += amount  // не входит в P&L, только справочно
      else if (group === 'profit_distribution') acc.profitDistribution += amount  // вне P&L, после чистой прибыли
      else acc.operating += amount

      return acc
    }, { total: 0, cogs: 0, operating: 0, posCommissionJournal: 0, payroll: 0, payrollTaxes: 0, incomeTax: 0, financial: 0, nonOperating: 0, depreciation: 0, capex: 0, profitDistribution: 0 })
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
    const journalPosCommission = journalSplit.posCommissionJournal
    // Антидвойной-счёт: если заполнили оборот POS вручную — берём ручную комиссию, иначе из журнала
    const effectivePosCommission = posCommission > 0 ? posCommission : journalPosCommission
    const financialExpensesJournal = journalSplit.financial
    const nonOperatingJournalExpenses = journalSplit.nonOperating
    const profitDistributionJournal = journalSplit.profitDistribution
    const ebitda = grossProfit - journalOperatingExpenses - effectivePosCommission - payroll - payrollTaxes - otherOperating
    const operatingProfit = ebitda - depreciation - amortization
    // EBIT - финансовые расходы = EBT, EBT - налог = чистая. Неоперационные после неё.
    const ebt = operatingProfit - financialExpensesJournal
    const netProfit = ebt - incomeTax - nonOperatingJournalExpenses
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
      posCommission: effectivePosCommission,
      manualPosCommission: posCommission,
      journalPosCommission,
      financialExpensesJournal,
      profitDistributionJournal,
      ebt,
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
    // Та же антидвойной-счёт логика: ручная комиссия из POS-блока перекрывает журнальную
    const effectivePosCommission = posCommission > 0 ? posCommission : selected.journalPosCommission
    const ebitda = grossProfit - selected.journalOperatingExpenses - effectivePosCommission - payroll - payrollTaxes - otherOperating
    const operatingProfit = ebitda - depreciation - amortization
    const ebt = operatingProfit - selected.financialExpensesJournal
    const netProfit = ebt - incomeTax - selected.nonOperatingJournalExpenses

    return {
      revenue,
      cogs,
      grossProfit,
      cashRevenue: hasRevenueOverride ? cashRevenueOverride : selected.journalCashRevenue,
      posRevenue: hasRevenueOverride ? posRevenueOverride : selected.journalCashlessRevenue,
      hasRevenueOverride,
      posCommission: effectivePosCommission,
      payroll,
      payrollTaxes,
      incomeTax,
      otherOperating,
      ebitda,
      operatingProfit,
      ebt,
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

  // Сравнение с прошлым месяцем (для дельт ↑↓)
  const prevSelected = useMemo(() => {
    if (!selected) return null
    const prevKey = shiftMonth(selected.month, -1)
    return rows.find((r) => r.month === prevKey) || null
  }, [selected, rows])

  const delta = (curr: number, prev: number) => {
    if (!prev) return null
    return ((curr - prev) / Math.abs(prev)) * 100
  }

  // ───── Разрез ОПиУ по точкам (для выбранного месяца) ─────────────────────────
  // Журнальные расходы по company_id берём напрямую; ручные оверрайды (POS-
  // комиссия, ФОТ, налоги, амортизация, прочее) разносим пропорционально доле
  // выручки точки в общей выручке месяца.
  const byCompany = useMemo(() => {
    if (!selected) return [] as Array<any>
    type Agg = {
      company_id: string; name: string
      revenue: number; cashRevenue: number; cashlessRevenue: number
      cogs: number; operating: number
      posComJ: number; payrollJ: number; payrollTaxJ: number; incomeTaxJ: number
      depreciationJ: number; financialJ: number; nonOpJ: number
    }
    const aggs = new Map<string, Agg>()
    for (const c of companies) {
      aggs.set(String(c.id), {
        company_id: String(c.id), name: c.name,
        revenue: 0, cashRevenue: 0, cashlessRevenue: 0,
        cogs: 0, operating: 0,
        posComJ: 0, payrollJ: 0, payrollTaxJ: 0, incomeTaxJ: 0,
        depreciationJ: 0, financialJ: 0, nonOpJ: 0,
      })
    }
    for (const row of incomes) {
      if (!row.date.startsWith(selected.month)) continue
      const a = aggs.get(String(row.company_id || ''))
      if (!a) continue
      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const online = Number(row.online_amount || 0)
      const card = Number(row.card_amount || 0)
      a.cashRevenue += cash
      a.cashlessRevenue += kaspi + online + card
      a.revenue += cash + kaspi + online + card
    }
    for (const row of expenses) {
      if (!row.date.startsWith(selected.month)) continue
      const a = aggs.get(String(row.company_id || ''))
      if (!a) continue
      const amount = Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0)
      const norm = String(row.category || '').trim().toLowerCase()
      const group = resolveFinancialGroup(row.category, expenseCategories[norm] || null)
      if (group === 'cogs') a.cogs += amount
      else if (group === 'pos_commission') a.posComJ += amount
      else if (group === 'payroll' || group === 'payroll_advance') a.payrollJ += amount
      else if (group === 'payroll_tax') a.payrollTaxJ += amount
      else if (group === 'income_tax') a.incomeTaxJ += amount
      else if (group === 'financial_expenses') a.financialJ += amount
      else if (group === 'non_operating') a.nonOpJ += amount
      else if (group === 'depreciation') a.depreciationJ += amount
      else if (group === 'capex' || group === 'profit_distribution') { /* вне P&L */ }
      else a.operating += amount
    }
    const sumRevenue = Array.from(aggs.values()).reduce((s, a) => s + a.revenue, 0)
    // Манульные оверрайды: если значение совокупное (selected.X) больше «журнального» — это override.
    // Для каждого компонента используем effective из selected; если он отличается от sum по точкам — разносим разницу пропорционально.
    const usePosManual = selected.manualPosCommission > 0
    const usePayrollManual = selected.payrollManual > 0
    const usePayrollTaxManual = selected.payrollTaxesManual > 0
    const useIncomeTaxManual = selected.incomeTaxManual > 0
    const useDepreciationManual = selected.depreciationManual > 0
    return Array.from(aggs.values())
      .filter((a) => a.revenue > 0 || a.cogs > 0 || a.operating > 0 || a.payrollJ > 0)
      .map((a) => {
        const share = sumRevenue > 0 ? a.revenue / sumRevenue : 0
        // Амортизация и «прочее операционное» — только из manual, разносим целиком по share
        const amortization = Number(selected.amortization || 0) * share
        const otherOperating = Number(selected.otherOperating || 0) * share
        // Остальное: либо manual×share, либо журнал на точке
        const posCom = usePosManual ? Number(selected.posCommission || 0) * share : a.posComJ
        const payroll = usePayrollManual ? Number(selected.payroll || 0) * share : a.payrollJ
        const payrollTaxes = usePayrollTaxManual ? Number(selected.payrollTaxes || 0) * share : a.payrollTaxJ
        const incomeTax = useIncomeTaxManual ? Number(selected.incomeTax || 0) * share : a.incomeTaxJ
        const depreciation = useDepreciationManual ? Number(selected.depreciation || 0) * share : a.depreciationJ
        const cogs = a.cogs
        const grossProfit = a.revenue - cogs
        const ebitda = grossProfit - a.operating - posCom - payroll - payrollTaxes - otherOperating
        const operatingProfit = ebitda - depreciation - amortization
        const ebt = operatingProfit - a.financialJ
        const netProfit = ebt - incomeTax - a.nonOpJ
        const margin = a.revenue > 0 ? (netProfit / a.revenue) * 100 : 0
        const ebitdaMarginCo = a.revenue > 0 ? (ebitda / a.revenue) * 100 : 0
        return {
          company_id: a.company_id,
          name: a.name,
          share,
          revenue: a.revenue, cashRevenue: a.cashRevenue, cashlessRevenue: a.cashlessRevenue,
          cogs, operating: a.operating, posCom, payroll, payrollTaxes, otherOperating,
          ebitda, ebitdaMargin: ebitdaMarginCo,
          depreciation, amortization, operatingProfit,
          financialExpenses: a.financialJ, ebt,
          incomeTax, nonOperating: a.nonOpJ, netProfit, margin,
        }
      })
      .sort((a, b) => b.netProfit - a.netProfit)
  }, [selected, companies, incomes, expenses, expenseCategories])

  // Топ-5 категорий расходов выбранного месяца
  const topCategoriesSelected = useMemo(() => {
    if (!selected) return []
    const byCategory = new Map<string, { total: number; group: FinancialGroup }>()
    for (const row of expenses) {
      if (!row.date.startsWith(selected.month)) continue
      const cat = (row.category || '—').trim()
      const amount = Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0)
      const normalized = cat.toLowerCase()
      const group = resolveFinancialGroup(cat, expenseCategories[normalized] || null)
      const prev = byCategory.get(cat) || { total: 0, group }
      byCategory.set(cat, { total: prev.total + amount, group: prev.group })
    }
    return Array.from(byCategory.entries())
      .map(([name, info]) => ({ name, total: info.total, group: info.group }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [selected, expenses, expenseCategories])

  // Авто-инсайт: что больше всего повлияло на изменение прибыли vs прошлый месяц
  const insightText = useMemo(() => {
    if (!selected || !prevSelected) return null
    const deltaNet = selected.netProfit - prevSelected.netProfit
    if (Math.abs(deltaNet) < 1000) return `Чистая прибыль практически без изменений vs ${prevSelected.label}.`
    const factors: Array<{ label: string; diff: number }> = [
      { label: 'выручка', diff: selected.revenue - prevSelected.revenue },
      { label: 'COGS', diff: -(selected.cogs - prevSelected.cogs) },
      { label: 'операционные', diff: -(selected.journalOperatingExpenses - prevSelected.journalOperatingExpenses) },
      { label: 'ФОТ', diff: -(selected.payroll - prevSelected.payroll) },
      { label: 'комиссия POS', diff: -(selected.posCommission - prevSelected.posCommission) },
    ]
    const top = factors.filter((f) => Math.abs(f.diff) >= 50000).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 2)
    if (!top.length) return null
    const dir = deltaNet >= 0 ? 'выросла' : 'упала'
    const parts = top.map((f) => `${f.label} ${f.diff >= 0 ? '+' : ''}${money(f.diff)}`).join(', ')
    return `Чистая прибыль ${dir} на ${money(Math.abs(deltaNet))} (${parts}).`
  }, [selected, prevSelected])

  const [showManualInputs, setShowManualInputs] = useState(false)
  const [investorCompanyId, setInvestorCompanyId] = useState<string>('')
  const [investorExporting, setInvestorExporting] = useState(false)
  const [allPointsExporting, setAllPointsExporting] = useState(false)
  const [branchReportCompanyId, setBranchReportCompanyId] = useState<string>('')
  const [branchReportPartners, setBranchReportPartners] = useState<Array<{ name: string; percent: string }>>([])
  const [branchReportIncludeCapex, setBranchReportIncludeCapex] = useState(true)
  const [branchReportFrom, setBranchReportFrom] = useState<string>('')
  const [branchReportTo, setBranchReportTo] = useState<string>('')
  const [branchPayrollStaffOverride, setBranchPayrollStaffOverride] = useState<string>('')
  const [branchPayrollOpsOverride, setBranchPayrollOpsOverride] = useState<string>('')
  const [branchNote, setBranchNote] = useState<string>('')
  const [branchPdfDownloading, setBranchPdfDownloading] = useState(false)

  // Сохраняем комментарий в localStorage чтобы между визитами не вводить заново.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('profitability-branch-note')
      if (saved) setBranchNote(saved)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try {
      if (branchNote) localStorage.setItem('profitability-branch-note', branchNote)
      else localStorage.removeItem('profitability-branch-note')
    } catch { /* ignore */ }
  }, [branchNote])

  const buildBranchReportParams = () => {
    const cleanPartners = branchReportPartners
      .map((p) => ({ name: p.name.trim(), percent: Number(p.percent) || 0 }))
      .filter((p) => p.name && p.percent > 0)
    const params = new URLSearchParams({
      company_id: branchReportCompanyId,
      from: branchReportFrom,
      to: branchReportTo,
      capex: branchReportIncludeCapex ? '1' : '0',
    })
    if (cleanPartners.length > 0) {
      params.set('partners', encodeURIComponent(JSON.stringify(cleanPartners)))
    }
    const staffOverrideTrim = branchPayrollStaffOverride.trim()
    if (staffOverrideTrim) {
      const value = Math.max(0, Math.round(Number(staffOverrideTrim.replace(/\s/g, '').replace(',', '.'))) || 0)
      params.set('payroll_staff', String(value))
    }
    const opsOverrideTrim = branchPayrollOpsOverride.trim()
    if (opsOverrideTrim) {
      const value = Math.max(0, Math.round(Number(opsOverrideTrim.replace(/\s/g, '').replace(',', '.'))) || 0)
      params.set('payroll_ops', String(value))
    }
    const noteTrim = branchNote.trim()
    if (noteTrim) {
      // Ограничим разумной длиной чтобы не сломать URL.
      params.set('note', noteTrim.slice(0, 2000))
    }
    return params
  }

  const handleDownloadBranchPdf = async () => {
    if (!branchReportCompanyId || !branchReportFrom || !branchReportTo) return
    setBranchPdfDownloading(true)
    try {
      const params = buildBranchReportParams()
      const res = await fetch(`/api/admin/profitability/pdf?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        throw new Error(errJson?.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="?([^";]+)"?/i)
      const filename = match?.[1] || `profitability-${branchReportFrom}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`Не удалось сформировать PDF: ${e?.message || 'неизвестная ошибка'}`)
    } finally {
      setBranchPdfDownloading(false)
    }
  }

  // По умолчанию выбираем последний месяц периода страницы (один месяц).
  // Это можно переопределить вручную полями ниже.
  useEffect(() => {
    if (!branchReportFrom && monthTo) setBranchReportFrom(monthTo)
    if (!branchReportTo && monthTo) setBranchReportTo(monthTo)
  }, [monthTo, branchReportFrom, branchReportTo])

  // Per-month, per-company P&L breakdown — нужно для инвесторского экспорта.
  // Та же логика что byCompany, но строится по каждому месяцу периода.
  const byMonthByCompany = useMemo(() => {
    const result = new Map<string, Map<string, any>>()
    for (const row of rows) {
      const m = row.month
      type Agg = { company_id: string; name: string; revenue: number; cashRevenue: number; cashlessRevenue: number; cogs: number; operating: number; posComJ: number; payrollJ: number; payrollTaxJ: number; incomeTaxJ: number; depreciationJ: number; financialJ: number; nonOpJ: number; capexJ: number; profitDistJ: number }
      const aggs = new Map<string, Agg>()
      for (const c of companies) {
        aggs.set(String(c.id), {
          company_id: String(c.id), name: c.name,
          revenue: 0, cashRevenue: 0, cashlessRevenue: 0,
          cogs: 0, operating: 0,
          posComJ: 0, payrollJ: 0, payrollTaxJ: 0, incomeTaxJ: 0,
          depreciationJ: 0, financialJ: 0, nonOpJ: 0, capexJ: 0, profitDistJ: 0,
        })
      }
      // Бакет для строк БЕЗ компании (company_id=null) — раньше они молча пропускались.
      aggs.set('', {
        company_id: '', name: 'Без компании',
        revenue: 0, cashRevenue: 0, cashlessRevenue: 0,
        cogs: 0, operating: 0,
        posComJ: 0, payrollJ: 0, payrollTaxJ: 0, incomeTaxJ: 0,
        depreciationJ: 0, financialJ: 0, nonOpJ: 0, capexJ: 0, profitDistJ: 0,
      })
      for (const ir of incomes) {
        if (!ir.date.startsWith(m)) continue
        const a = aggs.get(String(ir.company_id || ''))
        if (!a) continue
        const cash = Number(ir.cash_amount || 0)
        const kaspi = Number(ir.kaspi_amount || 0)
        const online = Number(ir.online_amount || 0)
        const card = Number(ir.card_amount || 0)
        a.cashRevenue += cash
        a.cashlessRevenue += kaspi + online + card
        a.revenue += cash + kaspi + online + card
      }
      for (const er of expenses) {
        if (!er.date.startsWith(m)) continue
        const a = aggs.get(String(er.company_id || ''))
        if (!a) continue
        const amount = Number(er.cash_amount || 0) + Number(er.kaspi_amount || 0)
        const norm = String(er.category || '').trim().toLowerCase()
        const group = resolveFinancialGroup(er.category, expenseCategories[norm] || null)
        if (group === 'cogs') a.cogs += amount
        else if (group === 'pos_commission') a.posComJ += amount
        else if (group === 'payroll' || group === 'payroll_advance') a.payrollJ += amount
        else if (group === 'payroll_tax') a.payrollTaxJ += amount
        else if (group === 'income_tax') a.incomeTaxJ += amount
        else if (group === 'financial_expenses') a.financialJ += amount
        else if (group === 'non_operating') a.nonOpJ += amount
        else if (group === 'depreciation') a.depreciationJ += amount
        else if (group === 'capex') a.capexJ += amount
        else if (group === 'profit_distribution') a.profitDistJ += amount
        else a.operating += amount
      }
      const sumRevenue = Array.from(aggs.values()).reduce((s, a) => s + a.revenue, 0)
      const usePosM = row.manualPosCommission > 0
      const usePayrollM = row.payrollManual > 0
      const usePayrollTaxM = row.payrollTaxesManual > 0
      const useIncomeTaxM = row.incomeTaxManual > 0
      const useDeprM = row.depreciationManual > 0
      const inner = new Map<string, any>()
      for (const a of aggs.values()) {
        if (a.revenue === 0 && a.cogs === 0 && a.operating === 0 && a.payrollJ === 0) continue
        const share = sumRevenue > 0 ? a.revenue / sumRevenue : 0
        const amortization = Number(row.amortization || 0) * share
        const otherOperating = Number(row.otherOperating || 0) * share
        const posCom = usePosM ? Number(row.posCommission || 0) * share : a.posComJ
        const payroll = usePayrollM ? Number(row.payroll || 0) * share : a.payrollJ
        const payrollTaxes = usePayrollTaxM ? Number(row.payrollTaxes || 0) * share : a.payrollTaxJ
        const incomeTax = useIncomeTaxM ? Number(row.incomeTax || 0) * share : a.incomeTaxJ
        const depreciation = useDeprM ? Number(row.depreciation || 0) * share : a.depreciationJ
        const cogs = a.cogs
        const grossProfit = a.revenue - cogs
        const ebitda = grossProfit - a.operating - posCom - payroll - payrollTaxes - otherOperating
        const operatingProfit = ebitda - depreciation - amortization
        const ebt = operatingProfit - a.financialJ
        const netProfit = ebt - incomeTax - a.nonOpJ
        const margin = a.revenue > 0 ? (netProfit / a.revenue) * 100 : 0
        const ebitdaMarginCo = a.revenue > 0 ? (ebitda / a.revenue) * 100 : 0
        inner.set(a.company_id, {
          company_id: a.company_id, name: a.name, share,
          revenue: a.revenue, cashRevenue: a.cashRevenue, cashlessRevenue: a.cashlessRevenue,
          cogs, grossProfit, operating: a.operating, posCom, payroll, payrollTaxes, otherOperating,
          ebitda, ebitdaMargin: ebitdaMarginCo,
          depreciation, amortization, operatingProfit,
          financialExpenses: a.financialJ, ebt,
          incomeTax, nonOperating: a.nonOpJ, netProfit, margin,
          capex: a.capexJ, profitDistribution: a.profitDistJ,
        })
      }
      result.set(m, inner)
    }
    return result
  }, [rows, companies, incomes, expenses, expenseCategories])

  // Полный P&L по каждой точке за ВЕСЬ выбранный период (агрегат месяцев).
  const byCompanyPeriod = useMemo(() => {
    const acc = new Map<string, any>()
    for (const inner of byMonthByCompany.values()) {
      for (const [cid, c] of inner) {
        const e = acc.get(cid) || {
          company_id: cid, name: c.name,
          revenue: 0, cashRevenue: 0, cashlessRevenue: 0, cogs: 0, operating: 0, posCom: 0,
          payroll: 0, payrollTaxes: 0, otherOperating: 0, ebitda: 0, depreciation: 0,
          amortization: 0, operatingProfit: 0, financialExpenses: 0, incomeTax: 0, nonOperating: 0, netProfit: 0,
          capex: 0, profitDistribution: 0,
        }
        e.revenue += c.revenue; e.cashRevenue += c.cashRevenue; e.cashlessRevenue += c.cashlessRevenue
        e.cogs += c.cogs; e.operating += c.operating; e.posCom += c.posCom
        e.payroll += c.payroll; e.payrollTaxes += c.payrollTaxes; e.otherOperating += c.otherOperating || 0
        e.ebitda += c.ebitda; e.depreciation += c.depreciation; e.amortization += c.amortization
        e.operatingProfit += c.operatingProfit; e.financialExpenses += c.financialExpenses
        e.incomeTax += c.incomeTax; e.nonOperating += c.nonOperating; e.netProfit += c.netProfit
        e.capex += c.capex || 0; e.profitDistribution += c.profitDistribution || 0
        acc.set(cid, e)
      }
    }
    const totalRev = Array.from(acc.values()).reduce((s, c) => s + c.revenue, 0)
    return Array.from(acc.values())
      .filter((c) => c.company_id !== '' || c.revenue !== 0 || c.cogs !== 0 || c.operating !== 0 || c.payroll !== 0 || c.payrollTaxes !== 0 || c.posCom !== 0)
      .map((c) => ({
        ...c,
        grossProfit: c.revenue - c.cogs,
        ebt: c.operatingProfit - c.financialExpenses,
        share: totalRev > 0 ? c.revenue / totalRev : 0,
        margin: c.revenue > 0 ? (c.netProfit / c.revenue) * 100 : 0,
        ebitdaMargin: c.revenue > 0 ? (c.ebitda / c.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [byMonthByCompany])

  // Выгрузка Excel: сводный лист «все точки» + лист помесячно на каждую точку.
  const handleExportAllPoints = async () => {
    if (byCompanyPeriod.length === 0) return
    setAllPointsExporting(true)
    try {
      const period = `${monthLabel(monthFrom)} — ${monthLabel(monthTo)}`
      const generated = new Date().toLocaleString('ru-RU')
      const t = byCompanyPeriod.reduce((a, c) => ({
        revenue: a.revenue + c.revenue, cashRevenue: a.cashRevenue + c.cashRevenue, cashlessRevenue: a.cashlessRevenue + c.cashlessRevenue,
        cogs: a.cogs + c.cogs, operating: a.operating + c.operating, posCom: a.posCom + c.posCom,
        payroll: a.payroll + c.payroll, payrollTaxes: a.payrollTaxes + c.payrollTaxes,
        ebitda: a.ebitda + c.ebitda, netProfit: a.netProfit + c.netProfit,
      }), { revenue: 0, cashRevenue: 0, cashlessRevenue: 0, cogs: 0, operating: 0, posCom: 0, payroll: 0, payrollTaxes: 0, ebitda: 0, netProfit: 0 })
      // Детальная ОПиУ по точке — как раскрывающийся блок на экране (страница на точку).
      const detailColumns = [
        { key: 'label', label: 'Показатель' },
        { key: 'value', label: 'Сумма', align: 'right' as const },
        { key: 'meta', label: 'Маржа / Доля', align: 'right' as const },
      ]
      const detailSection = (c: any) => {
        const pctOf = (v: number) => (c.revenue > 0 ? `${((v / c.revenue) * 100).toFixed(1)}%` : '—')
        const fcf = c.netProfit - (c.capex || 0) - (c.profitDistribution || 0)
        return {
          title: `${c.name} — детальная ОПиУ`,
          dense: true,
          columns: detailColumns,
          rows: [
            { label: 'Выручка', value: c.revenue, meta: '100%', strong: true },
            { label: '  Наличные', value: c.cashRevenue, meta: pctOf(c.cashRevenue) },
            { label: '  Безналичные', value: c.cashlessRevenue, meta: pctOf(c.cashlessRevenue) },
            { label: 'COGS (Себестоимость)', value: -c.cogs, meta: pctOf(c.cogs) },
            { label: 'Валовая прибыль', value: c.grossProfit, meta: pctOf(c.grossProfit), strong: true },
            { heading: 'Операционные расходы' },
            { label: 'Операционные расходы', value: -c.operating, meta: pctOf(c.operating) },
            { label: `Комиссия ${cashLabels.pos} / эквайринг`, value: -c.posCom, meta: pctOf(c.posCom) },
            { label: 'Фонд оплаты труда', value: -c.payroll, meta: pctOf(c.payroll) },
            { label: 'Налоги на зарплату', value: -c.payrollTaxes, meta: ' ' },
            { label: 'Прочие операционные', value: -(c.otherOperating || 0), meta: ' ' },
            { label: 'EBITDA', value: c.ebitda, meta: `${c.ebitdaMargin.toFixed(1)}%`, strong: true },
            { heading: 'Неденежные · финансовые · налоги' },
            { label: 'Износ', value: -c.depreciation, meta: ' ' },
            { label: 'Амортизация', value: -c.amortization, meta: ' ' },
            { label: 'Опер. прибыль (EBIT)', value: c.operatingProfit, meta: pctOf(c.operatingProfit), strong: true },
            { label: 'Финансовые расходы (% по кредитам)', value: -c.financialExpenses, meta: ' ' },
            { label: 'EBT', value: c.ebt, meta: ' ', strong: true },
            { label: 'Налог на прибыль / 3%', value: -c.incomeTax, meta: ' ' },
            { label: 'Неоперационные / разовые', value: -c.nonOperating, meta: ' ' },
            { label: 'ЧИСТАЯ ПРИБЫЛЬ', value: c.netProfit, meta: `${c.margin.toFixed(1)}%`, strong: true },
            { heading: 'Справочно — вне P&L' },
            { label: 'CAPEX (покупка активов)', value: -(c.capex || 0), meta: ' ' },
            { label: 'Распределение прибыли', value: -(c.profitDistribution || 0), meta: ' ' },
            { label: 'FCF (после CAPEX + распределения)', value: fcf, meta: ' ', strong: true },
          ],
        }
      }
      await downloadReportPdf('table', {
        meta: { title: 'P&L по точкам', period, generated },
        sections: [
          {
            title: 'Сводно по точкам',
            columns: [
              { key: 'name', label: 'Точка' },
              { key: 'revenue', label: 'Выручка', align: 'right' },
              { key: 'cashRevenue', label: 'Нал', align: 'right' },
              { key: 'cashlessRevenue', label: 'Безнал', align: 'right' },
              { key: 'cogs', label: 'COGS', align: 'right' },
              { key: 'operating', label: 'Операц.', align: 'right' },
              { key: 'posCom', label: 'POS-комис.', align: 'right' },
              { key: 'payrollAll', label: 'ФОТ+налоги', align: 'right' },
              { key: 'ebitda', label: 'EBITDA', align: 'right' },
              { key: 'netProfit', label: 'Чистая прибыль', align: 'right' },
              { key: 'margin', label: 'Маржа %', align: 'right' },
              { key: 'share', label: 'Доля %', align: 'right' },
            ],
            rows: byCompanyPeriod.map((c) => ({
              name: c.name, revenue: c.revenue, cashRevenue: c.cashRevenue, cashlessRevenue: c.cashlessRevenue,
              cogs: c.cogs, operating: c.operating, posCom: c.posCom, payrollAll: c.payroll + c.payrollTaxes,
              ebitda: c.ebitda, netProfit: c.netProfit, margin: Math.round(c.margin), share: Math.round(c.share * 100),
            })),
            total: { name: 'ИТОГО', revenue: t.revenue, cashRevenue: t.cashRevenue, cashlessRevenue: t.cashlessRevenue, cogs: t.cogs, operating: t.operating, posCom: t.posCom, payrollAll: t.payroll + t.payrollTaxes, ebitda: t.ebitda, netProfit: t.netProfit, margin: t.revenue ? Math.round((t.netProfit / t.revenue) * 100) : 0, share: 100 },
          },
          ...byCompanyPeriod.map(detailSection),
        ],
      }, `Tochki_PnL_${monthFrom}_${monthTo}`)
    } catch (e: any) {
      setError(e?.message || 'Не удалось выгрузить отчёт по точкам')
    } finally {
      setAllPointsExporting(false)
    }
  }

  const handleInvestorExport = async () => {
    if (!investorCompanyId) return
    const company = companies.find((c) => String(c.id) === investorCompanyId)
    if (!company) return
    setInvestorExporting(true)
    try {
      const period = `${monthLabel(monthFrom)} — ${monthLabel(monthTo)}`
      const generated = new Date().toLocaleString('ru-RU')

      // Собираем по точке месяцы
      const branchMonthly: any[] = []
      let bRev = 0, bCogs = 0, bOp = 0, bPos = 0, bPayroll = 0, bPayTax = 0, bDepr = 0, bAmort = 0, bOther = 0, bFin = 0, bIncTax = 0, bNonOp = 0, bEbitda = 0, bEbit = 0, bNet = 0
      for (const r of rows) {
        const inner = byMonthByCompany.get(r.month)
        const c = inner?.get(investorCompanyId)
        if (!c) continue
        branchMonthly.push({
          month: monthLabel(r.month),
          revenue: c.revenue,
          cashRevenue: c.cashRevenue,
          cashlessRevenue: c.cashlessRevenue,
          cogs: c.cogs,
          operating: c.operating,
          posCom: c.posCom,
          payroll: c.payroll,
          payrollTaxes: c.payrollTaxes,
          otherOperating: c.otherOperating,
          ebitda: c.ebitda,
          depreciation: c.depreciation,
          amortization: c.amortization,
          operatingProfit: c.operatingProfit,
          financialExpenses: c.financialExpenses,
          incomeTax: c.incomeTax,
          nonOperating: c.nonOperating,
          netProfit: c.netProfit,
          margin: c.margin,
          share: c.share * 100,
        })
        bRev += c.revenue; bCogs += c.cogs; bOp += c.operating; bPos += c.posCom
        bPayroll += c.payroll; bPayTax += c.payrollTaxes; bDepr += c.depreciation
        bAmort += c.amortization; bOther += c.otherOperating; bFin += c.financialExpenses
        bIncTax += c.incomeTax; bNonOp += c.nonOperating
        bEbitda += c.ebitda; bEbit += c.operatingProfit; bNet += c.netProfit
      }
      const bGross = bRev - bCogs
      const bMargin = bRev > 0 ? (bNet / bRev) * 100 : 0
      const bEbitdaMargin = bRev > 0 ? (bEbitda / bRev) * 100 : 0

      const cashTot = branchMonthly.reduce((s, r) => s + r.cashRevenue, 0)
      const cashlessTot = branchMonthly.reduce((s, r) => s + r.cashlessRevenue, 0)
      const pctOf = (v: number) => bRev > 0 ? `${(v / bRev * 100).toFixed(1)}%` : '—'
      const pnlRows = [
        { label: '— ВЫРУЧКА —', value: ' ', meta: ' ' },
        { label: 'Выручка', value: bRev, meta: '100%' },
        { label: '  Наличные', value: cashTot, meta: pctOf(cashTot) },
        { label: '  Безналичные', value: cashlessTot, meta: pctOf(cashlessTot) },
        { label: '— СЕБЕСТОИМОСТЬ —', value: ' ', meta: ' ' },
        { label: 'COGS (Себестоимость)', value: -bCogs, meta: pctOf(bCogs) },
        { label: 'Валовая прибыль', value: bGross, meta: pctOf(bGross) },
        { label: '— ОПЕРАЦИОННЫЕ РАСХОДЫ —', value: ' ', meta: ' ' },
        { label: 'Операционные', value: -bOp, meta: ' ' },
        { label: `Комиссия ${cashLabels.pos}`, value: -bPos, meta: ' ' },
        { label: 'Фонд оплаты труда', value: -bPayroll, meta: ' ' },
        { label: 'Налоги на ФОТ', value: -bPayTax, meta: ' ' },
        { label: 'Прочие операционные', value: -bOther, meta: ' ' },
        { label: 'EBITDA', value: bEbitda, meta: `${bEbitdaMargin.toFixed(1)}%` },
        { label: '— НЕДЕНЕЖНЫЕ —', value: ' ', meta: ' ' },
        { label: 'Износ (амортизация)', value: -bDepr, meta: ' ' },
        { label: 'Амортизация НМА', value: -bAmort, meta: ' ' },
        { label: 'Опер. прибыль (EBIT)', value: bEbit, meta: pctOf(bEbit) },
        { label: '— ФИН. И НАЛОГИ —', value: ' ', meta: ' ' },
        { label: 'Финансовые расходы (%)', value: -bFin, meta: ' ' },
        { label: 'EBT', value: bEbit - bFin, meta: ' ' },
        { label: 'Налог на прибыль / 3%', value: -bIncTax, meta: ' ' },
        { label: 'Неоперационные', value: -bNonOp, meta: ' ' },
        { label: 'ЧИСТАЯ ПРИБЫЛЬ', value: bNet, meta: `${bMargin.toFixed(1)}%` },
      ]
      const safeName = company.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)
      await downloadReportPdf('table', {
        meta: { title: `Отчёт инвестора — ${company.name}`, period, generated },
        columns: [
          { key: 'label', label: 'Показатель' },
          { key: 'value', label: 'Сумма', align: 'right' },
          { key: 'meta', label: 'Маржа / Доля', align: 'right' },
        ],
        rows: pnlRows,
      }, `Investor_${safeName}_${monthFrom}_${monthTo}`)
    } finally {
      setInvestorExporting(false)
    }
  }


  return (
    <div className="app-page-wide space-y-6">
      {/* ═══ HEADER ═══ */}
      <AdminPageHeader
        title="ОПиУ и прибыльность"
        description={`Период: ${periodLabel} · выручка и расходы автоматически из журнала, при необходимости — ручные корректировки`}
        icon={<Landmark className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
              <CalendarDays className="h-4 w-4 text-emerald-400" />
              <input type="month" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} className="cursor-pointer rounded bg-slate-100 dark:bg-white/[0.05] px-1.5 py-0.5 outline-none focus:bg-slate-200 dark:focus:bg-white/[0.1]" />
              <span className="text-muted-foreground">—</span>
              <input type="month" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} className="cursor-pointer rounded bg-slate-100 dark:bg-white/[0.05] px-1.5 py-0.5 outline-none focus:bg-slate-200 dark:focus:bg-white/[0.1]" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => { const c = closedMonthDefaults(); setMonthFrom(c.from); setMonthTo(c.to) }}>4 мес</Button>
              <Button variant="outline" size="sm" onClick={() => { const last = shiftMonth(currentMonth(), -1); setMonthFrom(shiftMonth(last, -5)); setMonthTo(last) }}>6 мес</Button>
              <Button variant="outline" size="sm" onClick={() => { const last = shiftMonth(currentMonth(), -1); setMonthFrom(shiftMonth(last, -11)); setMonthTo(last) }}>12 мес</Button>
              <Button variant="outline" size="sm" onClick={() => { const last = shiftMonth(currentMonth(), -1); setMonthFrom(`${last.slice(0, 4)}-01`); setMonthTo(last) }}>Год</Button>
            </div>
          </div>
        }
      />

      {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">{success}</div> : null}

      {/* ═══ MONTH PILLS ═══ */}
      {months.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {months.map((month) => {
            const row = rows.find((r) => r.month === month)
            const isActive = month === selectedMonth
            const margin = row?.revenue ? (row.netProfit / row.revenue) * 100 : 0
            return (
              <button
                key={month}
                onClick={() => setSelectedMonth(month)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all ${
                  isActive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]'
                    : 'border-border bg-card text-muted-foreground hover:border-emerald-500/30 hover:text-foreground'
                }`}
              >
                <span className="font-medium capitalize">{monthLabel(month)}</span>
                {row && row.revenue > 0 ? (
                  <span className={`text-xs ${margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {margin >= 0 ? '+' : ''}{margin.toFixed(0)}%
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      {/* ═══ TABS ═══ */}
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {([
          ['overview', 'Обзор'],
          ['monthly', 'Помесячно'],
          ['points', 'По точкам'],
          ['reports', 'Отчёты'],
          ['settings', 'Настройки'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === key ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && !selected ? (
        <Card className="border-border bg-card p-12 text-center text-muted-foreground animate-pulse">Загружаем данные ОПиУ…</Card>
      ) : selected ? (
        <>
          {tab === 'overview' && (<>
          {/* ═══ HERO KPI cards — выручка, EBITDA, опер.прибыль, чистая ═══ */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(() => {
              const cards: Array<{ label: string; value: number; prev: number; icon: any; accent: string; sub?: string }> = [
                { label: 'Выручка', value: selected.revenue, prev: prevSelected?.revenue || 0, icon: TrendingUp, accent: 'text-blue-600 dark:text-blue-300', sub: selected.hasRevenueOverride ? 'ручной ввод' : 'из журнала' },
                { label: 'EBITDA', value: selected.ebitda, prev: prevSelected?.ebitda || 0, icon: Calculator, accent: 'text-cyan-600 dark:text-cyan-300', sub: `маржа ${ebitdaMargin.toFixed(1)}%` },
                { label: 'Опер. прибыль (EBIT)', value: selected.operatingProfit, prev: prevSelected?.operatingProfit || 0, icon: Wallet, accent: 'text-amber-600 dark:text-amber-300' },
                { label: 'Чистая прибыль', value: selected.netProfit, prev: prevSelected?.netProfit || 0, icon: Target, accent: selected.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300', sub: `маржа ${netMargin.toFixed(1)}%` },
              ]
              return cards.map(({ label, value, prev, icon: Icon, accent, sub }) => {
                const d = delta(value, prev)
                return (
                  <Card key={label} className="border-border bg-card p-4">
                    <div className="flex items-start justify-between">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                      <Icon className={`h-4 w-4 ${accent}`} />
                    </div>
                    <p className={`mt-2 text-2xl font-semibold ${value < 0 ? 'text-rose-600 dark:text-rose-300' : 'text-foreground'}`}>{money(value)}</p>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{sub || ' '}</span>
                      {d !== null ? (
                        <span className={`flex items-center gap-0.5 font-medium ${d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {d >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                          {Math.abs(d).toFixed(1)}%
                        </span>
                      ) : null}
                    </div>
                  </Card>
                )
              })
            })()}
          </div>

          {/* ═══ INSIGHT (если есть прошлый месяц) ═══ */}
          {insightText ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
              <div className="shrink-0 rounded-lg bg-amber-500/15 p-1.5 text-amber-700 dark:text-amber-300"><Lightbulb className="h-4 w-4" /></div>
              <p className="text-sm text-amber-800 dark:text-amber-100/90">{insightText}</p>
            </div>
          ) : null}

          {/* ═══ WATERFALL + TOP CATEGORIES ═══ */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
            {/* WATERFALL */}
            <Card className="border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Куда уходят деньги</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">ОПиУ цепочка по стандарту: выручка → ... → чистая прибыль</p>
                </div>
                <Sparkles className="h-4 w-4 text-emerald-400" />
              </div>
              <Waterfall selected={selected} cashLabels={cashLabels} />
            </Card>

            {/* TOP CATEGORIES */}
            <Card className="border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Топ-6 расходов месяца</h2>
                <span className="text-xs text-muted-foreground">{selected.label}</span>
              </div>
              {topCategoriesSelected.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Нет расходов за месяц</p>
              ) : (
                <div className="space-y-2.5">
                  {(() => {
                    const maxTotal = topCategoriesSelected[0]?.total || 1
                    return topCategoriesSelected.map((cat, i) => {
                      const pct = (cat.total / maxTotal) * 100
                      const groupLabel = ({
                        cogs: 'COGS', operating: 'Опер.', payroll: 'ФОТ', payroll_advance: 'Аванс',
                        payroll_tax: 'Налог ФОТ', pos_commission: 'Эквайр.', income_tax: 'Налог 3%',
                        depreciation: 'Износ', financial_expenses: 'Фин.', non_operating: 'Разов.',
                        capex: 'CAPEX', profit_distribution: 'Распред.',
                      } as Record<string, string>)[cat.group] || 'Опер.'
                      const groupColor = ({
                        cogs: 'bg-orange-500/80', operating: 'bg-blue-500/80', payroll: 'bg-purple-500/80',
                        payroll_advance: 'bg-purple-400/80', payroll_tax: 'bg-pink-500/80', pos_commission: 'bg-cyan-500/80',
                        income_tax: 'bg-yellow-500/80', depreciation: 'bg-slate-500/80', financial_expenses: 'bg-rose-500/80',
                        non_operating: 'bg-gray-500/80', capex: 'bg-amber-500/80', profit_distribution: 'bg-violet-500/80',
                      } as Record<string, string>)[cat.group] || 'bg-blue-500/80'
                      return (
                        <div key={cat.name}>
                          <div className="mb-1 flex items-baseline justify-between gap-2">
                            <div className="flex min-w-0 items-baseline gap-2">
                              <span className="shrink-0 text-xs text-muted-foreground">#{i + 1}</span>
                              <span className="truncate text-sm text-foreground">{cat.name}</span>
                              <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium border border-border bg-surface-muted text-muted-foreground">{groupLabel}</span>
                            </div>
                            <span className="shrink-0 text-sm font-medium text-foreground">{money(cat.total)}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                            <div className={`h-full ${groupColor} transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              )}
            </Card>
          </div>

          {/* ═══ POS & БЕЗНАЛ — разбивка комиссии эквайринга ═══ */}
          {(selected.posCommission > 0 || selected.cashlessRevenue > 0) && (
            <Card className="border-border bg-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-cyan-400" />
                  POS и безнал
                </h2>
                <span className="text-xs text-muted-foreground">{selected.label}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-4">
                <div className="rounded-lg border border-border bg-white dark:bg-white/[0.02] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Наличка</div>
                  <div className="mt-1 text-base font-semibold text-foreground tabular-nums">{money(selected.cashRevenue)}</div>
                </div>
                <div className="rounded-lg border border-border bg-white dark:bg-white/[0.02] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Безнал</div>
                  <div className="mt-1 text-base font-semibold text-foreground tabular-nums">{money(selected.cashlessRevenue)}</div>
                </div>
                <div className="rounded-lg border border-border bg-white dark:bg-white/[0.02] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Оборот POS (ручной)</div>
                  <div className="mt-1 text-base font-semibold text-foreground tabular-nums">{money(selected.posTurnover)}</div>
                </div>
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Итого комиссия POS</div>
                  <div className="mt-1 text-base font-semibold text-cyan-700 dark:text-cyan-200 tabular-nums">{money(selected.posCommission)}</div>
                </div>
              </div>
              {selected.posTurnover > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Разбивка по типам оплаты (оборот × ставка)</p>
                  {[
                    [cashLabels.qr, selected.kaspiQrTurnover, selected.kaspiQrRate, selected.kaspiQrCommission],
                    [cashLabels.gold, selected.kaspiGoldTurnover, selected.kaspiGoldRate, selected.kaspiGoldCommission],
                    ['Другие карты', selected.otherCardsTurnover, selected.otherCardsRate, selected.otherCardsCommission],
                    [cashLabels.red, selected.kaspiRedTurnover, selected.kaspiRedRate, selected.kaspiRedCommission],
                    [cashLabels.kredit, selected.kaspiKreditTurnover, selected.kaspiKreditRate, selected.kaspiKreditCommission],
                  ].filter(([, turnover]) => Number(turnover) > 0).map(([label, turnover, rate, commission]) => (
                    <div key={String(label)} className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 rounded-md bg-white dark:bg-white/[0.02] px-3 py-1.5 text-sm">
                      <span className="text-foreground">{label}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{money(Number(turnover))}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">× {Number(rate).toFixed(2)}%</span>
                      <span className="text-cyan-700 dark:text-cyan-300 font-medium tabular-nums">= {money(Number(commission))}</span>
                    </div>
                  ))}
                  {selected.legacyQrGoldTurnover > 0 ? (
                    <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 rounded-md bg-amber-500/5 border border-amber-500/15 px-3 py-1.5 text-sm">
                      <span className="text-amber-700 dark:text-amber-200">Старый общий QR/Gold</span>
                      <span className="text-xs text-amber-600 dark:text-amber-300/80 tabular-nums">{money(selected.legacyQrGoldTurnover)}</span>
                      <span className="text-xs text-amber-600 dark:text-amber-300/80 tabular-nums">× {Number(selected.legacyQrGoldRate).toFixed(2)}%</span>
                      <span className="text-amber-700 dark:text-amber-300 font-medium tabular-nums">= {money(selected.legacyQrGoldCommission)}</span>
                    </div>
                  ) : null}
                </div>
              ) : selected.journalPosCommission > 0 ? (
                <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/[0.03] p-3 text-sm text-muted-foreground">
                  <Info className="inline h-3.5 w-3.5 mr-1 text-cyan-400" />
                  Комиссия взята из журнала расходов (категории с группой «Комиссия POS / эквайринг»: {money(selected.journalPosCommission)}). Для детальной разбивки по типам — заполни обороты ниже в «Ручных корректировках».
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-white dark:bg-white/[0.02] p-3 text-xs text-muted-foreground">
                  Комиссия POS не заполнена ни в журнале, ни вручную.
                </div>
              )}
            </Card>
          )}

          {/* ═══ DETAILED P&L TABLE (collapsed by default) ═══ */}
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium text-foreground hover:bg-surface-muted">
              <span className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-emerald-400" />
                Детальная ОПиУ цепочка
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <Card className="mt-3 border-border bg-card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { label: 'Выручка', value: selected.revenue, kind: 'pos', big: true },
                    ...(selected.cogs > 0 ? [
                      { label: 'COGS (Себестоимость)', value: -selected.cogs, kind: 'neg' as const },
                      { label: 'Валовая прибыль', value: selected.grossProfit, kind: 'subtotal' as const },
                    ] : []),
                    { label: 'Операционные расходы', value: -selected.journalOperatingExpenses, kind: 'neg' as const },
                    { label: `Комиссия ${cashLabels.pos} / эквайринг`, value: -selected.posCommission, kind: 'neg' as const },
                    { label: 'Фонд оплаты труда', value: -selected.payroll, kind: 'neg' as const },
                    { label: 'Налоги на зарплату', value: -selected.payrollTaxes, kind: 'neg' as const },
                    { label: 'Прочие операционные', value: -selected.otherOperating, kind: 'neg' as const },
                    { label: 'EBITDA', value: selected.ebitda, kind: 'subtotal' as const },
                    { label: 'Износ', value: -selected.depreciation, kind: 'neg' as const },
                    { label: 'Амортизация', value: -selected.amortization, kind: 'neg' as const },
                    { label: 'Опер. прибыль (EBIT)', value: selected.operatingProfit, kind: 'subtotal' as const },
                    { label: 'Финансовые расходы (% по кредитам)', value: -selected.financialExpensesJournal, kind: 'neg' as const },
                    { label: 'EBT', value: selected.ebt, kind: 'subtotal' as const },
                    { label: 'Налог на прибыль / 3%', value: -selected.incomeTax, kind: 'neg' as const },
                    { label: 'Неоперационные / разовые', value: -selected.nonOperatingJournalExpenses, kind: 'neg' as const },
                    { label: 'Чистая прибыль', value: selected.netProfit, kind: 'final' as const },
                  ].map(({ label, value, kind, big }) => (
                    <tr key={label} className={`border-b border-border last:border-b-0 ${kind === 'subtotal' ? 'bg-slate-50 dark:bg-white/[0.02]' : ''} ${kind === 'final' ? 'bg-emerald-500/5 border-t-2 border-emerald-500/20' : ''}`}>
                      <td className={`px-4 py-2.5 ${kind === 'subtotal' ? 'font-medium text-foreground' : kind === 'final' ? 'font-semibold text-emerald-700 dark:text-emerald-200' : big ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{label}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${kind === 'final' ? 'font-bold text-emerald-700 dark:text-emerald-200' : kind === 'subtotal' ? 'font-semibold text-foreground' : value >= 0 ? 'text-foreground' : 'text-rose-600 dark:text-rose-300'}`}>{money(value)}</td>
                    </tr>
                  ))}
                  {(selected.journalCapex > 0 || selected.profitDistributionJournal > 0) && (
                    <>
                      <tr className="border-t-2 border-amber-500/20 bg-amber-500/[0.04]"><td colSpan={2} className="px-4 py-2 text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400/70">Справочно — вне P&L</td></tr>
                      {selected.journalCapex > 0 && (
                        <tr className="border-b border-border"><td className="px-4 py-2.5 text-muted-foreground">CAPEX (покупка активов)</td><td className="px-4 py-2.5 text-right text-amber-700 dark:text-amber-300 tabular-nums">−{money(selected.journalCapex)}</td></tr>
                      )}
                      {selected.profitDistributionJournal > 0 && (
                        <tr className="border-b border-border"><td className="px-4 py-2.5 text-muted-foreground">Распределение прибыли</td><td className="px-4 py-2.5 text-right text-violet-700 dark:text-violet-300 tabular-nums">−{money(selected.profitDistributionJournal)}</td></tr>
                      )}
                      <tr className="bg-amber-500/[0.04]">
                        <td className="px-4 py-2.5 font-medium text-foreground">FCF (после CAPEX + распределения)</td>
                        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${(selected.netProfit - selected.journalCapex - selected.profitDistributionJournal) >= 0 ? 'text-amber-700 dark:text-amber-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(selected.netProfit - selected.journalCapex - selected.profitDistributionJournal)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
              {selected.notes ? (
                <div className="border-t border-border bg-slate-50 dark:bg-white/[0.02] px-4 py-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Комментарий: </span>{selected.notes}
                </div>
              ) : null}
            </Card>
          </details>

          </>)}
          {tab === 'monthly' && (<>
          {/* ═══ MONTHLY HISTORY TABLE ═══ */}
          {rows.length > 1 && (
            <Card className="border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Помесячная динамика</h2>
                <span className="text-xs text-muted-foreground">клик по строке → выбрать месяц</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2.5">Месяц</th>
                      <th className="px-3 py-2.5 text-right">Выручка</th>
                      <th className="px-3 py-2.5 text-right">Опер. журнал</th>
                      <th className="px-3 py-2.5 text-right">Эквайр.</th>
                      <th className="px-3 py-2.5 text-right">EBITDA</th>
                      <th className="px-3 py-2.5 text-right">Чистая</th>
                      <th className="px-3 py-2.5 text-right">Маржа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const margin = row.revenue ? (row.netProfit / row.revenue) * 100 : 0
                      return (
                        <tr key={row.month} onClick={() => setSelectedMonth(row.month)} className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03] ${row.month === selectedMonth ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/20' : ''}`}>
                          <td className="px-3 py-2.5 font-medium text-foreground capitalize">{row.label}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{money(row.revenue)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(row.journalOperatingExpenses)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(row.posCommission)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${row.ebitda >= 0 ? 'text-cyan-700 dark:text-cyan-300' : 'text-rose-600 dark:text-rose-300'}`}>{money(row.ebitda)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${row.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{money(row.netProfit)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{margin >= 0 ? '+' : ''}{margin.toFixed(1)}%</td>
                        </tr>
                      )
                    })}
                    <tr className="border-t-2 border-emerald-500/20 bg-emerald-500/5 font-medium">
                      <td className="px-3 py-2.5 text-foreground">Итого за период</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{money(totals.revenue)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${totals.ebitda >= 0 ? 'text-cyan-700 dark:text-cyan-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(totals.ebitda)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${totals.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(totals.netProfit)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">{totals.revenue ? `${((totals.netProfit / totals.revenue) * 100).toFixed(1)}%` : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          </>)}
          {tab === 'reports' && (<>
          {/* ═══ УПРАВЛЕНЧЕСКИЙ ОТЧЁТ ПО ТОЧКЕ (PDF) — детальный, без других точек ═══ */}
          <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-rose-500/[0.03] p-5">
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-200 flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Управленческий отчёт по точке (PDF)
                </h2>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-100/70">
                  Чистая P&L одной точки за {periodLabel}: оборот, 2% налог, расходы по категориям,
                  чистая прибыль и распределение по партнёрам. Без сводки по другим точкам.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-amber-800 dark:text-amber-100/80 mb-1.5">Точка</label>
                  <select
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500/40"
                    value={branchReportCompanyId}
                    onChange={(e) => setBranchReportCompanyId(e.target.value)}
                  >
                    <option value="">— выберите точку —</option>
                    {companies.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-xs text-amber-800 dark:text-amber-100/80">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-amber-400"
                      checked={branchReportIncludeCapex}
                      onChange={(e) => setBranchReportIncludeCapex(e.target.checked)}
                    />
                    Включить раздел «Капитальные вложения» (если есть)
                  </label>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <div>
                  <label className="block text-xs font-medium text-amber-800 dark:text-amber-100/80 mb-1.5">С месяца</label>
                  <input
                    type="month"
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500/40"
                    value={branchReportFrom}
                    onChange={(e) => setBranchReportFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-800 dark:text-amber-100/80 mb-1.5">По месяц</label>
                  <input
                    type="month"
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500/40"
                    value={branchReportTo}
                    onChange={(e) => setBranchReportTo(e.target.value)}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (monthTo) {
                        setBranchReportFrom(monthTo)
                        setBranchReportTo(monthTo)
                      }
                    }}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-100 hover:bg-amber-500/20"
                  >
                    Только последний месяц
                  </button>
                </div>
              </div>

              {/* Ручной override ФОТ — если расчёт по БД для прошлых месяцев неточный */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-100/80">
                  ФОТ для отчёта (вручную)
                  <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-100/50">пусто = считать автоматически</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <label className="block text-[11px] text-amber-800 dark:text-amber-100/70 mb-1">Адм. сотрудники, ₸</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="напр., 1850000"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500/40"
                      value={branchPayrollStaffOverride}
                      onChange={(e) => setBranchPayrollStaffOverride(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-amber-800 dark:text-amber-100/70 mb-1">Операторы по сменам, ₸</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="напр., 600000"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500/40"
                      value={branchPayrollOpsOverride}
                      onChange={(e) => setBranchPayrollOpsOverride(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Комментарий к отчёту — попадает в PDF (например, «в апреле провели ремонт зоны PS5») */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-100/80">
                  Пояснение к отчёту
                  <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-100/50">появится в PDF внизу страницы</span>
                </div>
                <textarea
                  value={branchNote}
                  onChange={(e) => setBranchNote(e.target.value)}
                  placeholder="Например: в апреле провели ремонт зоны PS5 на 350 000 ₸ — деньги отражены в капвложениях. Также подняли оклад менеджеру с 15 числа."
                  rows={3}
                  maxLength={2000}
                  className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500/40"
                />
                <div className="mt-1 flex justify-between text-[10px] text-amber-700 dark:text-amber-100/50">
                  <span>Сохраняется автоматически в браузере</span>
                  <span>{branchNote.length}/2000</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-amber-800 dark:text-amber-100/80">Распределение чистой прибыли (партнёры)</div>
                  <button
                    type="button"
                    onClick={() =>
                      setBranchReportPartners((prev) => [...prev, { name: '', percent: '10' }])
                    }
                    className="text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline-offset-2 hover:underline"
                  >
                    + Добавить партнёра
                  </button>
                </div>
                {branchReportPartners.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-amber-500/20 bg-amber-500/[0.03] px-3 py-2 text-xs text-amber-800 dark:text-amber-100/60">
                    Нет партнёров. Чистая прибыль целиком останется владельцу.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {branchReportPartners.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Имя партнёра"
                          className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:border-amber-500/40"
                          value={p.name}
                          onChange={(e) =>
                            setBranchReportPartners((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row)),
                            )
                          }
                        />
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="%"
                          min="0"
                          max="100"
                          step="0.1"
                          className="w-20 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground tabular-nums outline-none focus:border-amber-500/40"
                          value={p.percent}
                          onChange={(e) =>
                            setBranchReportPartners((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, percent: e.target.value } : row)),
                            )
                          }
                        />
                        <span className="text-sm text-amber-800 dark:text-amber-100/60">%</span>
                        <button
                          type="button"
                          onClick={() =>
                            setBranchReportPartners((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="px-2 text-rose-400 hover:text-rose-200"
                          title="Удалить"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <div className="text-[10px] text-amber-700 dark:text-amber-100/50">
                      Сумма долей:{' '}
                      {branchReportPartners
                        .reduce((sum, p) => sum + (Number(p.percent) || 0), 0)
                        .toFixed(1)}
                      %
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  disabled={!branchReportCompanyId || !branchReportFrom || !branchReportTo || branchPdfDownloading}
                  onClick={() => void handleDownloadBranchPdf()}
                  className="bg-amber-600 text-white hover:bg-amber-500"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {branchPdfDownloading ? 'Готовим PDF…' : 'Скачать PDF'}
                </Button>
                <Button
                  variant="outline"
                  disabled={!branchReportCompanyId || !branchReportFrom || !branchReportTo}
                  onClick={() => {
                    const params = buildBranchReportParams()
                    window.open(`/profitability/print?${params.toString()}`, '_blank')
                  }}
                >
                  Открыть в браузере
                </Button>
                <span className="text-[11px] text-amber-800 dark:text-amber-100/60">
                  «Скачать PDF» — сразу .pdf файл. «Открыть в браузере» — для предпросмотра.
                </span>
              </div>
            </div>
          </Card>

          {/* ═══ INVESTOR EXPORT — Excel по одной точке + общая сводка ═══ */}
          <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] to-cyan-500/[0.03] p-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[240px]">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-200 flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Отчёт для инвестора (PDF)
                </h2>
                <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-100/70">
                  Детальная P&L выбранной точки за период {periodLabel} + общая сводка по всем точкам для сравнения.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-500/40"
                  value={investorCompanyId}
                  onChange={(e) => setInvestorCompanyId(e.target.value)}
                >
                  <option value="">— выберите точку —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
                <Button
                  onClick={() => void handleInvestorExport()}
                  disabled={!investorCompanyId || investorExporting}
                  className="bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {investorExporting ? 'Готовим…' : 'Скачать PDF'}
                </Button>
              </div>
            </div>
          </Card>

          </>)}
          {tab === 'points' && (<>
          {/* ═══ ПО ТОЧКАМ ЗА ПЕРИОД (агрегат, не один месяц) + выгрузка ═══ */}
          {byCompanyPeriod.length > 0 && (
            <Card className="border-border bg-card p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    <Landmark className="h-4 w-4 text-amber-400" />
                    По точкам за период — {monthLabel(monthFrom)} — {monthLabel(monthTo)}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">Полный P&amp;L по каждой точке за весь выбранный период. Ручные оверрайды (POS, ФОТ, налоги) разнесены по доле выручки.</p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0 gap-1.5" disabled={allPointsExporting} onClick={() => void handleExportAllPoints()}>
                  <Download className="h-4 w-4" /> {allPointsExporting ? 'Выгрузка…' : 'Все точки (PDF)'}
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2.5">Точка</th>
                      <th className="px-3 py-2.5 text-right">Выручка</th>
                      <th className="px-3 py-2.5 text-right">Нал</th>
                      <th className="px-3 py-2.5 text-right">Безнал</th>
                      <th className="px-3 py-2.5 text-right">COGS</th>
                      <th className="px-3 py-2.5 text-right">Опер.</th>
                      <th className="px-3 py-2.5 text-right">ФОТ+нал.</th>
                      <th className="px-3 py-2.5 text-right">EBITDA</th>
                      <th className="px-3 py-2.5 text-right">Чистая</th>
                      <th className="px-3 py-2.5 text-right">Маржа</th>
                      <th className="px-3 py-2.5 text-right">Доля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCompanyPeriod.map((c) => (
                      <tr key={c.company_id} className="border-b border-border/50 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                        <td className="px-3 py-2.5 font-medium text-foreground">{c.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(c.revenue)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.cashRevenue)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.cashlessRevenue)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.cogs)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.operating)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.payroll + c.payrollTaxes)}</td>
                        <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${c.ebitda >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300'}`}>{money(c.ebitda)}</td>
                        <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${c.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{money(c.netProfit)}</td>
                        <td className={`px-3 py-2.5 text-right text-xs tabular-nums ${c.margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{c.margin >= 0 ? '+' : ''}{c.margin.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">{(c.share * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                    {(() => {
                      const t = byCompanyPeriod.reduce((acc, c) => ({
                        revenue: acc.revenue + c.revenue, cashRevenue: acc.cashRevenue + c.cashRevenue, cashlessRevenue: acc.cashlessRevenue + c.cashlessRevenue,
                        cogs: acc.cogs + c.cogs, operating: acc.operating + c.operating,
                        payroll: acc.payroll + c.payroll, payrollTaxes: acc.payrollTaxes + c.payrollTaxes,
                        ebitda: acc.ebitda + c.ebitda, netProfit: acc.netProfit + c.netProfit,
                      }), { revenue: 0, cashRevenue: 0, cashlessRevenue: 0, cogs: 0, operating: 0, payroll: 0, payrollTaxes: 0, ebitda: 0, netProfit: 0 })
                      const margin = t.revenue ? (t.netProfit / t.revenue) * 100 : 0
                      return (
                        <tr className="border-t-2 border-amber-500/20 bg-amber-500/5 font-medium">
                          <td className="px-3 py-2.5 text-foreground">ИТОГО</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{money(t.revenue)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.cashRevenue)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.cashlessRevenue)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.cogs)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.operating)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.payroll + t.payrollTaxes)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${t.ebitda >= 0 ? 'text-amber-700 dark:text-amber-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(t.ebitda)}</td>
                          <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${t.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(t.netProfit)}</td>
                          <td className={`px-3 py-2.5 text-right text-xs tabular-nums ${margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{margin >= 0 ? '+' : ''}{margin.toFixed(1)}%</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">100%</td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ═══ ДЕТАЛЬНАЯ ОПиУ ПО КАЖДОЙ ТОЧКЕ ═══ */}
          {byCompanyPeriod.length > 0 && (
            <div className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <BarChart2 className="h-4 w-4 text-emerald-400" />
                Детальная ОПиУ по каждой точке
              </h2>
              {byCompanyPeriod.map((c) => {
                const fcf = c.netProfit - (c.capex || 0) - (c.profitDistribution || 0)
                return (
                  <details key={c.company_id || 'none'} className="group">
                    <summary className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium text-foreground hover:bg-surface-muted">
                      <span className="flex items-center gap-2">
                        <Landmark className="h-4 w-4 text-amber-400" />
                        {c.name}
                        <span className="text-xs font-normal text-muted-foreground">· выручка {money(c.revenue)} · чистая {money(c.netProfit)}</span>
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <Card className="mt-2 overflow-hidden border-border bg-card p-0">
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            { label: 'Выручка', value: c.revenue, kind: 'pos' as const, big: true },
                            ...(c.cogs > 0 ? [
                              { label: 'COGS (Себестоимость)', value: -c.cogs, kind: 'neg' as const },
                              { label: 'Валовая прибыль', value: c.grossProfit, kind: 'subtotal' as const },
                            ] : []),
                            { label: 'Операционные расходы', value: -c.operating, kind: 'neg' as const },
                            { label: `Комиссия ${cashLabels.pos} / эквайринг`, value: -c.posCom, kind: 'neg' as const },
                            { label: 'Фонд оплаты труда', value: -c.payroll, kind: 'neg' as const },
                            { label: 'Налоги на зарплату', value: -c.payrollTaxes, kind: 'neg' as const },
                            { label: 'Прочие операционные', value: -c.otherOperating, kind: 'neg' as const },
                            { label: 'EBITDA', value: c.ebitda, kind: 'subtotal' as const },
                            { label: 'Износ', value: -c.depreciation, kind: 'neg' as const },
                            { label: 'Амортизация', value: -c.amortization, kind: 'neg' as const },
                            { label: 'Опер. прибыль (EBIT)', value: c.operatingProfit, kind: 'subtotal' as const },
                            { label: 'Финансовые расходы (% по кредитам)', value: -c.financialExpenses, kind: 'neg' as const },
                            { label: 'EBT', value: c.ebt, kind: 'subtotal' as const },
                            { label: 'Налог на прибыль / 3%', value: -c.incomeTax, kind: 'neg' as const },
                            { label: 'Неоперационные / разовые', value: -c.nonOperating, kind: 'neg' as const },
                            { label: 'Чистая прибыль', value: c.netProfit, kind: 'final' as const },
                          ].map(({ label, value, kind, big }) => (
                            <tr key={label} className={`border-b border-border last:border-b-0 ${kind === 'subtotal' ? 'bg-slate-50 dark:bg-white/[0.02]' : ''} ${kind === 'final' ? 'border-t-2 border-emerald-500/20 bg-emerald-500/5' : ''}`}>
                              <td className={`px-4 py-2.5 ${kind === 'subtotal' ? 'font-medium text-foreground' : kind === 'final' ? 'font-semibold text-emerald-700 dark:text-emerald-200' : big ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{label}</td>
                              <td className={`px-4 py-2.5 text-right tabular-nums ${kind === 'final' ? 'font-bold text-emerald-700 dark:text-emerald-200' : kind === 'subtotal' ? 'font-semibold text-foreground' : value >= 0 ? 'text-foreground' : 'text-rose-600 dark:text-rose-300'}`}>{money(value)}</td>
                            </tr>
                          ))}
                          {(c.capex > 0 || c.profitDistribution > 0) && (
                            <>
                              <tr className="border-t-2 border-amber-500/20 bg-amber-500/[0.04]"><td colSpan={2} className="px-4 py-2 text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400/70">Справочно — вне P&L</td></tr>
                              {c.capex > 0 && (
                                <tr className="border-b border-border"><td className="px-4 py-2.5 text-muted-foreground">CAPEX (покупка активов)</td><td className="px-4 py-2.5 text-right tabular-nums text-amber-700 dark:text-amber-300">−{money(c.capex)}</td></tr>
                              )}
                              {c.profitDistribution > 0 && (
                                <tr className="border-b border-border"><td className="px-4 py-2.5 text-muted-foreground">Распределение прибыли</td><td className="px-4 py-2.5 text-right tabular-nums text-violet-700 dark:text-violet-300">−{money(c.profitDistribution)}</td></tr>
                              )}
                              <tr className="bg-amber-500/[0.04]">
                                <td className="px-4 py-2.5 font-medium text-foreground">FCF (после CAPEX + распределения)</td>
                                <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${fcf >= 0 ? 'text-amber-700 dark:text-amber-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(fcf)}</td>
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </Card>
                  </details>
                )
              })}
            </div>
          )}

          {/* ═══ BY COMPANY за месяц — убрано по запросу (дублировало таблицу за период) ═══ */}
          {false && byCompany.length > 0 && (
            <Card className="border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-emerald-400" />
                    Распределение по точкам — {selected.label}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">Журнальные расходы — фактические; ручные оверрайды (POS, ФОТ, налоги, амортизация) разнесены пропорционально доле выручки точки</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2.5">Точка</th>
                      <th className="px-3 py-2.5 text-right">Выручка</th>
                      <th className="px-3 py-2.5 text-right">Доля</th>
                      <th className="px-3 py-2.5 text-right">COGS</th>
                      <th className="px-3 py-2.5 text-right">Опер.</th>
                      <th className="px-3 py-2.5 text-right">POS</th>
                      <th className="px-3 py-2.5 text-right">ФОТ+нал.</th>
                      <th className="px-3 py-2.5 text-right">EBITDA</th>
                      <th className="px-3 py-2.5 text-right">Чистая</th>
                      <th className="px-3 py-2.5 text-right">Маржа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCompany.map((c) => (
                      <tr key={c.company_id} className="border-b border-border/50 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                        <td className="px-3 py-2.5 font-medium text-foreground">{c.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(c.revenue)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">{(c.share * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.cogs)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.operating)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.posCom)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(c.payroll + c.payrollTaxes)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${c.ebitda >= 0 ? 'text-cyan-700 dark:text-cyan-300' : 'text-rose-600 dark:text-rose-300'}`}>{money(c.ebitda)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${c.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{money(c.netProfit)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${c.margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{c.margin >= 0 ? '+' : ''}{c.margin.toFixed(1)}%</td>
                      </tr>
                    ))}
                    {(() => {
                      const t = byCompany.reduce((acc, c) => ({
                        revenue: acc.revenue + c.revenue,
                        cogs: acc.cogs + c.cogs,
                        operating: acc.operating + c.operating,
                        posCom: acc.posCom + c.posCom,
                        payroll: acc.payroll + c.payroll,
                        payrollTaxes: acc.payrollTaxes + c.payrollTaxes,
                        ebitda: acc.ebitda + c.ebitda,
                        netProfit: acc.netProfit + c.netProfit,
                      }), { revenue: 0, cogs: 0, operating: 0, posCom: 0, payroll: 0, payrollTaxes: 0, ebitda: 0, netProfit: 0 })
                      const margin = t.revenue ? (t.netProfit / t.revenue) * 100 : 0
                      return (
                        <tr className="border-t-2 border-emerald-500/20 bg-emerald-500/5 font-medium">
                          <td className="px-3 py-2.5 text-foreground">ИТОГО</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{money(t.revenue)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">100%</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.cogs)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.operating)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.posCom)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(t.payroll + t.payrollTaxes)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${t.ebitda >= 0 ? 'text-cyan-700 dark:text-cyan-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(t.ebitda)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${t.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(t.netProfit)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{margin >= 0 ? '+' : ''}{margin.toFixed(1)}%</td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                <Info className="inline h-3 w-3 mr-1" />
                «ИТОГО» по точкам может отличаться от верхнего KPI: ручные оверрайды разнесены пропорционально, в журнале возможен мусор без company_id или дни вне периода.
              </p>
            </Card>
          )}

          </>)}
          {tab === 'settings' && (<>
          {/* ═══ ALERTS (kaspi daily corrections) ═══ */}
          {selected.hasRevenueOverride ? (
            <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-100">
              <Info className="inline h-4 w-4 mr-1" /> Выручка взята из ручных верхних вводов (наличка {money(selected.cashRevenueOverride)} + POS {money(selected.posRevenueOverride)}). Очисти эти поля чтобы вернуть данные из журнала.
            </div>
          ) : null}
          {selected.hasKaspiDailyAdjustment && !selected.hasRevenueOverride ? (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-100">
              <Info className="inline h-4 w-4 mr-1" /> Безналичный за месяц пересчитан по календарным суткам ({selected.kaspiDailyAdjustment > 0 ? '+' : ''}{money(selected.kaspiDailyAdjustment)}).
            </div>
          ) : null}
          {selected.hasKaspiDailyWarnings && !selected.hasRevenueOverride ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-100">
              <Info className="inline h-4 w-4 mr-1" /> Для части ночных смен нет разделения {cashLabels.providerName} до и после полуночи — суточная сверка неполная.
            </div>
          ) : null}

          {/* ═══ MANUAL INPUTS (свёрнутый блок) ═══ */}
          <Card className="border-border bg-card overflow-hidden">
            <button
              onClick={() => setShowManualInputs((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-sm font-medium text-foreground hover:bg-slate-50 dark:hover:bg-white/[0.03]"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-amber-400" />
                Ручные корректировки и комиссии POS
                <span className="ml-2 text-xs font-normal text-muted-foreground">(точные ставки банка, override ФОТ/налогов, what-if)</span>
              </span>
              {showManualInputs ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showManualInputs && (
              <div className="border-t border-border p-5 space-y-5">
                <ManualInputTabs
                  cashLabels={cashLabels}
                  draft={draft}
                  setDraft={setDraft}
                  inputTab={inputTab}
                  setInputTab={setInputTab}
                />
                {selected && draftPreview ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="mb-3 text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                      <Calculator className="h-3.5 w-3.5" />
                      Превью для {monthLabel(selectedMonth)}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 mb-4">
                      <div className="rounded-lg border border-border bg-white dark:bg-white/[0.02] p-3 text-sm space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Сейчас сохранено</div>
                        <div className="flex justify-between text-muted-foreground"><span>Выручка</span><span className="tabular-nums">{money(selected.revenue)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Комиссия POS</span><span className="tabular-nums">{money(selected.posCommission)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>EBITDA</span><span className="tabular-nums">{money(selected.ebitda)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Опер. прибыль</span><span className="tabular-nums">{money(selected.operatingProfit)}</span></div>
                        <div className="flex justify-between text-foreground font-medium pt-1 border-t border-border"><span>Чистая</span><span className="tabular-nums">{money(selected.netProfit)}</span></div>
                      </div>
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-3 text-sm space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1.5">После сохранения</div>
                        <div className="flex justify-between text-foreground"><span>Выручка</span><span className={`tabular-nums ${draftPreview.revenue !== selected.revenue ? 'text-cyan-700 dark:text-cyan-300' : ''}`}>{money(draftPreview.revenue)}</span></div>
                        <div className="flex justify-between text-foreground"><span>Комиссия POS</span><span className={`tabular-nums ${Math.round(draftPreview.posCommission) !== Math.round(selected.posCommission) ? 'text-cyan-700 dark:text-cyan-300' : ''}`}>{money(draftPreview.posCommission)}</span></div>
                        <div className="flex justify-between text-foreground"><span>EBITDA</span><span className={`tabular-nums ${draftPreview.ebitda >= selected.ebitda ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{money(draftPreview.ebitda)}</span></div>
                        <div className="flex justify-between text-foreground"><span>Опер. прибыль</span><span className={`tabular-nums ${draftPreview.operatingProfit >= selected.operatingProfit ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{money(draftPreview.operatingProfit)}</span></div>
                        <div className="flex justify-between font-medium pt-1 border-t border-emerald-500/20"><span className="text-foreground">Чистая</span><span className={`tabular-nums ${draftPreview.netProfit >= selected.netProfit ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-600 dark:text-rose-300'}`}>{money(draftPreview.netProfit)}</span></div>
                      </div>
                    </div>
                    {canEdit && (
                      <Button onClick={save} disabled={saving || !selectedMonth} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                        <Save className="mr-2 h-4 w-4" />{saving ? 'Сохраняем…' : `Сохранить ${monthLabel(selectedMonth)}`}
                      </Button>
                    )}
                  </div>
                ) : null}

                <WhatIfPanel selected={selected} whatIf={whatIf} setWhatIf={setWhatIf} />
              </div>
            )}
          </Card>
          </>)}
        </>
      ) : null}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Внутренние компоненты страницы
// ═══════════════════════════════════════════════════════════════════════

type SelectedRow = any  // тип сложный, упрощаем тут

function Waterfall({ selected, cashLabels }: { selected: SelectedRow; cashLabels: any }) {
  const revenue = Math.max(1, selected.revenue)
  const fmt = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₸`
  const items = [
    { label: 'Выручка', value: selected.revenue, kind: 'positive' as const, sub: 'нал + безнал' },
    ...(selected.cogs > 0 ? [{ label: 'COGS', value: -selected.cogs, kind: 'negative' as const, sub: 'себестоимость' }] : []),
    ...(selected.cogs > 0 ? [{ label: 'Валовая прибыль', value: selected.grossProfit, kind: 'subtotal' as const, sub: `${selected.revenue ? ((selected.grossProfit / selected.revenue) * 100).toFixed(0) : 0}% от выручки` }] : []),
    { label: 'Операционные', value: -selected.journalOperatingExpenses, kind: 'negative' as const, sub: 'аренда, реклама, ремонт' },
    { label: `Комиссия ${cashLabels.pos}`, value: -selected.posCommission, kind: 'negative' as const, sub: 'эквайринг' },
    { label: 'ФОТ + налоги', value: -(selected.payroll + selected.payrollTaxes), kind: 'negative' as const, sub: 'зарплаты + ОПВ/ОСМС' },
    { label: 'EBITDA', value: selected.ebitda, kind: 'subtotal' as const, sub: `${selected.revenue ? ((selected.ebitda / selected.revenue) * 100).toFixed(0) : 0}% маржа` },
    ...(selected.depreciation > 0 || selected.amortization > 0 ? [{ label: 'Износ + амортизация', value: -(selected.depreciation + selected.amortization), kind: 'negative' as const, sub: '' }] : []),
    ...(selected.financialExpensesJournal > 0 ? [{ label: 'Финансовые расходы', value: -selected.financialExpensesJournal, kind: 'negative' as const, sub: '% по кредитам' }] : []),
    { label: 'Налог + разовые', value: -(selected.incomeTax + selected.nonOperatingJournalExpenses), kind: 'negative' as const, sub: '3% / ИПН / штрафы' },
    { label: 'Чистая прибыль', value: selected.netProfit, kind: 'final' as const, sub: `${selected.revenue ? ((selected.netProfit / selected.revenue) * 100).toFixed(1) : 0}% маржа` },
  ].filter((i) => i.kind === 'subtotal' || i.kind === 'final' || i.kind === 'positive' || Math.abs(i.value) > 0)

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const abs = Math.abs(item.value)
        const pct = Math.max(0.5, Math.min(100, (abs / revenue) * 100))
        const isPos = item.value >= 0
        const barColor =
          item.kind === 'final' ? (isPos ? 'bg-emerald-500/80' : 'bg-rose-500/80')
            : item.kind === 'subtotal' ? 'bg-cyan-500/60'
              : item.kind === 'positive' ? 'bg-blue-500/70'
                : 'bg-rose-500/50'
        const textColor =
          item.kind === 'final' ? (isPos ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-600 dark:text-rose-200')
            : item.kind === 'subtotal' ? 'text-cyan-700 dark:text-cyan-200'
              : 'text-foreground'
        const rowBg =
          item.kind === 'final' ? 'bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg px-3 py-2'
            : item.kind === 'subtotal' ? 'bg-surface-muted rounded-lg px-3 py-2'
              : 'px-3 py-1.5'
        return (
          <div key={item.label} className={rowBg}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className={`text-sm ${item.kind === 'subtotal' || item.kind === 'final' ? 'font-semibold' : 'font-medium'} ${textColor}`}>{item.label}</span>
                {item.sub ? <span className="text-[10px] text-muted-foreground truncate">{item.sub}</span> : null}
              </div>
              <span className={`shrink-0 text-sm tabular-nums ${item.kind === 'final' ? 'font-bold' : 'font-medium'} ${textColor}`}>{isPos ? '' : '−'}{fmt(abs)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
              <div className={`h-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ManualInputTabs({ cashLabels, draft, setDraft, inputTab, setInputTab }: any) {
  return (
    <>
      <div className="flex gap-1 rounded-xl border border-border bg-white dark:bg-white/[0.02] p-1">
        {INPUT_TABS.map((tab) => (
          <button key={tab.id} onClick={() => setInputTab(tab.id)} className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all ${inputTab === tab.id ? 'bg-emerald-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {inputTab === 'revenue' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Общая наличная выручка за месяц (необязательно)</label>
              <Input type="number" min="0" step="100" value={draft.cash_revenue_override} onChange={(e: any) => setDraft((prev: any) => ({ ...prev, cash_revenue_override: e.target.value }))} placeholder="из журнала если пусто" className="border-border bg-input text-foreground" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Общая выручка по POS за месяц (необязательно)</label>
              <Input type="number" min="0" step="100" value={draft.pos_revenue_override} onChange={(e: any) => setDraft((prev: any) => ({ ...prev, pos_revenue_override: e.target.value }))} placeholder="из журнала если пусто" className="border-border bg-input text-foreground" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Точные ставки эквайринга по типам оплаты</p>
            {[
              ['kaspi_qr_turnover', 'kaspi_qr_rate', cashLabels.qr],
              ['kaspi_gold_turnover', 'kaspi_gold_rate', cashLabels.gold],
              ['other_cards_turnover', 'other_cards_rate', 'Другие карты'],
              ['kaspi_red_turnover', 'kaspi_red_rate', cashLabels.red],
              ['kaspi_kredit_turnover', 'kaspi_kredit_rate', cashLabels.kredit],
            ].map(([turnoverKey, rateKey, label]) => (
              <div key={String(label)} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-white dark:bg-white/[0.02] p-3 md:grid-cols-[1fr_140px_100px] md:items-center">
                <div className="text-xs font-medium text-foreground">{label}</div>
                <Input type="number" min="0" step="100" value={draft[turnoverKey]} onChange={(e: any) => setDraft((prev: any) => ({ ...prev, [turnoverKey]: e.target.value }))} placeholder="Оборот, ₸" className="h-8 border-border bg-input text-xs text-foreground" />
                <Input type="number" min="0" step="0.01" value={draft[rateKey]} onChange={(e: any) => setDraft((prev: any) => ({ ...prev, [rateKey]: e.target.value }))} placeholder="%" className="h-8 border-border bg-input text-xs text-foreground" />
              </div>
            ))}
          </div>
        </div>
      )}

      {inputTab === 'payroll' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Заполняй только если хочешь перекрыть автоматическую раскладку из журнала.</p>
          {[
            ['payroll_amount', 'ФОТ вручную'],
            ['payroll_taxes_amount', 'Налоги на зарплату вручную'],
            ['income_tax_amount', 'Налог на прибыль / 3% вручную'],
          ].map(([key, label]) => (
            <div key={String(key)} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px] md:items-center">
              <label className="text-xs text-foreground">{label}</label>
              <Input type="number" min="0" step="100" value={draft[key]} onChange={(e: any) => setDraft((prev: any) => ({ ...prev, [key]: e.target.value }))} placeholder="0" className="h-9 border-border bg-input text-sm text-foreground" />
            </div>
          ))}
        </div>
      )}

      {inputTab === 'other' && (
        <div className="space-y-3">
          {[
            ['depreciation_amount', 'Износ'],
            ['amortization_amount', 'Амортизация'],
            ['other_operating_amount', 'Прочие операционные'],
          ].map(([key, label]) => (
            <div key={String(key)} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px] md:items-center">
              <label className="text-xs text-foreground">{label}</label>
              <Input type="number" min="0" step="100" value={draft[key]} onChange={(e: any) => setDraft((prev: any) => ({ ...prev, [key]: e.target.value }))} placeholder="0" className="h-9 border-border bg-input text-sm text-foreground" />
            </div>
          ))}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Комментарий по месяцу</label>
            <Textarea value={draft.notes} onChange={(e: any) => setDraft((prev: any) => ({ ...prev, notes: e.target.value }))} placeholder="например: разовая выплата партнёру, изменение договора с банком..." className="min-h-20 border-border bg-input text-sm text-foreground" />
          </div>
        </div>
      )}
    </>
  )
}

function WhatIfPanel({ selected, whatIf, setWhatIf }: any) {
  if (!selected) return null
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
  const fmt = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₸`
  return (
    <div className="rounded-xl border border-border bg-white dark:bg-white/[0.02] p-4 space-y-3">
      <h3 className="text-sm font-medium text-foreground flex items-center gap-2"><BarChart2 className="w-4 h-4 text-emerald-400" />What-if моделирование</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="text-muted-foreground">Выручка ±%</label>
            <span className={`font-medium tabular-nums ${whatIf.revenueAdj > 0 ? 'text-emerald-400' : whatIf.revenueAdj < 0 ? 'text-rose-400' : 'text-muted-foreground'}`}>{whatIf.revenueAdj > 0 ? '+' : ''}{whatIf.revenueAdj}%</span>
          </div>
          <input type="range" min={-50} max={50} step={1} value={whatIf.revenueAdj} onChange={(e) => setWhatIf((prev: any) => ({ ...prev, revenueAdj: Number(e.target.value) }))} className="w-full accent-emerald-500" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="text-muted-foreground">Расходы ±%</label>
            <span className={`font-medium tabular-nums ${whatIf.expenseAdj > 0 ? 'text-rose-400' : whatIf.expenseAdj < 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>{whatIf.expenseAdj > 0 ? '+' : ''}{whatIf.expenseAdj}%</span>
          </div>
          <input type="range" min={-50} max={50} step={1} value={whatIf.expenseAdj} onChange={(e) => setWhatIf((prev: any) => ({ ...prev, expenseAdj: Number(e.target.value) }))} className="w-full accent-rose-500" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs md:grid-cols-3">
        <div className="flex justify-between md:flex-col"><span className="text-muted-foreground">Выручка</span><span className="font-medium text-foreground tabular-nums">{fmt(adjRevenue)}</span></div>
        <div className="flex justify-between md:flex-col"><span className="text-muted-foreground">EBITDA</span><span className={`font-medium tabular-nums ${adjEbitda >= 0 ? 'text-cyan-700 dark:text-cyan-300' : 'text-rose-600 dark:text-rose-300'}`}>{fmt(adjEbitda)} <span className="text-[10px] text-muted-foreground">({adjEbitda - base.ebitda >= 0 ? '+' : ''}{fmt(adjEbitda - base.ebitda)})</span></span></div>
        <div className="flex justify-between md:flex-col"><span className="text-muted-foreground">Чистая</span><span className={`font-semibold tabular-nums ${adjNetProfit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{fmt(adjNetProfit)} <span className="text-[10px] text-muted-foreground">({adjNetProfit - base.netProfit >= 0 ? '+' : ''}{fmt(adjNetProfit - base.netProfit)})</span></span></div>
      </div>
      {(whatIf.revenueAdj !== 0 || whatIf.expenseAdj !== 0) && (
        <button onClick={() => setWhatIf({ revenueAdj: 0, expenseAdj: 0 })} className="text-xs text-muted-foreground hover:text-foreground">Сбросить</button>
      )}
    </div>
  )
}
