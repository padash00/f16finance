import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, Segmented, BarRow } from '@/components/ui'

type PaymentMethod = 'cash' | 'kaspi' | 'card' | 'online'

type Anomaly = {
  date: string
  type: 'income_high' | 'income_low' | 'expense_high'
  amount: number
  avgForDay: number
  paymentMethod?: PaymentMethod
}

type DayAverage = { dow: number; income: number; expense: number }
type PaymentTrend = { method: PaymentMethod; total: number; percentage: number; trend: 'up' | 'down' | 'stable'; color: string }

type AnalysisResult = {
  dataRangeStart: string
  dataRangeEnd: string
  confidenceScore: number
  trendIncome: number
  avgIncome: number
  avgMargin: number
  totalIncome: number
  totalExpense: number
  totalForecastIncome: number
  totalForecastProfit: number
  paymentTrends: PaymentTrend[]
  onlineShare: number
  cashlessShare: number
  totalPlanIncome: number
  planIncomeAchievementPct: number
  seasonalityStrength: number
  growthRate: number
  riskLevel: 'low' | 'medium' | 'high'
  recommendedActions: string[]
  dayAverages: DayAverage[]
  anomalies: Anomaly[]
}

type Resp = {
  expenseCategories?: Record<string, number>
  plansWarning?: string | null
  analysis?: { excludeZeroDays: AnalysisResult | null; includeZeroDays: AnalysisResult | null } | null
  range?: { from: string; to: string }
}

type RangeKey = '30' | '90' | '180' | '365'

const RANGE_OPTS: { key: RangeKey; label: string }[] = [
  { key: '30', label: '30д' },
  { key: '90', label: '90д' },
  { key: '180', label: '180д' },
  { key: '365', label: '365д' },
]

const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

const RISK: Record<string, { text: string; tone: 'good' | 'warn' | 'bad' }> = {
  low: { text: 'Риск: низкий', tone: 'good' },
  medium: { text: 'Риск: средний', tone: 'warn' },
  high: { text: 'Риск: высокий', tone: 'bad' },
}

const PAY_LABEL: Record<PaymentMethod, string> = {
  cash: 'Наличные',
  kaspi: 'Безналичный',
  card: 'Карта',
  online: 'Онлайн',
}

const fmtDay = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'

const ANOM: Record<Anomaly['type'], { text: string; tone: 'good' | 'bad' | 'warn' }> = {
  income_high: { text: '↑ Доход', tone: 'good' },
  income_low: { text: '↓ Доход', tone: 'bad' },
  expense_high: { text: '↑ Расход', tone: 'warn' },
}

export default function AnalysisScreen() {
  const router = useRouter()
  const [range, setRange] = useState<RangeKey>('90')
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (r: RangeKey) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Resp>(`/api/admin/analysis?range=${r}`)
      setData(res || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(range) }, [range, load])

  const a = useMemo(() => data?.analysis?.excludeZeroDays || null, [data])

  const profit = a ? a.totalIncome - a.totalExpense : 0

  const topExpenses = useMemo(() => {
    const cats = data?.expenseCategories || {}
    const entries = Object.entries(cats).filter(([, v]) => Number(v) > 0).sort((x, y) => Number(y[1]) - Number(x[1]))
    const top = entries.slice(0, 7).map(([name, value]) => ({ name, value: Number(value) }))
    const rest = entries.slice(7).reduce((s, [, v]) => s + Number(v), 0)
    if (rest > 0) top.push({ name: 'Другое', value: rest })
    return top
  }, [data])

  const maxExpense = useMemo(() => Math.max(1, ...topExpenses.map((x) => x.value)), [topExpenses])
  const maxDow = useMemo(() => Math.max(1, ...(a?.dayAverages || []).map((d) => d.income)), [a])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Анализ</Text>
      </View>

      <View style={{ paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Segmented value={range} options={RANGE_OPTS} onChange={setRange} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!a} onRefresh={() => load(range)} tintColor={T.green} />}
      >
        {loading && !a ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text>
          </Card>
        ) : !a ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="bar-chart-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>Нет данных</Text>
            <Text style={{ color: T.textMut, fontSize: 13 }}>Проверьте период и наличие операций</Text>
          </Card>
        ) : (
          <>
            {/* Прибыль за период */}
            <GlowHero glow={profit >= 0 ? T.green : T.red}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ПРИБЫЛЬ ЗА ПЕРИОД</Text>
              <Text style={{ color: T.text, fontSize: 36, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(profit)}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                <Pill text={`доход ${moneyShort(a.totalIncome)}`} tone="brand" />
                <Pill text={`расход ${moneyShort(a.totalExpense)}`} tone="mut" />
                {RISK[a.riskLevel] ? <Pill text={RISK[a.riskLevel].text} tone={RISK[a.riskLevel].tone} /> : null}
              </View>
              <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>
                {fmtDay(a.dataRangeStart)} — {fmtDay(a.dataRangeEnd)} · достоверность {Math.round(a.confidenceScore)}%
              </Text>
            </GlowHero>

            {data?.plansWarning ? (
              <Card style={{ borderColor: '#3a3212' }}>
                <Text style={{ color: T.amber, fontSize: 12.5 }}>{data.plansWarning}</Text>
              </Card>
            ) : null}

            {/* Ключевые метрики */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {[
                { label: 'Доход', v: moneyShort(a.totalIncome) },
                { label: 'Расход', v: moneyShort(a.totalExpense) },
                { label: 'Средняя маржа', v: `${a.avgMargin.toFixed(1)}%` },
                { label: 'Тренд', v: `${a.trendIncome >= 0 ? '+' : ''}${Math.round(a.trendIncome)} ₸/д` },
                { label: 'Прогноз доход', v: moneyShort(a.totalForecastIncome) },
                { label: 'Прогноз прибыль', v: moneyShort(a.totalForecastProfit) },
              ].map((m) => (
                <Card key={m.label} style={{ flexBasis: '47%', flexGrow: 1, paddingVertical: 12 }}>
                  <Text style={{ color: T.textDim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' }}>{m.label}</Text>
                  <Text style={{ color: T.text, fontSize: 17, fontWeight: '900', marginTop: 4 }}>{m.v}</Text>
                </Card>
              ))}
            </View>

            {/* Выполнение плана */}
            {a.totalPlanIncome > 0 ? (
              <Card style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: T.text, fontSize: 14, fontWeight: '800' }}>Выполнение плана дохода</Text>
                  <Text style={{ color: T.cyan, fontSize: 15, fontWeight: '900' }}>{Math.round(a.planIncomeAchievementPct)}%</Text>
                </View>
                <BarRow label="План" value={a.planIncomeAchievementPct} max={100} color={T.cyan} valueLabel={moneyShort(a.totalPlanIncome)} />
              </Card>
            ) : null}

            {/* Оплаты */}
            {a.paymentTrends?.length ? (
              <View style={{ gap: S.sm }}>
                <SectionTitle hint={`безнал ${a.cashlessShare.toFixed(0)}% · онлайн ${a.onlineShare.toFixed(0)}%`}>Структура оплат</SectionTitle>
                <Card style={{ gap: 10 }}>
                  {a.paymentTrends.map((p) => (
                    <BarRow
                      key={p.method}
                      label={PAY_LABEL[p.method]}
                      value={p.percentage}
                      max={100}
                      color={p.color || T.green}
                      valueLabel={`${p.percentage.toFixed(1)}% · ${moneyShort(p.total)}`}
                    />
                  ))}
                </Card>
              </View>
            ) : null}

            {/* Типичная неделя */}
            {a.dayAverages?.length ? (
              <View style={{ gap: S.sm }}>
                <SectionTitle hint={`средний день ${moneyShort(a.avgIncome)}`}>Типичная неделя</SectionTitle>
                <Card style={{ gap: 10 }}>
                  {a.dayAverages.map((d) => (
                    <BarRow
                      key={d.dow}
                      label={DOW[d.dow] || String(d.dow)}
                      value={d.income}
                      max={maxDow}
                      color={T.violet}
                      valueLabel={moneyShort(d.income)}
                    />
                  ))}
                </Card>
              </View>
            ) : null}

            {/* Сезонность / рост */}
            <View style={{ gap: S.sm }}>
              <SectionTitle>Сезонность и рост</SectionTitle>
              <Card style={{ gap: 10 }}>
                <BarRow label="Сезонность" value={a.seasonalityStrength} max={100} color={T.teal} valueLabel={`${a.seasonalityStrength.toFixed(0)}%`} />
                <BarRow
                  label="Рост (груб.)"
                  value={Math.min(Math.abs(a.growthRate), 100)}
                  max={100}
                  color={a.growthRate >= 0 ? T.green : T.red}
                  valueLabel={`${a.growthRate >= 0 ? '+' : ''}${a.growthRate.toFixed(1)}%`}
                />
              </Card>
            </View>

            {/* Категории расходов */}
            {topExpenses.length ? (
              <View style={{ gap: S.sm }}>
                <SectionTitle hint={moneyShort(a.totalExpense)}>Категории расходов</SectionTitle>
                <Card style={{ gap: 10 }}>
                  {topExpenses.map((c) => (
                    <BarRow key={c.name} label={c.name} value={c.value} max={maxExpense} color={T.red} valueLabel={moneyShort(c.value)} />
                  ))}
                </Card>
              </View>
            ) : null}

            {/* Аномалии */}
            <View style={{ gap: S.sm }}>
              <SectionTitle hint="отклонения от нормы">Аномалии</SectionTitle>
              {a.anomalies?.length ? (
                <Card style={{ gap: 2, paddingVertical: 4 }}>
                  {a.anomalies.map((an, i, arr) => {
                    const meta = ANOM[an.type]
                    return (
                      <View key={`${an.date}-${i}`} style={{ paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }}>{fmtDay(an.date)}</Text>
                          <Pill text={meta?.text || an.type} tone={meta?.tone || 'mut'} />
                        </View>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 3 }}>
                          {money(an.amount)} (норма: {money(an.avgForDay)})
                          {an.paymentMethod ? ` · ${PAY_LABEL[an.paymentMethod]}` : ''}
                        </Text>
                      </View>
                    )
                  })}
                </Card>
              ) : (
                <Card style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
                  <Ionicons name="checkmark-done-circle" size={34} color={T.green} />
                  <Text style={{ color: T.textMut, fontSize: 13 }}>Аномалий не выявлено</Text>
                </Card>
              )}
            </View>

            {/* Рекомендации */}
            {a.recommendedActions?.length ? (
              <View style={{ gap: S.sm }}>
                <SectionTitle hint="эвристики">Рекомендации</SectionTitle>
                <Card style={{ gap: 10 }}>
                  {a.recommendedActions.map((t, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                      <Ionicons name="ellipse" size={7} color={T.green} style={{ marginTop: 6 }} />
                      <Text style={{ color: T.textMut, fontSize: 13, flex: 1, lineHeight: 19 }}>{t}</Text>
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
