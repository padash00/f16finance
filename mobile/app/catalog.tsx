import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented } from '@/components/ui'

type CatalogItem = {
  id: string
  name: string | null
  barcode: string | null
  category_id: string | null
  category: { id: string; name: string } | null
  sale_price: number | null
  default_purchase_price: number | null
  unit: string | null
  notes: string | null
  is_active: boolean | null
  item_type: string | null
  catalog_qty?: number | null
  warehouse_qty?: number | null
  showcase_qty?: number | null
  total_balance?: number | null
}

type Filter = 'all' | 'in_stock' | 'out'

const qtyOf = (it: CatalogItem) => Number(it.total_balance ?? it.catalog_qty ?? 0)

export default function CatalogScreen() {
  const router = useRouter()
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<{ ok: boolean; data: CatalogItem[] }>('/api/admin/inventory/catalog')
      setItems((res.data || []).filter((i) => i?.is_active !== false))
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    let positions = 0, inStock = 0, retailValue = 0
    for (const it of items) {
      positions++
      const q = qtyOf(it)
      if (q > 0) inStock++
      retailValue += q * Number(it.sale_price || 0)
    }
    return { positions, inStock, retailValue }
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      const qty = qtyOf(it)
      if (filter === 'in_stock' && qty <= 0) return false
      if (filter === 'out' && qty > 0) return false
      if (!q) return true
      const name = (it.name || '').toLowerCase()
      const bc = (it.barcode || '').toLowerCase()
      const cat = (it.category?.name || '').toLowerCase()
      return name.includes(q) || bc.includes(q) || cat.includes(q)
    })
  }, [items, search, filter])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Каталог товаров</Text>
      </View>

      {/* Поиск */}
      <View style={{ paddingHorizontal: S.lg, paddingTop: 4, paddingBottom: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.md, paddingHorizontal: 12 }}>
          <Ionicons name="search" size={17} color={T.textDim} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Название, штрихкод, категория"
            placeholderTextColor={T.textDim}
            style={{ flex: 1, color: T.text, fontSize: 14.5, paddingVertical: 11 }}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}><Ionicons name="close-circle" size={17} color={T.textDim} /></Pressable>
          ) : null}
        </View>
      </View>

      {/* Фильтр остатка */}
      <View style={{ paddingHorizontal: S.lg, paddingTop: 8 }}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: 'Все' },
            { key: 'in_stock', label: 'В наличии' },
            { key: 'out', label: 'Нет' },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: S.md, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={load} tintColor={T.green} />}
        keyboardShouldPersistTaps="handled"
      >
        <GlowHero glow={T.teal}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ПОЗИЦИЙ В КАТАЛОГЕ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.positions.toLocaleString('ru-RU')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`в наличии ${summary.inStock.toLocaleString('ru-RU')}`} tone="good" />
            <Pill text={`розница ${money(summary.retailValue)}`} tone="brand" />
          </View>
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && filtered.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="pricetag-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14, marginTop: 4 }}>
              {items.length === 0 ? 'Каталог пуст' : 'Ничего не найдено'}
            </Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {filtered.map((it, i) => {
              const qty = qtyOf(it)
              const wh = Number(it.warehouse_qty || 0)
              const sh = Number(it.showcase_qty || 0)
              return (
                <View key={it.id} style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < filtered.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={2}>{it.name || 'Без названия'}</Text>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {it.category?.name ? `${it.category.name}` : 'Без категории'}
                      {it.barcode ? ` · ${it.barcode}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                      {qty > 0
                        ? <Pill text={`остаток ${qty}${it.unit ? ' ' + it.unit : ''}`} tone="good" />
                        : <Pill text="нет в наличии" tone="mut" />}
                      {wh > 0 ? <Pill text={`склад ${wh}`} tone="brand" /> : null}
                      {sh > 0 ? <Pill text={`витрина ${sh}`} tone="warn" /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: T.green, fontSize: 15, fontWeight: '800' }}>{money(it.sale_price)}</Text>
                    {Number(it.default_purchase_price || 0) > 0 ? (
                      <Text style={{ color: T.textDim, fontSize: 11.5, marginTop: 3 }}>закуп {money(it.default_purchase_price)}</Text>
                    ) : null}
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
