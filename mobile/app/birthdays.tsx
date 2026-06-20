import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, Segmented } from '@/components/ui'

type BirthdayItem = {
  id: string
  name: string
  short_name: string | null
  position: string | null
  photo_url: string | null
  birth_date: string
  company_name: string | null
  company_code: string | null
  assignment_count: number
  month: number
  day: number
  age: number | null
  nextBirthday: string
  daysUntil: number
}

type Stats = {
  total: number
  today: number
  week: number
  month: number
  withoutBirthDate: number
}

type Resp = { ok: boolean; data?: { items: BirthdayItem[]; stats: Stats } }

const EMPTY_STATS: Stats = { total: 0, today: 0, week: 0, month: 0, withoutBirthDate: 0 }

function formatBirthdayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function formatUpcomingLabel(daysUntil: number) {
  if (daysUntil === 0) return 'Сегодня'
  if (daysUntil === 1) return 'Завтра'
  if (daysUntil < 5) return `Через ${daysUntil} дня`
  return `Через ${daysUntil} дней`
}

function upcomingTone(daysUntil: number): 'good' | 'bad' | 'warn' | 'mut' | 'brand' {
  if (daysUntil === 0) return 'warn'
  if (daysUntil <= 7) return 'good'
  return 'mut'
}

function getZodiac(value: string) {
  const date = new Date(`${value}T12:00:00`)
  const month = date.getMonth() + 1
  const day = date.getDate()
  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return { name: 'Овен', emoji: '♈' }
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return { name: 'Телец', emoji: '♉' }
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return { name: 'Близнецы', emoji: '♊' }
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return { name: 'Рак', emoji: '♋' }
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return { name: 'Лев', emoji: '♌' }
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return { name: 'Дева', emoji: '♍' }
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return { name: 'Весы', emoji: '♎' }
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return { name: 'Скорпион', emoji: '♏' }
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return { name: 'Стрелец', emoji: '♐' }
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return { name: 'Козерог', emoji: '♑' }
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return { name: 'Водолей', emoji: '♒' }
  return { name: 'Рыбы', emoji: '♓' }
}

const initials = (name: string) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

type RangeKey = 'today' | 'week' | 'month' | 'all'

export default function BirthdaysScreen() {
  const router = useRouter()
  const [range, setRange] = useState<RangeKey>('week')
  const [items, setItems] = useState<BirthdayItem[]>([])
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Resp>('/api/admin/birthdays')
      setItems(res.data?.items || [])
      setStats(res.data?.stats || EMPTY_STATS)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить дни рождения')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const list = items || []
    if (range === 'today') return list.filter((it) => it.daysUntil === 0)
    if (range === 'week') return list.filter((it) => it.daysUntil >= 0 && it.daysUntil <= 7)
    if (range === 'month') return list.filter((it) => it.daysUntil >= 0 && it.daysUntil <= 30)
    return list
  }, [items, range])

  const nearestLabel = useMemo(() => {
    const next = (items || []).find((it) => it.daysUntil >= 0)
    if (!next) return null
    return `Ближайший: ${next.name} — ${formatUpcomingLabel(next.daysUntil).toLowerCase()}`
  }, [items])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Дни рождения</Text>
      </View>

      <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Segmented
          value={range}
          onChange={(v) => setRange(v as RangeKey)}
          options={[
            { key: 'today', label: 'Сегодня' },
            { key: 'week', label: '7 дней' },
            { key: 'month', label: '30 дней' },
            { key: 'all', label: 'Все' },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.amber}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>БЛИЖАЙШИЕ 30 ДНЕЙ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{stats.month}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            {stats.today > 0 ? <Pill text={`сегодня ${stats.today}`} tone="warn" /> : null}
            <Pill text={`7 дней ${stats.week}`} tone="good" />
            {stats.withoutBirthDate > 0 ? <Pill text={`без даты ${stats.withoutBirthDate}`} tone="mut" /> : null}
          </View>
          {nearestLabel ? <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>{nearestLabel}</Text> : null}
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && visible.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="gift-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>
              {range === 'today' ? 'Сегодня дней рождения нет' : 'В выбранном периоде дней рождения нет'}
            </Text>
          </Card>
        ) : (
          <>
            <SectionTitle hint={`${visible.length}`}>Список</SectionTitle>
            <Card style={{ padding: 0 }}>
              {visible.map((it, i) => {
                const z = getZodiac(it.birth_date)
                const today = it.daysUntil === 0
                const sub = [it.company_name || 'Точка не назначена', it.position || null].filter(Boolean).join(' • ')
                return (
                  <View
                    key={it.id}
                    style={{
                      flexDirection: 'row',
                      gap: 12,
                      padding: 14,
                      borderBottomWidth: i < visible.length - 1 ? 1 : 0,
                      borderBottomColor: T.borderSoft,
                    }}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        backgroundColor: today ? T.amber + '22' : T.card2,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: today ? T.amber : T.textDim, fontSize: 14, fontWeight: '900' }}>{initials(it.name)}</Text>
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{it.name}</Text>
                      </View>
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{sub}</Text>
                      <Text style={{ color: T.textMut, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
                        {z.emoji} {z.name} · {formatBirthdayDate(it.birth_date)}
                        {it.age ? ` · ${it.age} лет` : ''}
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                      <Pill text={formatUpcomingLabel(it.daysUntil)} tone={upcomingTone(it.daysUntil)} />
                    </View>
                  </View>
                )
              })}
            </Card>
          </>
        )}

        {!loading && items.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Учитываются даты рождения операторов
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
