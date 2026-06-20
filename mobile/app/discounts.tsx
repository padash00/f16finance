import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented } from '@/components/ui'

type DiscountType = 'percent' | 'fixed' | 'promo_code'

type Discount = {
  id: string
  company_id: string | null
  name: string
  type: DiscountType
  value: number
  promo_code: string | null
  min_order_amount: number
  is_active: boolean
  valid_from: string | null
  valid_to: string | null
  usage_limit: number | null
  usage_count: number
  created_at: string
}

type Filter = 'all' | 'active' | 'promo'

const typeLabel = (t: DiscountType) =>
  t === 'percent' ? 'Скидка %' : t === 'fixed' ? 'Фиксированная' : 'Промокод'

const valueDisplay = (d: Discount) =>
  d.type === 'fixed' ? `${d.value} ₸` : `${d.value}%`

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '∞'

const todayIso = () => new Date().toISOString().split('T')[0]

function status(d: Discount): { text: string; tone: 'good' | 'bad' | 'warn' | 'mut' } {
  const today = todayIso()
  if (!d.is_active) return { text: 'Неактивна', tone: 'mut' }
  if (d.valid_to && d.valid_to < today) return { text: 'Истекла', tone: 'bad' }
  if (d.valid_from && d.valid_from > today) return { text: 'Запланирована', tone: 'warn' }
  return { text: 'Активна', tone: 'good' }
}

export default function DiscountsScreen() {
  const router = useRouter()
  const [items, setItems] = useState<Discount[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<{ data: Discount[] }>('/api/admin/discounts')
      setItems(res.data || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    const today = todayIso()
    let active = 0, promo = 0
    for (const d of items) {
      const live = d.is_active && (!d.valid_to || d.valid_to >= today) && (!d.valid_from || d.valid_from <= today)
      if (live) active += 1
      if (d.type === 'promo_code') promo += 1
    }
    return { total: items.length, active, promo }
  }, [items])

  const filtered = useMemo(() => {
    const today = todayIso()
    if (filter === 'promo') return items.filter((d) => d.type === 'promo_code')
    if (filter === 'active') {
      return items.filter(
        (d) => d.is_active && (!d.valid_to || d.valid_to >= today) && (!d.valid_from || d.valid_from <= today),
      )
    }
    return items
  }, [items, filter])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Скидки</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.blue}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО СКИДОК</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.total}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`активных ${summary.active}`} tone="good" />
            {summary.promo > 0 ? <Pill text={`промокодов ${summary.promo}`} tone="brand" /> : null}
          </View>
        </GlowHero>

        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: 'Все' },
            { key: 'active', label: 'Активные' },
            { key: 'promo', label: 'Промокоды' },
          ]}
        />

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 && !loading ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="pricetags-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Скидок не найдено</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {filtered.map((d, i) => {
              const st = status(d)
              return (
                <View
                  key={d.id}
                  style={{
                    padding: 14,
                    opacity: d.is_active ? 1 : 0.6,
                    borderBottomWidth: i < filtered.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', flex: 1 }} numberOfLines={1}>{d.name}</Text>
                    <Text style={{ color: T.greenBright, fontSize: 16, fontWeight: '900' }}>{valueDisplay(d)}</Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Pill text={typeLabel(d.type)} tone="mut" />
                    <Pill text={st.text} tone={st.tone} />
                    {d.type === 'promo_code' && d.promo_code ? (
                      <View style={{ borderWidth: 1, borderColor: T.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: T.text, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{d.promo_code}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={{ marginTop: 8, gap: 2 }}>
                    {d.min_order_amount > 0 ? (
                      <Text style={{ color: T.textDim, fontSize: 12 }}>Мин. заказ: {money(d.min_order_amount)}</Text>
                    ) : null}
                    {d.valid_from || d.valid_to ? (
                      <Text style={{ color: T.textDim, fontSize: 12 }}>Период: {fmtDate(d.valid_from)} — {fmtDate(d.valid_to)}</Text>
                    ) : null}
                    {d.usage_limit !== null ? (
                      <Text style={{ color: T.textDim, fontSize: 12 }}>Использований: {d.usage_count} / {d.usage_limit}</Text>
                    ) : (
                      <Text style={{ color: T.textDim, fontSize: 12 }}>Использований: {d.usage_count}</Text>
                    )}
                  </View>
                </View>
              )
            })}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
