import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented, ErrorState, EmptyState, PrimaryButton, GhostButton } from '@/components/ui'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'

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
const numOf = (v: string) => Number(String(v).replace(',', '.'))

export default function CatalogScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canCreate = canDo(role, 'store-catalog.create')
  const canEdit = canDo(role, 'store-catalog.edit')

  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  // форма
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CatalogItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [fName, setFName] = useState('')
  const [fBarcode, setFBarcode] = useState('')
  const [fCategoryId, setFCategoryId] = useState<string | null>(null)
  const [fSale, setFSale] = useState('')
  const [fPurchase, setFPurchase] = useState('')
  const [fUnit, setFUnit] = useState('шт')

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

  // существующие категории — для быстрого выбора в форме
  const categories = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of items) {
      if (it.category?.id && it.category?.name) map.set(it.category.id, it.category.name)
    }
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [items])

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

  const openCreate = useCallback(() => {
    setEditing(null)
    setFName(''); setFBarcode(''); setFCategoryId(null)
    setFSale(''); setFPurchase(''); setFUnit('шт')
    setFormErr(null)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((it: CatalogItem) => {
    setEditing(it)
    setFName(it.name || '')
    setFBarcode(it.barcode || '')
    setFCategoryId(it.category_id || it.category?.id || null)
    setFSale(it.sale_price != null ? String(it.sale_price) : '')
    setFPurchase(it.default_purchase_price != null ? String(it.default_purchase_price) : '')
    setFUnit(it.unit || 'шт')
    setFormErr(null)
    setFormOpen(true)
  }, [])

  const submit = useCallback(async () => {
    const name = fName.trim()
    const barcode = fBarcode.trim()
    if (!name) { setFormErr('Укажите название'); return }
    if (!barcode) { setFormErr('Укажите штрихкод'); return }
    const sale = fSale.trim() ? numOf(fSale) : 0
    const purchase = fPurchase.trim() ? numOf(fPurchase) : 0
    if (!Number.isFinite(sale) || sale < 0) { setFormErr('Цена продажи некорректна'); return }
    if (!Number.isFinite(purchase) || purchase < 0) { setFormErr('Цена закупа некорректна'); return }

    setSaving(true); setFormErr(null)
    const payload = {
      name,
      barcode,
      category_id: fCategoryId || null,
      sale_price: sale,
      default_purchase_price: purchase,
      unit: fUnit.trim() || 'шт',
    }
    try {
      await apiFetch('/api/admin/inventory', {
        method: 'POST',
        body: JSON.stringify(
          editing
            ? { action: 'updateItem', id: editing.id, payload }
            : { action: 'createItem', payload },
        ),
      })
      haptic.success()
      setFormOpen(false)
      await load()
    } catch (e: any) {
      haptic.error()
      setFormErr(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }, [fName, fBarcode, fCategoryId, fSale, fPurchase, fUnit, editing, load])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Каталог товаров</Text>
        {canCreate ? (
          <Pressable
            onPress={openCreate}
            hitSlop={8}
            style={{ width: 38, height: 38, borderRadius: R.md, backgroundColor: T.green, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="add" size={24} color="#04130d" />
          </Pressable>
        ) : null}
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
          <ErrorState message={error} onRetry={() => load()} />
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && filtered.length === 0 ? (
          <EmptyState icon="pricetags-outline" title={items.length === 0 ? 'Каталог пуст' : 'Ничего не найдено'} />
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
                  <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: T.green, fontSize: 15, fontWeight: '800' }}>{money(it.sale_price)}</Text>
                      {Number(it.default_purchase_price || 0) > 0 ? (
                        <Text style={{ color: T.textDim, fontSize: 11.5, marginTop: 3 }}>закуп {money(it.default_purchase_price)}</Text>
                      ) : null}
                    </View>
                    {canEdit ? (
                      <Pressable
                        onPress={() => openEdit(it)}
                        hitSlop={10}
                        style={{ marginTop: 8, width: 32, height: 32, borderRadius: R.sm, backgroundColor: T.card2, borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Ionicons name="pencil" size={15} color={T.textMut} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )
            })}
          </Card>
        )}
      </ScrollView>

      {/* Форма создания / редактирования */}
      <Modal visible={formOpen} animationType="slide" transparent onRequestClose={() => setFormOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: T.bg, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderWidth: 1, borderColor: T.border, maxHeight: '92%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg, paddingBottom: S.sm }}>
              <Text style={{ color: T.text, fontSize: 19, fontWeight: '900' }}>{editing ? 'Редактировать товар' : 'Новый товар'}</Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={10}><Ionicons name="close" size={24} color={T.textMut} /></Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: S.xl, gap: S.md }} keyboardShouldPersistTaps="handled">
              <Field label="Название">
                <Input value={fName} onChangeText={setFName} placeholder="Например, Кола 0.5" />
              </Field>
              <Field label="Штрихкод">
                <Input value={fBarcode} onChangeText={setFBarcode} placeholder="Штрихкод" autoCapitalize="none" keyboardType="default" />
              </Field>

              <View style={{ flexDirection: 'row', gap: S.md }}>
                <Field label="Цена продажи" style={{ flex: 1 }}>
                  <Input value={fSale} onChangeText={setFSale} placeholder="0" keyboardType="decimal-pad" />
                </Field>
                <Field label="Цена закупа" style={{ flex: 1 }}>
                  <Input value={fPurchase} onChangeText={setFPurchase} placeholder="0" keyboardType="decimal-pad" />
                </Field>
              </View>

              <Field label="Единица">
                <Input value={fUnit} onChangeText={setFUnit} placeholder="шт" autoCapitalize="none" />
              </Field>

              <Field label="Категория">
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <CatChip label="Без категории" active={!fCategoryId} onPress={() => setFCategoryId(null)} />
                  {categories.map((c) => (
                    <CatChip key={c.id} label={c.name} active={fCategoryId === c.id} onPress={() => setFCategoryId(c.id)} />
                  ))}
                </View>
              </Field>

              {formErr ? (
                <Card style={{ borderColor: '#3b1212' }}>
                  <Text style={{ color: T.red, fontWeight: '700', fontSize: 13.5 }}>{formErr}</Text>
                </Card>
              ) : null}

              <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.sm }}>
                <GhostButton label="Отмена" onPress={() => setFormOpen(false)} disabled={saving} style={{ flex: 1 }} />
                <PrimaryButton label="Сохранить" loading={saving} disabled={saving} onPress={() => void submit()} style={{ flex: 1.4 }} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: any }) {
  return (
    <View style={[{ gap: 7 }, style]}>
      <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 }}>{label}</Text>
      {children}
    </View>
  )
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={T.textDim}
      autoCorrect={false}
      {...props}
      style={[{ color: T.text, fontSize: 15, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12 }, props.style]}
    />
  )
}

function CatChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 13, paddingVertical: 8, borderRadius: R.pill, borderWidth: 1,
        backgroundColor: active ? 'rgba(16,185,129,0.16)' : T.card,
        borderColor: active ? 'rgba(16,185,129,0.4)' : T.border,
      }}
    >
      <Text style={{ color: active ? '#34f0b6' : T.textMut, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}
