import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, Segmented } from '@/components/ui'

type RankingItem = {
  operator_id: string
  operator_name: string
  operator_short_name: string | null
  shifts: number
  total_revenue: number
  avg_revenue_per_shift: number
  pi: number
  qualifying: boolean
}

type ApiData = {
  ranking?: RankingItem[]
  baseline?: { from?: string; to?: string; shifts_count?: number; slots_count?: number; global_median?: number }
  period?: { from: string; to: string }
  config?: { min_qualifying_shifts?: number }
}

type PeriodKey = 'thisMonth' | 'lastMonth' | 'thisWeek' | 'lastWeek' | 'thisYear'

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const PERIODS: { key: PeriodKey; label: string; range: () => { from: string; to: string } }[] = [
  {
    key: 'thisWeek',
    label: 'Неделя',
    range: () => {
      const now = new Date()
      const day = now.getDay() === 0 ? 7 : now.getDay()
      const monday = new Date(now)
      monday.setDate(now.getDate() - (day - 1))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: iso(monday), to: iso(sunday) }
    },
  },
  {
    key: 'lastWeek',
    label: 'Пр. неделя',
    range: () => {
      const now = new Date()
      const day = now.getDay() === 0 ? 7 : now.getDay()
      const monday = new Date(now)
      monday.setDate(now.getDate() - (day - 1) - 7)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: iso(monday), to: iso(sunday) }
    },
  },
  {
    key: 'thisMonth',
    label: 'Месяц',
    range: () => {
      const now = new Date()
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      }
    },
  },
  {
    key: 'lastMonth',
    label: 'Пр. месяц',
    range: () => {
      const now = new Date()
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    },
  },
  {
    key: 'thisYear',
    label: 'Год',
    range: () => {
      const now = new Date()
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(new Date(now.getFullYear(), 11, 31)) }
    },
  },
]

function piTone(pi: number): { color: string; label: string } {
  if (pi >= 1.15) return { color: T.greenBright, label: 'Превосходно' }
  if (pi >= 1.05) return { color: T.green, label: 'Хорошо' }
  if (pi >= 0.95) return { color: T.textMut, label: 'Норма' }
  if (pi >= 0.85) return { color: T.amber, label: 'Ниже нормы' }
  return { color: T.red, label: 'Слабо' }
}

function pillTone(pi: number): 'good' | 'bad' | 'warn' | 'mut' {
  if (pi >= 1.05) return 'good'
  if (pi >= 0.95) return 'mut'
  if (pi >= 0.85) return 'warn'
  return 'bad'
}

function rankIcon(rank: number): { name: keyof typeof Ionicons.glyphMap; color: string } | null {
  if (rank === 1) return { name: 'trophy', color: T.amber }
  if (rank === 2) return { name: 'medal', color: T.textMut }
  if (rank === 3) return { name: 'medal-outline', color: '#d68a4e' }
  return null
}

export default function PerformanceScreen() {
  const router = useRouter()
  const [period, setPeriod] = useState<PeriodKey>('thisMonth')
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (key: PeriodKey) => {
    setLoading(true)
    setError(null)
    const preset = PERIODS.find((p) => p.key === key) || PERIODS[2]
    const { from, to } = preset.range()
    try {
      const res = await apiFetch<{ data: ApiData }>(
        `/api/admin/performance/ranking?from=${from}&to=${to}`,
      )
      setData(res?.data || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(period)
  }, [period, load])

  const ranking = data?.ranking || []
  const minShifts = data?.config?.min_qualifying_shifts || 3

  const qualifying = useMemo(() => ranking.filter((r) => r.qualifying), [ranking])
  const coldStart = useMemo(() => ranking.filter((r) => !r.qualifying), [ranking])
  const leader = qualifying[0] || null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: S.lg,
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Рейтинг операторов</Text>
      </View>

      <View style={{ paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Segmented
          value={period}
          options={PERIODS.map((p) => ({ key: p.key, label: p.label }))}
          onChange={(k) => setPeriod(k as PeriodKey)}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={
          <RefreshControl
            refreshing={loading && !!data}
            onRefresh={() => load(period)}
            tintColor={T.green}
          />
        }
      >
        {loading && !data ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text>
          </Card>
        ) : (
          <>
            {leader ? (
              <GlowHero glow={T.violet}>
                <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>
                  ЛИДЕР ПО PI
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 6 }}>
                  <Ionicons name="trophy" size={26} color={T.amber} />
                  <Text style={{ color: T.text, fontSize: 26, fontWeight: '900', flex: 1, letterSpacing: -0.5 }} numberOfLines={1}>
                    {leader.operator_short_name || leader.operator_name}
                  </Text>
                  <Text style={{ color: piTone(leader.pi).color, fontSize: 34, fontWeight: '900' }}>
                    {leader.pi.toFixed(2)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                  <Pill text={`${leader.shifts} смен`} tone="mut" />
                  <Pill text={moneyShort(leader.total_revenue)} tone="brand" />
                  <Pill text={piTone(leader.pi).label} tone={pillTone(leader.pi)} />
                </View>
              </GlowHero>
            ) : null}

            {data?.baseline ? (
              <Card style={{ gap: 4 }}>
                <Text style={{ color: T.textMut, fontSize: 12 }}>
                  PI = факт / ожидание. Сравнение по слоту: точка × день недели × день/ночь.
                </Text>
                <Text style={{ color: T.textDim, fontSize: 11.5, marginTop: 2 }}>
                  База: {data.baseline.shifts_count ?? 0} смен в {data.baseline.slots_count ?? 0} слотах · медиана{' '}
                  {moneyShort(data.baseline.global_median || 0)}
                </Text>
              </Card>
            ) : null}

            {ranking.length === 0 ? (
              <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
                <Ionicons name="trophy-outline" size={38} color={T.textDim} />
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>Нет данных за период</Text>
                <Text style={{ color: T.textMut, fontSize: 13 }}>Смен с выручкой не найдено</Text>
              </Card>
            ) : null}

            {qualifying.length > 0 ? (
              <View style={{ gap: S.sm }}>
                <SectionTitle hint={`${qualifying.length}`}>Основной рейтинг</SectionTitle>
                <Card style={{ padding: 0 }}>
                  {qualifying.map((op, i, arr) => {
                    const tone = piTone(op.pi)
                    const badge = rankIcon(i + 1)
                    return (
                      <View
                        key={op.operator_id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          padding: 14,
                          borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                          borderBottomColor: T.borderSoft,
                        }}
                      >
                        <View style={{ width: 28, alignItems: 'center' }}>
                          {badge ? (
                            <Ionicons name={badge.name} size={20} color={badge.color} />
                          ) : (
                            <Text style={{ color: T.textDim, fontSize: 13, fontWeight: '800' }}>#{i + 1}</Text>
                          )}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>
                            {op.operator_short_name || op.operator_name}
                          </Text>
                          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                            {op.shifts} смен · {moneyShort(op.total_revenue)} · {moneyShort(op.avg_revenue_per_shift)}/смена
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: tone.color, fontSize: 20, fontWeight: '900' }}>
                            {op.pi.toFixed(2)}
                          </Text>
                          <Text style={{ color: T.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 }}>
                            PI
                          </Text>
                        </View>
                      </View>
                    )
                  })}
                </Card>
              </View>
            ) : null}

            {coldStart.length > 0 ? (
              <View style={{ gap: S.sm }}>
                <SectionTitle hint={`< ${minShifts} смен`}>Накапливают данные</SectionTitle>
                <Card style={{ padding: 0 }}>
                  {coldStart.map((op, i, arr) => (
                    <View
                      key={op.operator_id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: 13,
                        borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                        borderBottomColor: T.borderSoft,
                      }}
                    >
                      <Text style={{ color: T.textMut, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                        {op.operator_short_name || op.operator_name}
                      </Text>
                      <Text style={{ color: T.textDim, fontSize: 12.5 }}>
                        {op.shifts} смен · {moneyShort(op.total_revenue)}
                      </Text>
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
