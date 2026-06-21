import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, BarRow, ErrorState, EmptyState } from '@/components/ui'

// ─── Типы ответов API (только реально существующие поля) ──────────────────────
type IncomeRow = {
  date: string
  company_id: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
}
type ExpenseRow = {
  date: string | null
  company_id: string | null
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}
type CategoryRow = { name: string; accounting_group: string | null }
type ProfitInputRow = {
  month: string
  cash_revenue_override?: number | null
  pos_revenue_override?: number | null
  kaspi_qr_turnover?: number | null; kaspi_qr_rate?: number | null
  kaspi_gold_turnover?: number | null; kaspi_gold_rate?: number | null
  other_cards_turnover?: number | null; other_cards_rate?: number | null
  kaspi_red_turnover?: number | null; kaspi_red_rate?: number | null
  kaspi_kredit_turnover?: number | null; kaspi_kredit_rate?: number | null
  payroll_amount?: number | null
  payroll_taxes_amount?: number | null
  income_tax_amount?: number | null
  depreciation_amount?: number | null
  amortization_amount?: number | null
  other_operating_amount?: number | null
}
type Company = { id: string; name?: string }

// ─── Классификация расходов (зеркало lib/core/financial-groups) ───────────────
type FinancialGroup =
  | 'cogs' | 'operating' | 'pos_commission' | 'payroll' | 'payroll_advance'
  | 'payroll_tax' | 'depreciation' | 'financial_expenses' | 'income_tax'
  | 'capex' | 'profit_distribution' | 'non_operating'

const GROUPS: FinancialGroup[] = [
  'cogs', 'operating', 'pos_commission', 'payroll', 'payroll_advance', 'payroll_tax',
  'depreciation', 'financial_expenses', 'income_tax', 'capex', 'profit_distribution', 'non_operating',
]

function inferGroup(name: string | null | undefined): FinancialGroup {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return 'operating'
  if (n.includes('себестоим') || n.includes('cogs') || n.includes('закупка товар') || n.includes('стоимость товар') || n.includes('прямые затрат')) return 'cogs'
  if (n.includes('эквайринг') || n.includes('acquiring') || n.includes('инкассац') || n.includes('комиссия pos') || n.includes('комиссия банк') || n.includes('pos комисс') || n.includes('pos-комисс')) return 'pos_commission'
  if (n.includes('аванс')) return 'payroll_advance'
  if (n.includes('осмс') || n.includes('соц') || n.includes('социальн') || n.includes('зарплатн') || n.includes('пенсион') || n.includes('опв')) return 'payroll_tax'
  if (n.includes('3%') || n.includes('налог на прибыль') || n === 'налоги' || n.includes('ипн') || n.includes('кпн')) return 'income_tax'
  if (n === 'зп' || n.includes('зарплат') || n.includes('фот')) return 'payroll'
  if (n.includes('амортизац') || n.includes('износ')) return 'depreciation'
  if (n.includes('процент') || n.includes('кредит') || n.includes('займ') || n.includes('финанс расход')) return 'financial_expenses'
  if (n.includes('capex') || n.includes('капекс') || n.includes('оборудован') || n.includes('покупка тех')) return 'capex'
  if (n.includes('доля партн') || n.includes('доля учред') || n.includes('дивиденд') || n.includes('распределен прибыл') || n.includes('распределение прибыл') || n.includes('выплата партн') || n.includes('выплаты партн')) return 'profit_distribution'
  if (n.includes('штраф') || n.includes('курсов') || n.includes('разов')) return 'non_operating'
  return 'operating'
}
function resolveGroup(name: string | null | undefined, explicit: string | null | undefined): FinancialGroup {
  if (explicit && (GROUPS as string[]).includes(explicit)) return explicit as FinancialGroup
  return inferGroup(name)
}

// ─── Дата-утилиты ─────────────────────────────────────────────────────────────
const N = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const monthStart = (d: Date) => `${monthKey(d)}-01`
const monthEnd = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const pct = (v: number) => `${v.toFixed(1).replace('.0', '')}%`

// Дефолт: последний закрытый месяц (предыдущий), как на вебе.
const lastClosed = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - 1, 1) }

export default function ProfitabilityScreen() {
  const router = useRouter()
  const [cursor, setCursor] = useState(lastClosed)
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [catGroup, setCatGroup] = useState<Record<string, string>>({})
  const [input, setInput] = useState<ProfitInputRow | null>(null)
  const [companyName, setCompanyName] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: Date) => {
    setLoading(true); setError(null)
    const from = monthStart(d)
    const to = monthEnd(d)
    const mk = monthKey(d)
    try {
      const [inc, exp, cats, prof, comp] = await Promise.all([
        apiFetch<{ data: IncomeRow[] }>(`/api/admin/incomes?from=${from}&to=${to}&page=0&page_size=5000`),
        apiFetch<{ data: ExpenseRow[] }>(`/api/admin/expenses?from=${from}&to=${to}&page=0&page_size=5000`),
        apiFetch<{ data: CategoryRow[] }>('/api/admin/expense-categories').catch(() => ({ data: [] as CategoryRow[] })),
        apiFetch<{ items: ProfitInputRow[] }>(`/api/admin/profitability?from=${mk}&to=${mk}`).catch(() => ({ items: [] as ProfitInputRow[] })),
        apiFetch<{ data: Company[] }>('/api/admin/companies').catch(() => ({ data: [] as Company[] })),
      ])
      setIncomes(inc.data || [])
      setExpenses(exp.data || [])
      const cg: Record<string, string> = {}
      for (const c of cats.data || []) if (c?.name) cg[String(c.name).trim().toLowerCase()] = c.accounting_group || ''
      setCatGroup(cg)
      const row = (prof.items || []).find((r) => String(r.month || '').slice(0, 7) === mk) || null
      setInput(row)
      const cn: Record<string, string> = {}
      for (const c of comp.data || []) if (c?.id) cn[String(c.id)] = c.name || ''
      setCompanyName(cn)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(cursor) }, [cursor, load])

  const shiftMonth = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  const isCurrentMonth = useMemo(() => {
    const now = new Date()
    return cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()
  }, [cursor])

  // ─── Расчёт P&L (зеркало app/(main)/profitability расчёта rows[]) ───────────
  const pl = useMemo(() => {
    const inc = incomes.reduce(
      (a, r) => {
        const cash = N(r.cash_amount), kaspi = N(r.kaspi_amount), card = N(r.card_amount), online = N(r.online_amount)
        a.cash += cash; a.kaspi += kaspi; a.card += card; a.online += online
        return a
      },
      { cash: 0, kaspi: 0, card: 0, online: 0 },
    )
    const j = { total: 0, cogs: 0, operating: 0, posCommission: 0, payroll: 0, payrollTaxes: 0, incomeTax: 0, financial: 0, nonOperating: 0, depreciation: 0 }
    for (const e of expenses) {
      const amount = N(e.cash_amount) + N(e.kaspi_amount)
      const group = resolveGroup(e.category, catGroup[String(e.category || '').trim().toLowerCase()] || null)
      j.total += amount
      if (group === 'cogs') j.cogs += amount
      else if (group === 'pos_commission') j.posCommission += amount
      else if (group === 'payroll' || group === 'payroll_advance') j.payroll += amount
      else if (group === 'payroll_tax') j.payrollTaxes += amount
      else if (group === 'income_tax') j.incomeTax += amount
      else if (group === 'financial_expenses') j.financial += amount
      else if (group === 'non_operating') j.nonOperating += amount
      else if (group === 'depreciation') j.depreciation += amount
      else if (group === 'capex' || group === 'profit_distribution') { /* вне P&L */ }
      else j.operating += amount
    }

    const m = input
    const journalRevenue = inc.cash + inc.kaspi + inc.card + inc.online
    const cashOverride = N(m?.cash_revenue_override)
    const posOverride = N(m?.pos_revenue_override)
    const hasRevenueOverride = cashOverride > 0 || posOverride > 0
    const revenue = hasRevenueOverride ? cashOverride + posOverride : journalRevenue
    const cashRevenue = hasRevenueOverride ? cashOverride : inc.cash
    const cashlessRevenue = hasRevenueOverride ? posOverride : inc.kaspi + inc.card + inc.online

    // Ручная комиссия POS (из оборотов и ставок). Если задана — перекрывает журнальную.
    const manualPosCommission =
      N(m?.kaspi_qr_turnover) * N(m?.kaspi_qr_rate) / 100 +
      N(m?.kaspi_gold_turnover) * N(m?.kaspi_gold_rate) / 100 +
      N(m?.other_cards_turnover) * N(m?.other_cards_rate) / 100 +
      N(m?.kaspi_red_turnover) * N(m?.kaspi_red_rate) / 100 +
      N(m?.kaspi_kredit_turnover) * N(m?.kaspi_kredit_rate) / 100
    const posCommission = manualPosCommission > 0 ? manualPosCommission : j.posCommission

    const payroll = N(m?.payroll_amount) > 0 ? N(m?.payroll_amount) : j.payroll
    const payrollTaxes = N(m?.payroll_taxes_amount) > 0 ? N(m?.payroll_taxes_amount) : j.payrollTaxes
    const incomeTax = N(m?.income_tax_amount) > 0 ? N(m?.income_tax_amount) : j.incomeTax
    const depreciation = N(m?.depreciation_amount) > 0 ? N(m?.depreciation_amount) : j.depreciation
    const amortization = N(m?.amortization_amount)
    const otherOperating = N(m?.other_operating_amount)

    const cogs = j.cogs
    const grossProfit = revenue - cogs
    const ebitda = grossProfit - j.operating - posCommission - payroll - payrollTaxes - otherOperating
    const operatingProfit = ebitda - depreciation - amortization
    const ebt = operatingProfit - j.financial
    const netProfit = ebt - incomeTax - j.nonOperating

    return {
      revenue, cashRevenue, cashlessRevenue, cogs, grossProfit,
      operating: j.operating, posCommission, payroll, payrollTaxes, otherOperating,
      ebitda, depreciation, amortization, operatingProfit, financial: j.financial, ebt,
      incomeTax, nonOperating: j.nonOperating, netProfit,
      netMargin: revenue ? (netProfit / revenue) * 100 : 0,
      ebitdaMargin: revenue ? (ebitda / revenue) * 100 : 0,
      hasRevenueOverride,
    }
  }, [incomes, expenses, catGroup, input])

  // ─── Топ категорий расходов ───────────────────────────────────────────────
  const topCategories = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of expenses) {
      const cat = (e.category || '—').trim()
      m.set(cat, (m.get(cat) || 0) + N(e.cash_amount) + N(e.kaspi_amount))
    }
    return Array.from(m.entries())
      .map(([name, total]) => ({ name, total }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [expenses])

  // ─── P&L по точкам (журнальный разрез, как byCompany на вебе) ─────────────
  const byCompany = useMemo(() => {
    type Agg = { id: string; revenue: number; cogs: number; operating: number; posCom: number; payroll: number; payrollTax: number; incomeTax: number; depreciation: number; financial: number; nonOp: number }
    const map = new Map<string, Agg>()
    const get = (id: string) => {
      let a = map.get(id)
      if (!a) { a = { id, revenue: 0, cogs: 0, operating: 0, posCom: 0, payroll: 0, payrollTax: 0, incomeTax: 0, depreciation: 0, financial: 0, nonOp: 0 }; map.set(id, a) }
      return a
    }
    for (const r of incomes) {
      const a = get(String(r.company_id || ''))
      a.revenue += N(r.cash_amount) + N(r.kaspi_amount) + N(r.card_amount) + N(r.online_amount)
    }
    for (const e of expenses) {
      const a = get(String(e.company_id || ''))
      const amount = N(e.cash_amount) + N(e.kaspi_amount)
      const group = resolveGroup(e.category, catGroup[String(e.category || '').trim().toLowerCase()] || null)
      if (group === 'cogs') a.cogs += amount
      else if (group === 'pos_commission') a.posCom += amount
      else if (group === 'payroll' || group === 'payroll_advance') a.payroll += amount
      else if (group === 'payroll_tax') a.payrollTax += amount
      else if (group === 'income_tax') a.incomeTax += amount
      else if (group === 'financial_expenses') a.financial += amount
      else if (group === 'non_operating') a.nonOp += amount
      else if (group === 'depreciation') a.depreciation += amount
      else if (group === 'capex' || group === 'profit_distribution') { /* вне P&L */ }
      else a.operating += amount
    }
    return Array.from(map.values())
      .filter((a) => a.revenue > 0 || a.cogs > 0 || a.operating > 0 || a.payroll > 0)
      .map((a) => {
        const grossProfit = a.revenue - a.cogs
        const ebitda = grossProfit - a.operating - a.posCom - a.payroll - a.payrollTax
        const netProfit = ebitda - a.depreciation - a.financial - a.incomeTax - a.nonOp
        return {
          id: a.id,
          name: a.id ? companyName[a.id] || 'Точка' : 'Без точки',
          revenue: a.revenue,
          netProfit,
          margin: a.revenue > 0 ? (netProfit / a.revenue) * 100 : 0,
        }
      })
      .sort((a, b) => b.netProfit - a.netProfit)
  }, [incomes, expenses, catGroup, companyName])

  const empty = !loading && !error && pl.revenue === 0 && pl.cogs === 0 && pl.operating === 0 && pl.payroll === 0

  // Строки цепочки P&L (расходные — отрицательные).
  const chain: Array<{ label: string; value: number; subtotal?: boolean; color?: string }> = [
    { label: 'Выручка', value: pl.revenue, subtotal: true, color: T.green },
    { label: 'COGS (себестоимость)', value: -pl.cogs },
    { label: 'Валовая прибыль', value: pl.grossProfit, subtotal: true },
    { label: 'Операционные', value: -pl.operating },
    { label: 'Комиссия POS', value: -pl.posCommission },
    { label: 'ФОТ', value: -pl.payroll },
    { label: 'Налоги на ФОТ', value: -pl.payrollTaxes },
    ...(pl.otherOperating ? [{ label: 'Прочее операционное', value: -pl.otherOperating }] : []),
    { label: 'EBITDA', value: pl.ebitda, subtotal: true, color: pl.ebitda >= 0 ? T.teal : T.red },
    { label: 'Амортизация', value: -(pl.depreciation + pl.amortization) },
    { label: 'Финансовые расходы', value: -pl.financial },
    { label: 'Налог на прибыль', value: -pl.incomeTax },
    ...(pl.nonOperating ? [{ label: 'Неоперационные', value: -pl.nonOperating }] : []),
    { label: 'Чистая прибыль', value: pl.netProfit, subtotal: true, color: pl.netProfit >= 0 ? T.greenBright : T.red },
  ]

  const maxRevenueByPoint = Math.max(1, ...byCompany.map((c) => c.revenue))

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Рентабельность</Text>
      </View>

      {/* Переключатель месяца */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={{ padding: 6 }}><Ionicons name="chevron-back" size={20} color={T.textMut} /></Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>
          {cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable onPress={() => !isCurrentMonth && shiftMonth(1)} hitSlop={10} disabled={isCurrentMonth} style={{ padding: 6, opacity: isCurrentMonth ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && incomes.length > 0} onRefresh={() => load(cursor)} tintColor={T.green} />}
      >
        {error ? (
          <ErrorState message={error} onRetry={() => load(cursor)} />
        ) : null}

        {loading && incomes.length === 0 && !error ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : empty ? (
          <EmptyState icon="trending-up" title="За этот месяц данных нет" />
        ) : !error ? (
          <>
            {/* Чистая прибыль — герой */}
            <GlowHero glow={pl.netProfit >= 0 ? T.green : T.red}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ЧИСТАЯ ПРИБЫЛЬ</Text>
              <Text style={{ color: pl.netProfit >= 0 ? T.text : T.red, fontSize: 36, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(pl.netProfit)}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                <Pill text={`маржа ${pct(pl.netMargin)}`} tone={pl.netMargin >= 0 ? 'good' : 'bad'} />
                <Pill text={`EBITDA ${moneyShort(pl.ebitda)}`} tone="brand" />
                {pl.hasRevenueOverride ? <Pill text="ручной ввод выручки" tone="warn" /> : null}
              </View>
              <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Выручка {money(pl.revenue)}</Text>
            </GlowHero>

            {/* Цепочка P&L */}
            <View>
              <SectionTitle hint={`EBITDA-маржа ${pct(pl.ebitdaMargin)}`}>Отчёт о прибылях</SectionTitle>
              <Card style={{ padding: 0 }}>
                {chain.map((c, i) => (
                  <View
                    key={c.label}
                    style={{
                      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      paddingHorizontal: 14, paddingVertical: c.subtotal ? 13 : 11,
                      borderBottomWidth: i < chain.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft,
                      backgroundColor: c.subtotal ? 'rgba(255,255,255,0.025)' : 'transparent',
                    }}
                  >
                    <Text style={{ color: c.subtotal ? T.text : T.textMut, fontSize: c.subtotal ? 14.5 : 13.5, fontWeight: c.subtotal ? '800' : '500' }}>
                      {c.label}
                    </Text>
                    <Text style={{ color: c.color || (c.value < 0 ? T.textMut : T.text), fontSize: c.subtotal ? 15 : 13.5, fontWeight: c.subtotal ? '900' : '700' }}>
                      {c.value < 0 ? `−${money(Math.abs(c.value))}` : money(c.value)}
                    </Text>
                  </View>
                ))}
              </Card>
            </View>

            {/* Топ категорий расходов */}
            {topCategories.length > 0 ? (
              <View>
                <SectionTitle hint="за месяц">Крупнейшие расходы</SectionTitle>
                <Card style={{ gap: S.md }}>
                  {topCategories.map((c) => (
                    <BarRow
                      key={c.name}
                      label={c.name}
                      value={c.total}
                      max={topCategories[0]?.total || 1}
                      color={T.amber}
                      valueLabel={moneyShort(c.total)}
                    />
                  ))}
                </Card>
              </View>
            ) : null}

            {/* P&L по точкам */}
            {byCompany.length > 0 ? (
              <View>
                <SectionTitle hint={`${byCompany.length} точек`}>Прибыль по точкам</SectionTitle>
                <Card style={{ padding: 0 }}>
                  {byCompany.map((c, i) => (
                    <View key={c.id || 'none'} style={{ padding: 14, borderBottomWidth: i < byCompany.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft, gap: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>{c.name}</Text>
                        <Text style={{ color: c.netProfit >= 0 ? T.greenBright : T.red, fontSize: 15, fontWeight: '900' }}>{money(c.netProfit)}</Text>
                      </View>
                      <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: R.pill, overflow: 'hidden' }}>
                        <View style={{ width: `${Math.max(3, Math.min(100, (c.revenue / maxRevenueByPoint) * 100))}%`, height: 6, borderRadius: R.pill, backgroundColor: T.teal }} />
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: T.textDim, fontSize: 12 }}>Выручка {moneyShort(c.revenue)}</Text>
                        <Text style={{ color: c.margin >= 0 ? T.textMut : T.red, fontSize: 12, fontWeight: '700' }}>маржа {pct(c.margin)}</Text>
                      </View>
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}

            <Text style={{ color: T.textDim, fontSize: 11, textAlign: 'center', marginTop: 4, paddingHorizontal: 8 }}>
              Расчёт по журналу доходов и расходов с учётом ручных вводов месяца. Разрез по точкам — без распределения ручных оверрайдов.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
