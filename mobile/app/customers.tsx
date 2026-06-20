import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'

type Customer = {
  id: string
  company_id: string | null
  name: string
  phone: string | null
  card_number: string | null
  email: string | null
  notes: string | null
  loyalty_points: number
  total_spent: number
  visits_count: number
  is_active: boolean
  created_at: string
  updated_at: string
  company: { id: string; name: string; code: string | null } | null
}

export default function CustomersScreen() {
  const router = useRouter()
  const [items, setItems] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ data: Customer[] }>('/api/admin/customers')
      setItems(res.data || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.card_number?.toLowerCase().includes(q),
    )
  }, [items, search])

  const totalPoints = useMemo(
    () => items.reduce((sum, c) => sum + (Number(c.loyalty_points) || 0), 0),
    [items],
  )
  const topCustomer = items.length > 0 ? items[0] : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Клиенты</Text>
      </View>

      {/* Поиск */}
      <View style={{ paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.card2, borderRadius: R.md, borderWidth: 1, borderColor: T.border, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Ionicons name="search" size={16} color={T.textDim} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск по имени, телефону, карте"
            placeholderTextColor={T.textDim}
            style={{ flex: 1, color: T.text, fontSize: 14, padding: 0 }}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={T.textDim} /></Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* Сводка */}
        <GlowHero glow={T.teal}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО КЛИЕНТОВ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{items.length}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`${totalPoints.toLocaleString('ru-RU')} баллов`} tone="warn" />
            {topCustomer ? <Pill text={`топ: ${topCustomer.name}`} tone="brand" /> : null}
          </View>
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && items.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="people-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Клиентов пока нет</Text>
          </Card>
        ) : filtered.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
            <Ionicons name="search-outline" size={34} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Ничего не найдено</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {filtered.map((c, i) => {
              const points = Number(c.loyalty_points) || 0
              return (
                <View key={c.id} style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < filtered.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>{c.name}</Text>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {c.phone || 'без телефона'}
                      {c.card_number ? ` · карта ${c.card_number}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {points > 0 ? <Pill text={`${points.toLocaleString('ru-RU')} баллов`} tone="warn" /> : null}
                      {c.visits_count > 0 ? <Pill text={`${c.visits_count} визитов`} tone="mut" /> : null}
                      {c.company?.name ? <Pill text={c.company.name} tone="brand" /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{money(c.total_spent || 0)}</Text>
                    <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>потрачено</Text>
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
