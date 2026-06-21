import { useCallback, useEffect, useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, SectionTitle, Pill, ErrorState, EmptyState, SkeletonList } from '@/components/ui'

type Shift = { id: string; date: string; shift_type: string; comment: string | null }
type Group = { company: { id: string; name: string; code: string | null }; shifts: Shift[] }
type Resp = { weekStart: string; weekEnd: string; schedule: Group[] }

const shiftLabel = (t: string) => (t === 'day' ? 'День' : t === 'night' ? 'Ночь' : t)
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const fmtDate = (s: string) => {
  const d = new Date(s)
  return `${WEEKDAYS[d.getDay()]}, ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}`
}

export default function OperatorShifts() {
  const [r, setR] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setR(await apiFetch<{ ok: boolean } & Resp>('/api/operator/shifts')) }
    catch (e: any) { setError(e?.message || 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const groups = (r?.schedule || []).filter((g) => g.shifts.length > 0)
  const total = groups.reduce((a, g) => a + g.shifts.length, 0)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && !!r} onRefresh={load} tintColor={T.green} />}>
        <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>Смены</Text>
        {r ? <Text style={{ color: T.textMut, fontSize: 13 }}>Неделя {new Date(r.weekStart).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} — {new Date(r.weekEnd).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} · {total} смен</Text> : null}

        {loading && !r ? <SkeletonList rows={6} /> : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : groups.length === 0 ? (
          <EmptyState icon="calendar-clear-outline" title="На этой неделе смен нет" />
        ) : (
          groups.map((g) => (
            <View key={g.company.id} style={{ gap: S.sm }}>
              <SectionTitle hint={`${g.shifts.length}`}>{g.company.name}</SectionTitle>
              <Card style={{ gap: 2, paddingVertical: 4 }}>
                {g.shifts.map((s, i, arr) => (
                  <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: s.shift_type === 'night' ? 'rgba(96,165,250,0.14)' : 'rgba(251,191,36,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={s.shift_type === 'night' ? 'moon' : 'sunny'} size={18} color={s.shift_type === 'night' ? T.blue : T.amber} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }}>{fmtDate(s.date)}</Text>
                      {s.comment ? <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{s.comment}</Text> : null}
                    </View>
                    <Pill text={shiftLabel(s.shift_type)} tone={s.shift_type === 'night' ? 'brand' : 'warn'} />
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
