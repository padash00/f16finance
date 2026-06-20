import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented } from '@/components/ui'

type Profile = {
  full_name?: string | null
  phone?: string | null
  email?: string | null
  hire_date?: string | null
  position?: string | null
  photo_url?: string | null
}

type Stats = {
  totalShifts: number
  totalTurnover: number
  avgPerShift: number
  totalDebts: number
  totalBonuses: number
}

type Operator = {
  id: string
  name: string
  short_name?: string | null
  is_active?: boolean | null
  role?: string | null
  telegram_chat_id?: string | null
  created_at?: string | null
  operator_profiles?: Profile[] | Profile | null
  auth?: { username?: string | null; role?: string | null; is_active?: boolean | null } | null
  stats?: Stats | null
}

const profileOf = (op: Operator): Profile => {
  const p = op.operator_profiles
  if (Array.isArray(p)) return p[0] || {}
  return p || {}
}

const statsOf = (op: Operator): Stats => ({
  totalShifts: Number(op.stats?.totalShifts || 0),
  totalTurnover: Number(op.stats?.totalTurnover || 0),
  avgPerShift: Number(op.stats?.avgPerShift || 0),
  totalDebts: Number(op.stats?.totalDebts || 0),
  totalBonuses: Number(op.stats?.totalBonuses || 0),
})

const displayName = (op: Operator) => {
  const p = profileOf(op)
  return p.full_name?.trim() || op.name || 'Без имени'
}

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export default function OperatorsScreen() {
  const router = useRouter()
  const [filter, setFilter] = useState<'all' | 'active'>('active')
  const [items, setItems] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ data: Operator[] }>('/api/admin/operators')
      setItems(res.data || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    if (filter === 'active') return items.filter((o) => o.is_active !== false)
    return items
  }, [items, filter])

  const summary = useMemo(() => {
    const total = items.length
    const active = items.filter((o) => o.is_active !== false).length
    let turnover = 0
    for (const o of items) turnover += Number(o.stats?.totalTurnover || 0)
    return { total, active, inactive: total - active, turnover }
  }, [items])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Операторы</Text>
      </View>

      <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as 'all' | 'active')}
          options={[
            { key: 'active', label: 'Активные' },
            { key: 'all', label: 'Все' },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.amber}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО ОПЕРАТОРОВ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.total}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`активных ${summary.active}`} tone="good" />
            {summary.inactive > 0 ? <Pill text={`неактивных ${summary.inactive}`} tone="mut" /> : null}
          </View>
          {summary.turnover > 0 ? (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Оборот за 30 дней: {moneyShort(summary.turnover)}</Text>
          ) : null}
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
            <Ionicons name="people-circle-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Операторы не найдены</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {visible.map((op, i) => {
              const p = profileOf(op)
              const st = statsOf(op)
              const name = displayName(op)
              const sub = [op.short_name || null, p.position || null].filter(Boolean).join(' • ')
              const contact = p.phone || p.email || null
              const active = op.is_active !== false
              return (
                <View
                  key={op.id}
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
                      backgroundColor: active ? T.amber + '22' : T.card2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: active ? T.amber : T.textDim, fontSize: 14, fontWeight: '900' }}>{initials(name)}</Text>
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{name}</Text>
                      {!active ? <Pill text="неактивен" tone="mut" /> : null}
                    </View>
                    {sub ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{sub}</Text>
                    ) : null}
                    {contact ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{contact}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: T.textMut, fontSize: 11 }}>Смен: {st.totalShifts}</Text>
                      {st.totalBonuses > 0 ? (
                        <Text style={{ color: T.green, fontSize: 11 }}>Премии +{moneyShort(st.totalBonuses)}</Text>
                      ) : null}
                      {st.totalDebts > 0 ? (
                        <Text style={{ color: T.red, fontSize: 11 }}>Долг {moneyShort(st.totalDebts)}</Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                    <Text style={{ color: T.greenBright, fontSize: 14.5, fontWeight: '800' }}>{money(st.totalTurnover)}</Text>
                    <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>30 дней</Text>
                  </View>
                </View>
              )
            })}
          </Card>
        )}

        {!loading && items.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Показано {visible.length} из {items.length}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
