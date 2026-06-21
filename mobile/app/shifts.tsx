import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill, Segmented, ErrorState, EmptyState, SkeletonList } from '@/components/ui'

type Shift = {
  id: string
  status: string
  shift_type: string | null
  opened_at: string | null
  closed_at: string | null
  closing_cash: number | null
  closing_kaspi: number | null
  company?: any
  operator?: { full_name?: string | null; short_name?: string | null } | null
  live_totals?: { sales: number; cash: number; kaspi: number; count: number }
}

const one = (v: any) => (Array.isArray(v) ? v[0] : v)
const shiftLabel = (t: string | null) => (t === 'day' ? 'День' : t === 'night' ? 'Ночь' : t || '')
const salesOf = (s: Shift) => (s.status === 'open' ? Number(s.live_totals?.sales || 0) : Number(s.closing_cash || 0) + Number(s.closing_kaspi || 0))
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

export default function ShiftsScreen() {
  const router = useRouter()
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (f: string) => {
    setLoading(true); setError(null)
    try {
      const r = await apiFetch<{ data: { shifts: Shift[] } }>(`/api/admin/shifts/reports?status=${f}&limit=60`)
      setShifts(r.data?.shifts || [])
    } catch (e: any) { setError(e?.message || 'Не удалось загрузить') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(filter) }, [filter, load])

  const openCount = shifts.filter((s) => s.status === 'open').length

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Смены</Text>
        {openCount > 0 ? <Pill text={`${openCount} открыто`} tone="good" /> : null}
      </View>

      <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Segmented value={filter} options={[{ key: 'all', label: 'Все' }, { key: 'open', label: 'Открытые' }, { key: 'closed', label: 'Закрытые' }]} onChange={setFilter} />
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.sm }} refreshControl={<RefreshControl refreshing={loading && shifts.length > 0} onRefresh={() => load(filter)} tintColor={T.green} />}>
        {loading && shifts.length === 0 ? <SkeletonList rows={6} /> : error ? (
          <ErrorState message={error} onRetry={() => load(filter)} />
        ) : shifts.length === 0 ? (
          <EmptyState icon="time-outline" title="Смен нет" />
        ) : (
          shifts.map((s) => {
            const op = s.operator
            const co = one(s.company)
            const open = s.status === 'open'
            return (
              <Card key={s.id} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{op?.short_name || op?.full_name || 'Оператор'}</Text>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{co?.name ? `${co.name} · ` : ''}{shiftLabel(s.shift_type)} · {fmtDate(s.opened_at)}</Text>
                  </View>
                  <Pill text={open ? 'Открыта' : 'Закрыта'} tone={open ? 'good' : 'mut'} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: T.borderSoft, paddingTop: 8 }}>
                  <Text style={{ color: T.textMut, fontSize: 12 }}>{open ? 'Продажи (живые)' : 'Сдано'}</Text>
                  <Text style={{ color: open ? T.greenBright : T.text, fontSize: 16, fontWeight: '900' }}>{money(salesOf(s))}</Text>
                </View>
              </Card>
            )
          })
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
