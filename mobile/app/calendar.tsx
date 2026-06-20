import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S } from '@/lib/theme'
import { Card, GlowHero } from '@/components/ui'

type EventType = 'shift' | 'birthday' | 'holiday' | 'announcement'

type CalEvent = {
  date: string
  type: EventType
  title: string
  subtitle?: string | null
  color?: string | null
}

type Resp = { events?: CalEvent[]; from?: string; to?: string }

const ICONS: Record<EventType, keyof typeof Ionicons.glyphMap> = {
  shift: 'time-outline',
  birthday: 'gift-outline',
  holiday: 'star-outline',
  announcement: 'megaphone-outline',
}

const iso = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`

const monthRange = (y: number, m: number) => ({
  from: iso(new Date(y, m, 1)),
  to: iso(new Date(y, m + 1, 0)),
})

const fmtDay = (date: string) => {
  const d = new Date(date + 'T12:00:00')
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', weekday: 'short' })
}

export default function CalendarScreen() {
  const router = useRouter()
  const now = new Date()
  const [year, setYear] = useState(() => now.getFullYear())
  const [month, setMonth] = useState(() => now.getMonth())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true)
    setError(null)
    const { from, to } = monthRange(y, m)
    try {
      const res = await apiFetch<Resp>(`/api/calendar?from=${from}&to=${to}`)
      setEvents(res?.events || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(year, month)
  }, [year, month, load])

  const shiftMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 0) {
      m = 11
      y -= 1
    } else if (m > 11) {
      m = 0
      y += 1
    }
    setMonth(m)
    setYear(y)
  }

  const grouped = useMemo(() => {
    const map: Record<string, CalEvent[]> = {}
    for (const e of events) {
      const d = String(e.date).slice(0, 10)
      if (!map[d]) map[d] = []
      map[d].push(e)
    }
    return Object.keys(map)
      .sort()
      .map((date) => ({ date, items: map[date] }))
  }, [events])

  const monthLabel = useMemo(
    () => new Date(year, month, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    [year, month],
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Календарь</Text>
      </View>

      {/* Переключатель месяца */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={20} color={T.textMut} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>{monthLabel}</Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={10} style={{ padding: 6 }}>
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && events.length > 0} onRefresh={() => load(year, month)} tintColor={T.green} />}
      >
        <GlowHero glow={T.violet}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>СОБЫТИЙ ЗА МЕСЯЦ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{events.length}</Text>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 6 }}>Смены · ДР · праздники РК · объявления</Text>
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && events.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && events.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="calendar-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>В этом месяце нет событий</Text>
          </Card>
        ) : (
          grouped.map((g) => (
            <Card key={g.date} style={{ padding: 0 }}>
              <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
                <Text style={{ color: T.text, fontSize: 13, fontWeight: '800', textTransform: 'capitalize' }}>{fmtDay(g.date)}</Text>
              </View>
              {g.items.map((e, i) => {
                const tint = e.color || T.textMut
                return (
                  <View
                    key={`${g.date}-${i}`}
                    style={{
                      flexDirection: 'row',
                      gap: 12,
                      alignItems: 'flex-start',
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      borderTopWidth: 1,
                      borderTopColor: T.borderSoft,
                    }}
                  >
                    <View style={{ width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: tint + '22' }}>
                      <Ionicons name={ICONS[e.type] || 'calendar-outline'} size={17} color={tint} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>{e.title}</Text>
                      {e.subtitle ? (
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{e.subtitle}</Text>
                      ) : null}
                    </View>
                  </View>
                )
              })}
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
