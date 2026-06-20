import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, BarRow } from '@/components/ui'

type Projected = {
  month0Label?: string
  month0Income?: number
  month0Expense?: number
  month0Fact?: { income: number; expense: number }
  month0RemainingDays?: number
  month1Label?: string
  month1Income?: number
  month1Expense?: number
  month1Days?: number
  month2Label?: string
  month2Income?: number
  month2Expense?: number
  month2Days?: number
  week4Income?: number
  week4Expense?: number
  week8Income?: number
  week8Expense?: number
  week13Income?: number
  week13Expense?: number
}

type Forecast = {
  text?: string
  dateFrom?: string
  dateTo?: string
  projected?: Projected
  comparison?: {
    last30: { income: number; expense: number; profit: number; margin: number }
    prev30: { income: number; expense: number; profit: number; margin: number }
    momentum: { income: number; expense: number; profit: number }
  }
  categories?: Array<{ category: string; total: number; count: number; recent: number; older: number; share: number }>
  outliers?: Array<{ date: string; category: string; amount: number; comment: string | null }>
  seasonality?: {
    byDay: Array<{ name: string; avg: number }>
    best?: { name: string; avg: number }
    worst?: { name: string; avg: number }
  }
  kpi?: { plan: number; actual: number; progress: number } | null
}

const fmtDay = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—')
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

// Месяцы, упорядоченные по будням Пн..Вс для сезонности
const DAY_ORDER = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export default function ForecastScreen() {
  const router = useRouter()
  const [d, setD] = useState<Forecast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Не-стрим режим: возвращает весь структурированный прогноз + текст одним JSON.
      const res = await apiFetch<Forecast>('/api/ai/forecast', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setD(res || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить прогноз')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const proj = d?.projected || {}

  // Карточки прогноза по календарным месяцам (или fallback на 30/60/90)
  const months = useMemo(() => {
    if (proj.month0Label && proj.month1Label && proj.month2Label) {
      return [
        {
          label: cap(proj.month0Label),
          sub: proj.month0RemainingDays ? `факт + прогноз на ${proj.month0RemainingDays} дн.` : 'этот месяц',
          income: Number(proj.month0Income || 0),
          expense: Number(proj.month0Expense || 0),
          fact: proj.month0Fact,
          tone: 'brand' as const,
        },
        {
          label: cap(proj.month1Label),
          sub: proj.month1Days ? `${proj.month1Days} дн.` : 'следующий месяц',
          income: Number(proj.month1Income || 0),
          expense: Number(proj.month1Expense || 0),
          fact: undefined,
          tone: 'warn' as const,
        },
        {
          label: cap(proj.month2Label),
          sub: proj.month2Days ? `${proj.month2Days} дн.` : 'через месяц',
          income: Number(proj.month2Income || 0),
          expense: Number(proj.month2Expense || 0),
          fact: undefined,
          tone: 'warn' as const,
        },
      ]
    }
    return [
      { label: '30 дней', sub: 'прогноз', income: Number(proj.week4Income || 0), expense: Number(proj.week4Expense || 0), fact: undefined, tone: 'brand' as const },
      { label: '60 дней', sub: 'прогноз', income: Number(proj.week8Income || 0), expense: Number(proj.week8Expense || 0), fact: undefined, tone: 'warn' as const },
      { label: '90 дней', sub: 'прогноз', income: Number(proj.week13Income || 0), expense: Number(proj.week13Expense || 0), fact: undefined, tone: 'warn' as const },
    ]
  }, [proj])

  const hero = months[0]
  const heroProfit = hero ? hero.income - hero.expense : 0

  const seasonDays = useMemo(() => {
    const byName = new Map<string, number>()
    for (const day of d?.seasonality?.byDay || []) byName.set(day.name, Number(day.avg || 0))
    return DAY_ORDER.map((name) => ({ name, avg: byName.get(name) || 0 }))
  }, [d])
  const seasonMax = Math.max(1, ...seasonDays.map((x) => x.avg))
  const hasSeason = seasonDays.some((x) => x.avg > 0)

  const catMax = Math.max(1, ...(d?.categories || []).map((c) => Number(c.total || 0)))

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Прогноз</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={() => load()} tintColor={T.green} />}
      >
        {loading && !d ? (
          <View style={{ marginTop: 50, alignItems: 'center', gap: 12 }}>
            <ActivityIndicator color={T.green} />
            <Text style={{ color: T.textMut, fontSize: 13 }}>ИИ анализирует 90 дней данных…</Text>
          </View>
        ) : error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : d ? (
          <>
            {/* Герой: прогноз текущего месяца */}
            {hero ? (
              <GlowHero glow={T.violet}>
                <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ПРОГНОЗ · {hero.label.toUpperCase()}</Text>
                <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(hero.income)}</Text>
                <Text style={{ color: T.textMut, fontSize: 12, marginTop: 2 }}>{hero.sub}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                  <Pill text={`расход ${moneyShort(hero.expense)}`} tone="bad" />
                  <Pill text={`прибыль ${heroProfit >= 0 ? '+' : ''}${moneyShort(heroProfit)}`} tone={heroProfit >= 0 ? 'good' : 'bad'} />
                </View>
                {d.dateFrom && d.dateTo ? (
                  <Text style={{ color: T.textDim, fontSize: 11, marginTop: 10 }}>База: {fmtDay(d.dateFrom)} — {fmtDay(d.dateTo)}</Text>
                ) : null}
              </GlowHero>
            ) : null}

            {/* Карточки по месяцам */}
            <SectionTitle>По месяцам</SectionTitle>
            <Card style={{ padding: 0 }}>
              {months.map((m, i) => {
                const profit = m.income - m.expense
                return (
                  <View key={m.label + i} style={{ padding: 14, borderBottomWidth: i < months.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{m.label}</Text>
                        <Text style={{ color: T.textDim, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{m.sub}</Text>
                      </View>
                      <Pill text="AI" tone="brand" />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
                      <View>
                        <Text style={{ color: T.textDim, fontSize: 11 }}>Выручка</Text>
                        <Text style={{ color: T.greenBright, fontSize: 14, fontWeight: '800', marginTop: 1 }}>{moneyShort(m.income)}</Text>
                      </View>
                      <View>
                        <Text style={{ color: T.textDim, fontSize: 11 }}>Расходы</Text>
                        <Text style={{ color: T.red, fontSize: 14, fontWeight: '800', marginTop: 1 }}>{moneyShort(m.expense)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: T.textDim, fontSize: 11 }}>Прибыль</Text>
                        <Text style={{ color: profit >= 0 ? T.amber : T.red, fontSize: 14.5, fontWeight: '900', marginTop: 1 }}>
                          {profit >= 0 ? '+' : ''}{moneyShort(profit)}
                        </Text>
                      </View>
                    </View>
                    {m.fact && (Number(m.fact.income) > 0 || Number(m.fact.expense) > 0) ? (
                      <Text style={{ color: T.textDim, fontSize: 11, marginTop: 8 }}>
                        Уже факт: {moneyShort(m.fact.income)} − {moneyShort(m.fact.expense)}
                      </Text>
                    ) : null}
                  </View>
                )
              })}
            </Card>

            {/* Сравнение 30 vs пред. 30 */}
            {d.comparison ? (
              <>
                <SectionTitle hint="30 дн. vs пред. 30 дн.">Что изменилось</SectionTitle>
                <Card style={{ gap: 0, padding: 0 }}>
                  {[
                    { label: 'Выручка', value: d.comparison.last30.income, prev: d.comparison.prev30.income, mom: d.comparison.momentum.income, invert: false },
                    { label: 'Расходы', value: d.comparison.last30.expense, prev: d.comparison.prev30.expense, mom: d.comparison.momentum.expense, invert: true },
                    { label: 'Прибыль', value: d.comparison.last30.profit, prev: d.comparison.prev30.profit, mom: d.comparison.momentum.profit, invert: false },
                  ].map((m, i, arr) => {
                    const good = m.invert ? Number(m.mom) < 0 : Number(m.mom) >= 0
                    const arrow = Number(m.mom) > 0 ? '↑' : Number(m.mom) < 0 ? '↓' : '→'
                    return (
                      <View key={m.label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 14, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }}>{m.label}</Text>
                          <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>было {moneyShort(m.prev)}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{money(m.value)}</Text>
                          <Text style={{ color: good ? T.greenBright : T.red, fontSize: 12, fontWeight: '800', marginTop: 2 }}>
                            {arrow} {Math.abs(Number(m.mom || 0)).toFixed(1)}%
                          </Text>
                        </View>
                      </View>
                    )
                  })}
                  <View style={{ flexDirection: 'row', gap: 8, padding: 14, paddingTop: 12 }}>
                    <Pill text={`маржа ${Number(d.comparison.last30.margin || 0).toFixed(1)}%`} tone="brand" />
                    <Pill text={`было ${Number(d.comparison.prev30.margin || 0).toFixed(1)}%`} tone="mut" />
                  </View>
                </Card>
              </>
            ) : null}

            {/* KPI план */}
            {d.kpi ? (
              <>
                <SectionTitle hint={`${Number(d.kpi.progress || 0).toFixed(0)}%`}>KPI план на месяц</SectionTitle>
                <Card>
                  <BarRow
                    label={`из ${money(d.kpi.plan)}`}
                    value={Number(d.kpi.actual || 0)}
                    max={Number(d.kpi.plan || 0)}
                    color={Number(d.kpi.progress) >= 80 ? T.green : Number(d.kpi.progress) >= 50 ? T.amber : T.red}
                    valueLabel={money(d.kpi.actual)}
                  />
                </Card>
              </>
            ) : null}

            {/* Топ категорий расходов */}
            {d.categories && d.categories.length > 0 ? (
              <>
                <SectionTitle hint="последние 90 дн.">Топ категорий расходов</SectionTitle>
                <Card style={{ gap: S.md }}>
                  {d.categories.map((c) => {
                    const lumpy = Number(c.count) < 3 || Number(c.older) === 0 || Number(c.recent) === 0
                    const trend = !lumpy && Number(c.older) > 0 ? ((Number(c.recent) - Number(c.older)) / Number(c.older)) * 100 : 0
                    const trendTxt = lumpy
                      ? (Number(c.count) < 3 ? 'разовое' : '—')
                      : `${Math.abs(trend) < 10 ? '→' : trend > 0 ? '↑' : '↓'} ${trend > 0 ? '+' : ''}${trend.toFixed(0)}%`
                    return (
                      <BarRow
                        key={c.category}
                        label={`${c.category} · ${c.count} оп. · ${trendTxt}`}
                        value={Number(c.total || 0)}
                        max={catMax}
                        color={T.amber}
                        valueLabel={moneyShort(c.total)}
                      />
                    )
                  })}
                </Card>
              </>
            ) : null}

            {/* Сезонность по дням недели */}
            {hasSeason ? (
              <>
                <SectionTitle hint="средняя выручка/день">Сезонность по дням</SectionTitle>
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 110, gap: 6 }}>
                    {seasonDays.map((day) => {
                      const isBest = d?.seasonality?.best?.name === day.name && day.avg > 0
                      const isWorst = d?.seasonality?.worst?.name === day.name && day.avg > 0
                      const h = Math.max(6, Math.round((day.avg / seasonMax) * 88))
                      const color = isBest ? T.green : isWorst ? T.red : 'rgba(251,191,36,0.7)'
                      return (
                        <View key={day.name} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                          <View style={{ width: '100%', height: 88, justifyContent: 'flex-end' }}>
                            <View style={{ width: '100%', height: h, borderRadius: 6, backgroundColor: color }} />
                          </View>
                          <Text style={{ color: isBest ? T.greenBright : isWorst ? T.red : T.textMut, fontSize: 11, fontWeight: '700' }}>{day.name}</Text>
                        </View>
                      )
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                    {d?.seasonality?.best ? <Pill text={`лучший ${d.seasonality.best.name} · ${moneyShort(d.seasonality.best.avg)}`} tone="good" /> : null}
                    {d?.seasonality?.worst ? <Pill text={`худший ${d.seasonality.worst.name}`} tone="bad" /> : null}
                  </View>
                </Card>
              </>
            ) : null}

            {/* Крупные нерегулярные расходы */}
            {d.outliers && d.outliers.length > 0 ? (
              <>
                <SectionTitle hint="разовые траты">Крупные расходы</SectionTitle>
                <Card style={{ padding: 0 }}>
                  {d.outliers.map((o, i, arr) => (
                    <View key={`${o.date}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ width: 3, height: 34, borderRadius: 3, backgroundColor: T.amber }} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{o.category}</Text>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                          {fmtDay(o.date)}{o.comment ? ` · ${o.comment}` : ''}
                        </Text>
                      </View>
                      <Text style={{ color: T.amber, fontSize: 14.5, fontWeight: '800' }}>{money(o.amount)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* AI-анализ */}
            {d.text && d.text.trim().length > 0 ? (
              <>
                <SectionTitle>AI-анализ</SectionTitle>
                <Card style={{ borderColor: 'rgba(139,92,246,0.3)' }}>
                  <Text style={{ color: T.textMut, fontSize: 13.5, lineHeight: 21 }}>{d.text.trim()}</Text>
                </Card>
              </>
            ) : null}
          </>
        ) : (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="trending-up-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Прогноз недоступен</Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
