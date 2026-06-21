import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, BarRow, ErrorState, EmptyState } from '@/components/ui'

type CompanyBreakdown = {
  cash: number
  kaspi: number
  card: number
  online: number
  revenue: number
  checks_count: number
}

type MonthlyAggregate = {
  month: string
  cash: number
  kaspi: number
  card: number
  online: number
  revenue: number
  expenses: number
  profit: number
  margin_pct: number
  checks_count: number
  avg_check: number
  by_company: Record<string, CompanyBreakdown>
}

type Company = { id: string; name: string; code?: string | null }

type Resp = {
  year: number
  companies: Company[]
  months: MonthlyAggregate[]
  previousYear: Array<{ month: string; revenue: number }>
}

const MONTH_SHORT_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const MONTH_FULL_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

const monthShort = (key: string) => MONTH_SHORT_RU[parseInt(key.slice(5, 7), 10) - 1] || key
const monthFull = (key: string) => MONTH_FULL_RU[parseInt(key.slice(5, 7), 10) - 1] || key

export default function AnalyticsScreen() {
  const router = useRouter()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [d, setD] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (y: number) => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<{ ok?: boolean; data?: Resp }>(`/api/admin/analytics/monthly?year=${y}`)
      setD(res.data || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить аналитику')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(year) }, [year, load])

  const months = useMemo(() => d?.months || [], [d])
  const previousYear = useMemo(() => d?.previousYear || [], [d])
  const companies = useMemo(() => d?.companies || [], [d])

  const totals = useMemo(() => {
    const revenue = months.reduce((s, m) => s + Number(m.revenue || 0), 0)
    const expenses = months.reduce((s, m) => s + Number(m.expenses || 0), 0)
    const profit = revenue - expenses
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0
    const checks = months.reduce((s, m) => s + Number(m.checks_count || 0), 0)
    const avgCheck = checks > 0 ? revenue / checks : 0
    const cash = months.reduce((s, m) => s + Number(m.cash || 0), 0)
    const cashless = months.reduce((s, m) => s + Number(m.kaspi || 0) + Number(m.card || 0) + Number(m.online || 0), 0)
    const prevTotal = previousYear.reduce((s, m) => s + Number(m.revenue || 0), 0)
    const yoyPct = prevTotal > 0 ? ((revenue - prevTotal) / prevTotal) * 100 : 0
    const best = months.reduce<{ month: string | null; revenue: number }>(
      (acc, m) => (Number(m.revenue || 0) > acc.revenue ? { month: m.month, revenue: Number(m.revenue || 0) } : acc),
      { month: null, revenue: 0 },
    )
    const worst = months
      .filter((m) => Number(m.revenue || 0) > 0)
      .reduce<{ month: string | null; revenue: number }>(
        (acc, m) => (acc.month === null || Number(m.revenue || 0) < acc.revenue ? { month: m.month, revenue: Number(m.revenue || 0) } : acc),
        { month: null, revenue: 0 },
      )
    return { revenue, expenses, profit, margin, checks, avgCheck, cash, cashless, prevTotal, yoyPct, best, worst }
  }, [months, previousYear])

  const maxRevenue = useMemo(() => months.reduce((m, x) => Math.max(m, Number(x.revenue || 0)), 0), [months])

  // выручка по точкам за год
  const byCompany = useMemo(() => {
    return companies
      .map((c) => ({
        id: c.id,
        name: c.name || '—',
        revenue: months.reduce((s, m) => s + Number(m.by_company?.[c.id]?.revenue || 0), 0),
        checks: months.reduce((s, m) => s + Number(m.by_company?.[c.id]?.checks_count || 0), 0),
      }))
      .filter((c) => c.revenue > 0 || c.checks > 0)
      .sort((a, b) => b.revenue - a.revenue)
  }, [companies, months])
  const maxCompanyRevenue = useMemo(() => byCompany.reduce((m, x) => Math.max(m, x.revenue), 0), [byCompany])

  const activeMonths = useMemo(() => months.filter((m) => Number(m.revenue || 0) > 0 || Number(m.expenses || 0) > 0 || Number(m.checks_count || 0) > 0), [months])

  const isCurrentYear = year >= currentYear

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Аналитика</Text>
      </View>

      {/* выбор года */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Pressable onPress={() => setYear((y) => y - 1)} hitSlop={10} style={{ padding: 6 }}><Ionicons name="chevron-back" size={20} color={T.textMut} /></Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }}>{year}</Text>
        <Pressable
          onPress={() => !isCurrentYear && setYear((y) => Math.min(currentYear, y + 1))}
          hitSlop={10}
          disabled={isCurrentYear}
          style={{ padding: 6, opacity: isCurrentYear ? 0.3 : 1 }}
        >
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={() => load(year)} tintColor={T.green} />}
      >
        {loading && !d ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => load(year)} />
        ) : d ? (
          <>
            {/* Ключевая сумма — выручка за год */}
            <GlowHero glow={T.green}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВЫРУЧКА ЗА {year}</Text>
              <Text style={{ color: T.text, fontSize: 36, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(totals.revenue)}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                <Pill text={`прибыль ${moneyShort(totals.profit)}`} tone={totals.profit >= 0 ? 'good' : 'bad'} />
                <Pill text={`маржа ${totals.margin.toFixed(1)}%`} tone={totals.margin >= 0 ? 'brand' : 'bad'} />
                {totals.prevTotal > 0 ? (
                  <Pill text={`${totals.yoyPct >= 0 ? '↑' : '↓'} ${Math.abs(totals.yoyPct).toFixed(1)}% к ${year - 1}`} tone={totals.yoyPct >= 0 ? 'good' : 'bad'} />
                ) : null}
              </View>
            </GlowHero>

            {/* KPI плитки */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              <Card style={{ flexGrow: 1, flexBasis: '47%', gap: 4 }}>
                <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>Расходы</Text>
                <Text style={{ color: T.red, fontSize: 18, fontWeight: '900' }}>{money(totals.expenses)}</Text>
              </Card>
              <Card style={{ flexGrow: 1, flexBasis: '47%', gap: 4 }}>
                <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>Прибыль</Text>
                <Text style={{ color: totals.profit >= 0 ? T.greenBright : T.red, fontSize: 18, fontWeight: '900' }}>{money(totals.profit)}</Text>
              </Card>
              <Card style={{ flexGrow: 1, flexBasis: '47%', gap: 4 }}>
                <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>Чеков</Text>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: '900' }}>{totals.checks.toLocaleString('ru-RU')}</Text>
              </Card>
              <Card style={{ flexGrow: 1, flexBasis: '47%', gap: 4 }}>
                <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>Средний чек</Text>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: '900' }}>{money(totals.avgCheck)}</Text>
              </Card>
            </View>

            {/* Лучший / худший месяц */}
            {(totals.best.month || totals.worst.month) ? (
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Card style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: T.greenBright, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>Лучший месяц</Text>
                  <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{totals.best.month ? monthFull(totals.best.month) : '—'}</Text>
                  <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700' }}>{moneyShort(totals.best.revenue)}</Text>
                </Card>
                <Card style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: T.red, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>Худший месяц</Text>
                  <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{totals.worst.month ? monthFull(totals.worst.month) : '—'}</Text>
                  <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700' }}>{moneyShort(totals.worst.revenue)}</Text>
                </Card>
              </View>
            ) : null}

            {/* Способы оплаты за год */}
            <View>
              <SectionTitle hint={moneyShort(totals.cash + totals.cashless)}>Способы оплаты</SectionTitle>
              <Card style={{ gap: S.md }}>
                <BarRow label="Наличные" value={totals.cash} max={Math.max(totals.cash, totals.cashless)} color={T.green} valueLabel={moneyShort(totals.cash)} />
                <BarRow label="Безналичные" value={totals.cashless} max={Math.max(totals.cash, totals.cashless)} color={T.blue} valueLabel={moneyShort(totals.cashless)} />
              </Card>
            </View>

            {/* Выручка по точкам */}
            {byCompany.length > 0 ? (
              <View>
                <SectionTitle hint={`${year}`}>Выручка по точкам</SectionTitle>
                <Card style={{ gap: S.md }}>
                  {byCompany.map((c) => (
                    <BarRow
                      key={c.id}
                      label={c.name}
                      value={c.revenue}
                      max={maxCompanyRevenue || 1}
                      color={T.teal}
                      valueLabel={moneyShort(c.revenue)}
                    />
                  ))}
                </Card>
              </View>
            ) : null}

            {/* Выручка по месяцам */}
            {activeMonths.length > 0 ? (
              <View>
                <SectionTitle hint={`${activeMonths.length} мес.`}>Выручка по месяцам</SectionTitle>
                <Card style={{ gap: S.md }}>
                  {activeMonths.map((m) => (
                    <BarRow
                      key={m.month}
                      label={monthShort(m.month)}
                      value={Number(m.revenue || 0)}
                      max={maxRevenue || 1}
                      color={T.green}
                      valueLabel={moneyShort(Number(m.revenue || 0))}
                    />
                  ))}
                </Card>
              </View>
            ) : null}

            {/* Прибыль и маржа по месяцам */}
            {activeMonths.length > 0 ? (
              <View>
                <SectionTitle>Прибыль по месяцам</SectionTitle>
                <Card style={{ padding: 0 }}>
                  {activeMonths.map((m, i, arr) => {
                    const profit = Number(m.profit || 0)
                    const positive = profit >= 0
                    return (
                      <View
                        key={m.month}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: 14,
                          borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                          borderBottomColor: T.borderSoft,
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }}>{monthFull(m.month)}</Text>
                          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }}>
                            {Number(m.checks_count || 0).toLocaleString('ru-RU')} чеков · ср. {moneyShort(Number(m.avg_check || 0))}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: positive ? T.greenBright : T.red, fontSize: 15, fontWeight: '800' }}>{money(profit)}</Text>
                          <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700', marginTop: 1 }}>маржа {Number(m.margin_pct || 0).toFixed(1)}%</Text>
                        </View>
                      </View>
                    )
                  })}
                </Card>
              </View>
            ) : null}

            {activeMonths.length === 0 ? (
              <EmptyState icon="bar-chart-outline" title={`Нет данных за ${year}`} />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
