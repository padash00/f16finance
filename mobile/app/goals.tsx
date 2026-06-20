import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, Segmented, BarRow } from '@/components/ui'

// ─── Типы ответа /api/admin/kpi-plans ──────────────────────────────────────
type PeriodKind = 'year' | 'h1' | 'h2' | 'month'
type Metric = 'revenue' | 'profit' | 'margin' | 'checks' | 'avg_check'

type Company = { id: string; name: string; code?: string | null }
type Plan = {
  id: string
  company_id: string | null
  kind: string
  period_kind: PeriodKind | null
  metric: Metric | null
  target_amount: number
  period_start: string
  period_end: string
  fact_value: number
  achievement_pct: number
  is_closed: boolean
}
type DailyAggregate = {
  date: string
  company_id: string | null
  revenue: number
  expenses: number
  checks: number
}
type ApiData = {
  year: number
  companies: Company[]
  plans: Plan[]
  dailyAggregates?: DailyAggregate[]
}

const MONTH_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

// ─── Helpers (зеркало веб-страницы) ─────────────────────────────────────────
function periodBounds(period: PeriodKind, year: number, monthIdx?: number): { start: string; end: string } {
  if (period === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` }
  if (period === 'h1') return { start: `${year}-01-01`, end: `${year}-06-30` }
  if (period === 'h2') return { start: `${year}-07-01`, end: `${year}-12-31` }
  const m = String((monthIdx || 0) + 1).padStart(2, '0')
  const last = new Date(year, (monthIdx || 0) + 1, 0).getDate()
  return { start: `${year}-${m}-01`, end: `${year}-${m}-${String(last).padStart(2, '0')}` }
}

type Facts = { revenue: number; expenses: number; profit: number; checks: number; avg_check: number; margin: number }

function computeFacts(daily: DailyAggregate[], companyId: string | null, start: string, end: string): Facts {
  let revenue = 0, expenses = 0, checks = 0
  for (const r of daily) {
    if (!r || r.date < start || r.date > end) continue
    if (companyId == null) {
      if (r.company_id !== null) continue
    } else if (r.company_id !== companyId) continue
    revenue += Number(r.revenue || 0)
    expenses += Number(r.expenses || 0)
    checks += Number(r.checks || 0)
  }
  const profit = revenue - expenses
  return {
    revenue: Math.round(revenue),
    expenses: Math.round(expenses),
    profit: Math.round(profit),
    checks,
    avg_check: checks > 0 ? Math.round(revenue / checks) : 0,
    margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
  }
}

const PERIOD_OPTIONS: { key: PeriodKind; label: string }[] = [
  { key: 'year', label: 'Год' },
  { key: 'h1', label: 'I п/г' },
  { key: 'h2', label: 'II п/г' },
  { key: 'month', label: 'Месяц' },
]

export default function GoalsScreen() {
  const router = useRouter()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [tab, setTab] = useState<PeriodKind>('year')
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (y: number) => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<{ ok?: boolean; data?: ApiData }>(`/api/admin/kpi-plans?year=${y}`)
      setData(res?.data || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(year) }, [year, load])

  const companies = data?.companies || []
  const plans = data?.plans || []
  const daily = data?.dailyAggregates || []

  // Факт по выбранному периоду (общий по организации)
  const orgFacts = useMemo(() => {
    const { start, end } = periodBounds(tab, year)
    return computeFacts(daily, null, start, end)
  }, [daily, tab, year])

  // Эффективная цель: явный план периода ИЛИ сумма месячных планов (для аддитивных метрик)
  const monthRange = useMemo<number[]>(() => (
    tab === 'h1' ? [1, 2, 3, 4, 5, 6]
      : tab === 'h2' ? [7, 8, 9, 10, 11, 12]
        : tab === 'year' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
          : []
  ), [tab])

  const effectiveTarget = useCallback((metric: Metric, companyId: string | null): { value: number; synthetic: boolean } => {
    const explicit = plans.find((p) =>
      p.period_kind === tab && p.metric === metric &&
      (companyId == null ? !p.company_id : p.company_id === companyId))
    if (explicit) return { value: Number(explicit.target_amount || 0), synthetic: false }
    // сумма месячных (только revenue/profit — аддитивные)
    if ((metric === 'revenue' || metric === 'profit') && monthRange.length > 0) {
      const sum = plans
        .filter((p) => p.period_kind === 'month' && p.metric === metric)
        .filter((p) => (companyId == null ? !p.company_id : p.company_id === companyId))
        .filter((p) => monthRange.includes(Number(p.period_start.slice(5, 7))))
        .reduce((s, p) => s + Number(p.target_amount || 0), 0)
      return { value: sum, synthetic: sum > 0 }
    }
    return { value: 0, synthetic: false }
  }, [plans, tab, monthRange])

  const revTarget = effectiveTarget('revenue', null)
  const profitTarget = effectiveTarget('profit', null)
  const revPct = revTarget.value > 0 ? Math.round((orgFacts.revenue / revTarget.value) * 1000) / 10 : null

  // Факт по точкам
  const byCompany = useMemo(() => {
    const { start, end } = periodBounds(tab, year)
    return companies.map((c) => {
      const f = computeFacts(daily, c.id, start, end)
      const t = effectiveTarget('revenue', c.id)
      const pct = t.value > 0 ? Math.round((f.revenue / t.value) * 1000) / 10 : null
      return { company: c, facts: f, target: t.value, pct }
    }).sort((a, b) => b.facts.revenue - a.facts.revenue)
  }, [companies, daily, tab, year, effectiveTarget])

  const maxCompanyRev = useMemo(() => Math.max(1, ...byCompany.map((x) => x.facts.revenue)), [byCompany])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Цели и KPI</Text>
      </View>

      {/* Навигация по году */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Pressable onPress={() => setYear((y) => y - 1)} hitSlop={10} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={20} color={T.textMut} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{year}</Text>
        <Pressable
          onPress={() => setYear((y) => Math.min(currentYear + 1, y + 1))}
          hitSlop={10}
          disabled={year >= currentYear + 1}
          style={{ padding: 6, opacity: year >= currentYear + 1 ? 0.3 : 1 }}
        >
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      {/* Переключатель периода */}
      <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Segmented value={tab} options={PERIOD_OPTIONS} onChange={setTab} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => load(year)} tintColor={T.green} />}
      >
        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && !data ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : data ? (
          <>
            {/* Герой: выручка периода + цель */}
            <GlowHero glow={T.green}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВЫРУЧКА · {PERIOD_OPTIONS.find((o) => o.key === tab)?.label.toUpperCase()}</Text>
              <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(orgFacts.revenue)}</Text>
              {revTarget.value > 0 ? (
                <View style={{ marginTop: S.md, gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: T.textMut, fontSize: 12.5 }}>
                      Цель {moneyShort(revTarget.value)}{revTarget.synthetic ? ' (Σ мес)' : ''}
                    </Text>
                    <Text style={{ color: (revPct || 0) >= 100 ? T.greenBright : T.amber, fontSize: 13, fontWeight: '900' }}>{revPct}%</Text>
                  </View>
                  <View style={{ height: 8, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: R.pill, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.max(3, Math.min(100, revPct || 0))}%`, height: 8, borderRadius: R.pill, backgroundColor: (revPct || 0) >= 100 ? T.green : T.amber }} />
                  </View>
                </View>
              ) : (
                <Text style={{ color: T.textDim, fontSize: 12, marginTop: 8 }}>Цель по выручке не задана</Text>
              )}
            </GlowHero>

            {/* KPI плитки */}
            <View style={{ flexDirection: 'row', gap: S.md }}>
              <Card style={{ flex: 1, padding: S.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="cash-outline" size={14} color={T.amber} />
                  <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>Прибыль</Text>
                </View>
                <Text style={{ color: orgFacts.profit >= 0 ? T.amber : T.red, fontSize: 19, fontWeight: '900', marginTop: 6 }}>{money(orgFacts.profit)}</Text>
                {profitTarget.value > 0 ? (
                  <Text style={{ color: T.textDim, fontSize: 11, marginTop: 3 }}>
                    цель {moneyShort(profitTarget.value)}
                  </Text>
                ) : null}
              </Card>
              <Card style={{ flex: 1, padding: S.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="pie-chart-outline" size={14} color={T.cyan} />
                  <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>Маржа</Text>
                </View>
                <Text style={{ color: orgFacts.margin >= 0 ? T.cyan : T.red, fontSize: 19, fontWeight: '900', marginTop: 6 }}>{orgFacts.margin}%</Text>
                <Text style={{ color: T.textDim, fontSize: 11, marginTop: 3 }}>{orgFacts.checks} чеков</Text>
              </Card>
            </View>

            {/* Помесячная разбивка */}
            {tab === 'year' ? (
              <View>
                <SectionTitle hint={`${year}`}>По месяцам</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 4 }}>
                  {MONTH_FULL.map((mLabel, idx) => {
                    const { start, end } = periodBounds('month', year, idx)
                    const f = computeFacts(daily, null, start, end)
                    const plan = plans.find((p) => p.period_kind === 'month' && p.metric === 'revenue' && !p.company_id && p.period_start.slice(5, 7) === String(idx + 1).padStart(2, '0'))
                    const target = Number(plan?.target_amount || 0)
                    const pct = target > 0 ? Math.round((f.revenue / target) * 1000) / 10 : null
                    return (
                      <View key={idx} style={{ paddingVertical: 11, borderBottomWidth: idx < 11 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <Text style={{ color: T.text, fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>{mLabel}</Text>
                          <Text style={{ color: f.revenue > 0 ? T.greenBright : T.textDim, fontSize: 14, fontWeight: '800' }}>{f.revenue > 0 ? moneyShort(f.revenue) : '—'}</Text>
                        </View>
                        {pct != null ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                            <View style={{ flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: R.pill, overflow: 'hidden' }}>
                              <View style={{ width: `${Math.max(3, Math.min(100, pct))}%`, height: 6, borderRadius: R.pill, backgroundColor: pct >= 100 ? T.green : T.amber }} />
                            </View>
                            <Text style={{ color: pct >= 100 ? T.greenBright : T.amber, fontSize: 11, fontWeight: '800', width: 44, textAlign: 'right' }}>{pct}%</Text>
                          </View>
                        ) : null}
                      </View>
                    )
                  })}
                </Card>
              </View>
            ) : null}

            {/* По точкам */}
            {byCompany.length > 0 ? (
              <View>
                <SectionTitle hint={moneyShort(orgFacts.revenue)}>По точкам</SectionTitle>
                <Card style={{ gap: S.md }}>
                  {byCompany.map((row) => (
                    <View key={row.company.id} style={{ gap: 4 }}>
                      <BarRow
                        label={row.company.name}
                        value={row.facts.revenue}
                        max={maxCompanyRev}
                        color={row.pct != null && row.pct >= 100 ? T.green : T.greenBright}
                        valueLabel={moneyShort(row.facts.revenue)}
                      />
                      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={{ color: T.textDim, fontSize: 11 }}>прибыль {moneyShort(row.facts.profit)} · маржа {row.facts.margin}%</Text>
                        {row.pct != null ? (
                          <Pill text={`план ${row.pct}%`} tone={row.pct >= 100 ? 'good' : 'warn'} />
                        ) : null}
                      </View>
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}

            {orgFacts.revenue === 0 && byCompany.every((r) => r.facts.revenue === 0) ? (
              <Card style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
                <Ionicons name="flag-outline" size={36} color={T.textDim} />
                <Text style={{ color: T.textMut, fontSize: 14 }}>За этот период активности нет</Text>
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
