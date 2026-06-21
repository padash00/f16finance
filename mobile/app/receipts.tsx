import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented, ErrorState, EmptyState, PrimaryButton, GhostButton } from '@/components/ui'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { haptic } from '@/lib/haptics'

type Supplier = { id: string; name: string; organization_name?: string | null }
type Location = { id: string; name: string; location_type?: 'warehouse' | 'point_display' | null }
type ReceiptItem = {
  id: string
  quantity: number
  unit_cost: number
  total_cost: number
  is_bonus?: boolean
  item?: { id: string; name: string; barcode?: string; unit?: string | null } | null
}
type Receipt = {
  id: string
  received_at: string
  total_amount: number
  invoice_number: string | null
  invoice_file_url: string | null
  comment: string | null
  status: 'posted' | 'cancelled'
  kind: 'supplier' | 'posting'
  supplier?: Supplier | null
  location?: Location | null
  items?: ReceiptItem[]
}
type Data = {
  receipts: Receipt[]
  suppliers: Supplier[]
  locations: Location[]
}

// Товар каталога — источник для строки оприходования.
type CatalogItem = {
  id: string
  name: string | null
  barcode: string | null
  unit: string | null
  default_purchase_price: number | null
  requires_expiry?: boolean | null
  is_active?: boolean | null
}

type Scope = 'all' | 'warehouse' | 'showcase'

const fmtDay = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—'

// Парсинг числа из строки (запятая → точка), как в остальных формах.
const num = (v: string) => {
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const locLabel = (l: Location) => {
  const tag =
    l.location_type === 'warehouse' ? 'Подсобка' : l.location_type === 'point_display' ? 'Витрина' : ''
  return tag ? `${l.name} · ${tag}` : l.name
}

export default function ReceiptsScreen() {
  const router = useRouter()
  const { role } = useAuth()
  // Сервер требует store-postings.create; в моб. гейте принимаем store.manage / inventory.create.
  const canCreate = canDo(role, 'store.manage') || canDo(role, 'inventory.create')

  const [scope, setScope] = useState<Scope>('all')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (sc: Scope) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ ok: boolean; data: Data }>(`/api/admin/store/receipts?scope=${sc}`)
      setData({
        receipts: res?.data?.receipts || [],
        suppliers: res?.data?.suppliers || [],
        locations: res?.data?.locations || [],
      })
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(scope)
  }, [scope, load])

  const receipts = useMemo(() => data?.receipts || [], [data])

  // Только склад/витрина — на catalog_total оприходовать нельзя (сервер отклонит).
  const postingLocations = useMemo(
    () =>
      (data?.locations || []).filter(
        (l) => l.location_type === 'warehouse' || l.location_type === 'point_display',
      ),
    [data],
  )

  const summary = useMemo(() => {
    let total = 0
    let active = 0
    for (const r of receipts) {
      if (r.status === 'cancelled') continue
      active += 1
      total += Number(r.total_amount || 0)
    }
    return { total, active, suppliers: (data?.suppliers || []).length }
  }, [receipts, data])

  // ─── Форма оприходования ────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [itemSearch, setItemSearch] = useState('')

  const [locationId, setLocationId] = useState<string>('')
  const [item, setItem] = useState<CatalogItem | null>(null)
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [expiry, setExpiry] = useState('') // ГГГГ-ММ-ДД, нужен если requires_expiry !== false
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const res = await apiFetch<{ ok: boolean; data: CatalogItem[] }>('/api/admin/inventory/catalog')
      setCatalog((res.data || []).filter((i) => i?.is_active !== false))
    } catch (e: any) {
      setCatalogError(e?.message || 'Не удалось загрузить каталог')
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  const openForm = useCallback(() => {
    setFormError(null)
    setItemSearch('')
    setItem(null)
    setQty('')
    setUnitCost('')
    setExpiry('')
    setComment('')
    // Локация по умолчанию — первая склад/витрина.
    setLocationId(postingLocations[0]?.id || '')
    setFormOpen(true)
    if (catalog.length === 0 && !catalogLoading) void loadCatalog()
  }, [postingLocations, catalog.length, catalogLoading, loadCatalog])

  const filteredCatalog = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return catalog.slice(0, 40)
    return catalog
      .filter((it) => {
        const name = (it.name || '').toLowerCase()
        const bc = (it.barcode || '').toLowerCase()
        return name.includes(q) || bc.includes(q)
      })
      .slice(0, 40)
  }, [catalog, itemSearch])

  const requiresExpiry = !!item && item.requires_expiry !== false

  const submit = useCallback(async () => {
    setFormError(null)
    if (!locationId) {
      setFormError('Выберите локацию (склад или витрина)')
      return
    }
    if (!item) {
      setFormError('Выберите товар из каталога')
      return
    }
    const q = num(qty)
    if (q <= 0) {
      setFormError('Укажите количество больше нуля')
      return
    }
    const cost = num(unitCost)
    if (cost < 0) {
      setFormError('Себестоимость не может быть отрицательной')
      return
    }
    const expiryClean = expiry.trim()
    if (requiresExpiry && !expiryClean) {
      setFormError('Для этого товара нужен срок годности (ГГГГ-ММ-ДД)')
      return
    }
    setSaving(true)
    try {
      await apiFetch('/api/admin/store/receipts', {
        method: 'POST',
        body: JSON.stringify({
          action: 'createPosting',
          posting: {
            location_id: locationId,
            received_at: new Date().toISOString().slice(0, 10),
            comment: comment.trim() || 'Оприходование (моб.)',
            items: [
              {
                item_id: item.id,
                quantity: q,
                unit_cost: cost,
                expiry_date: expiryClean || null,
              },
            ],
          },
        }),
      })
      haptic.success()
      setFormOpen(false)
      await load(scope)
    } catch (e: any) {
      haptic.error()
      setFormError(e?.message || 'Не удалось провести оприходование')
    } finally {
      setSaving(false)
    }
  }, [locationId, item, qty, unitCost, expiry, requiresExpiry, comment, load, scope])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Приёмка</Text>
        {canCreate ? (
          <Pressable
            onPress={openForm}
            hitSlop={8}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: T.greenSoft,
              borderColor: T.green,
              borderWidth: 1,
              borderRadius: R.pill,
              paddingHorizontal: 12,
              paddingVertical: 7,
            }}
          >
            <Ionicons name="add" size={17} color={T.greenBright} />
            <Text style={{ color: T.greenBright, fontSize: 13, fontWeight: '800' }}>Приход</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Segmented
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          options={[
            { key: 'all', label: 'Все' },
            { key: 'warehouse', label: 'Подсобка' },
            { key: 'showcase', label: 'Витрина' },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => load(scope)} tintColor={T.green} />}
      >
        <GlowHero glow={T.green}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>СУММА ВСЕХ ПРИЁМОК</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.total)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`документов ${summary.active}`} tone="brand" />
            {summary.suppliers > 0 ? <Pill text={`поставщиков ${summary.suppliers}`} tone="mut" /> : null}
          </View>
        </GlowHero>

        {error ? <ErrorState message={error} onRetry={() => load(scope)} /> : null}

        {loading && !data ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && receipts.length === 0 ? (
          <EmptyState icon="cube-outline" title="Документов приёмки пока нет" />
        ) : (
          <Card style={{ padding: 0 }}>
            {receipts.map((r, i) => {
              const cancelled = r.status === 'cancelled'
              const title = r.kind === 'posting' ? 'Оприходование' : r.supplier?.name || 'Без поставщика'
              const itemCount = (r.items || []).length
              const loc = r.location?.name || null
              const sub = [loc, r.invoice_number ? `№ ${r.invoice_number}` : null].filter(Boolean).join(' · ')
              return (
                <View
                  key={r.id}
                  style={{
                    flexDirection: 'row',
                    gap: 12,
                    padding: 14,
                    borderBottomWidth: i < receipts.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                    opacity: cancelled ? 0.5 : 1,
                  }}
                >
                  <View style={{ alignItems: 'center', width: 44, paddingTop: 1 }}>
                    <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>{fmtDay(r.received_at)}</Text>
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text
                        style={{ color: T.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1, textDecorationLine: cancelled ? 'line-through' : 'none' }}
                        numberOfLines={1}
                      >
                        {title}
                      </Text>
                      {cancelled ? <Pill text="отменена" tone="bad" /> : null}
                    </View>
                    {sub ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{sub}</Text>
                    ) : null}
                    {r.comment ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{r.comment}</Text>
                    ) : null}
                    <Text style={{ color: T.textMut, fontSize: 11, marginTop: 6 }}>Позиций: {itemCount}</Text>
                  </View>

                  <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                    <Text style={{ color: T.greenBright, fontSize: 15, fontWeight: '800' }}>{moneyShort(r.total_amount || 0)}</Text>
                  </View>
                </View>
              )
            })}
          </Card>
        )}

        {!loading && receipts.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Показано {receipts.length} документов
          </Text>
        ) : null}
      </ScrollView>

      {/* ─── Модалка: оприходование одной позиции ─────────────────────────── */}
      <Modal visible={formOpen} animationType="slide" transparent onRequestClose={() => setFormOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: T.bg2,
              borderTopLeftRadius: R.xl,
              borderTopRightRadius: R.xl,
              borderColor: T.border,
              borderWidth: 1,
              maxHeight: '92%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: S.lg, paddingBottom: S.md }}>
              <Text style={{ color: T.text, fontSize: 19, fontWeight: '900', flex: 1 }}>Создать приход</Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={T.textMut} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: S.xl, gap: S.md }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={{ color: T.textDim, fontSize: 12.5 }}>
                Оприходование — постановка товара на остаток без поставщика (инвентаризация, излишки,
                собственное производство).
              </Text>

              {/* Локация */}
              <View style={{ gap: 7 }}>
                <Text style={{ color: T.textMut, fontSize: 12.5, fontWeight: '700' }}>Локация</Text>
                {postingLocations.length === 0 ? (
                  <Text style={{ color: T.textDim, fontSize: 12.5 }}>Нет доступных складов/витрин</Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {postingLocations.map((l) => {
                      const active = l.id === locationId
                      return (
                        <Pressable
                          key={l.id}
                          onPress={() => setLocationId(l.id)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 9,
                            borderRadius: R.md,
                            borderWidth: 1,
                            borderColor: active ? T.green : T.border,
                            backgroundColor: active ? T.greenSoft : T.card,
                          }}
                        >
                          <Text style={{ color: active ? T.greenBright : T.textMut, fontSize: 13, fontWeight: '700' }}>
                            {locLabel(l)}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                )}
              </View>

              {/* Товар */}
              <View style={{ gap: 7 }}>
                <Text style={{ color: T.textMut, fontSize: 12.5, fontWeight: '700' }}>Товар</Text>
                {item ? (
                  <Pressable
                    onPress={() => setItem(null)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      padding: 12,
                      borderRadius: R.md,
                      borderWidth: 1,
                      borderColor: T.green,
                      backgroundColor: T.card,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{item.name || 'Без названия'}</Text>
                      <Text style={{ color: T.textDim, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
                        {item.barcode ? `${item.barcode} · ` : ''}{item.unit || 'шт'}
                      </Text>
                    </View>
                    <Ionicons name="close-circle" size={20} color={T.textDim} />
                  </Pressable>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.md, paddingHorizontal: 12 }}>
                      <Ionicons name="search" size={16} color={T.textDim} />
                      <TextInput
                        value={itemSearch}
                        onChangeText={setItemSearch}
                        placeholder="Название или штрихкод"
                        placeholderTextColor={T.textDim}
                        style={{ flex: 1, color: T.text, fontSize: 14, paddingVertical: 10 }}
                        autoCorrect={false}
                        autoCapitalize="none"
                      />
                    </View>
                    {catalogError ? (
                      <Text style={{ color: T.red, fontSize: 12 }}>{catalogError}</Text>
                    ) : catalogLoading ? (
                      <ActivityIndicator color={T.green} style={{ marginVertical: 12 }} />
                    ) : (
                      <View style={{ backgroundColor: T.card, borderRadius: R.md, borderWidth: 1, borderColor: T.border, overflow: 'hidden', maxHeight: 240 }}>
                        <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                          {filteredCatalog.length === 0 ? (
                            <Text style={{ color: T.textDim, fontSize: 12.5, padding: 14 }}>
                              {catalog.length === 0 ? 'Каталог пуст' : 'Ничего не найдено'}
                            </Text>
                          ) : (
                            filteredCatalog.map((it, idx) => (
                              <Pressable
                                key={it.id}
                                onPress={() => {
                                  setItem(it)
                                  if (Number(it.default_purchase_price || 0) > 0 && !unitCost) {
                                    setUnitCost(String(it.default_purchase_price))
                                  }
                                }}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 10,
                                  paddingVertical: 11,
                                  paddingHorizontal: 12,
                                  borderBottomWidth: idx < filteredCatalog.length - 1 ? 1 : 0,
                                  borderBottomColor: T.borderSoft,
                                }}
                              >
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={{ color: T.text, fontSize: 13.5, fontWeight: '600' }} numberOfLines={1}>{it.name || 'Без названия'}</Text>
                                  <Text style={{ color: T.textDim, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                                    {it.barcode ? `${it.barcode} · ` : ''}{it.unit || 'шт'}
                                  </Text>
                                </View>
                                {Number(it.default_purchase_price || 0) > 0 ? (
                                  <Text style={{ color: T.textDim, fontSize: 11.5 }}>{money(it.default_purchase_price)}</Text>
                                ) : null}
                              </Pressable>
                            ))
                          )}
                        </ScrollView>
                      </View>
                    )}
                  </>
                )}
              </View>

              {/* Количество + себестоимость */}
              <View style={{ flexDirection: 'row', gap: S.md }}>
                <View style={{ flex: 1, gap: 7 }}>
                  <Text style={{ color: T.textMut, fontSize: 12.5, fontWeight: '700' }}>Количество</Text>
                  <TextInput
                    value={qty}
                    onChangeText={setQty}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="decimal-pad"
                    style={{ color: T.text, fontSize: 15, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 11 }}
                  />
                </View>
                <View style={{ flex: 1, gap: 7 }}>
                  <Text style={{ color: T.textMut, fontSize: 12.5, fontWeight: '700' }}>Себестоимость, ₸</Text>
                  <TextInput
                    value={unitCost}
                    onChangeText={setUnitCost}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="decimal-pad"
                    style={{ color: T.text, fontSize: 15, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 11 }}
                  />
                </View>
              </View>

              {/* Срок годности (обязателен для товаров с requires_expiry) */}
              <View style={{ gap: 7 }}>
                <Text style={{ color: T.textMut, fontSize: 12.5, fontWeight: '700' }}>
                  Срок годности (ГГГГ-ММ-ДД){requiresExpiry ? ' — обязателен' : ''}
                </Text>
                <TextInput
                  value={expiry}
                  onChangeText={setExpiry}
                  placeholder="2026-12-31"
                  placeholderTextColor={T.textDim}
                  autoCorrect={false}
                  autoCapitalize="none"
                  style={{ color: T.text, fontSize: 15, backgroundColor: T.card, borderWidth: 1, borderColor: requiresExpiry && !expiry.trim() ? T.amber : T.border, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 11 }}
                />
                {item && !requiresExpiry ? (
                  <Text style={{ color: T.textDim, fontSize: 11.5 }}>Этот товар без срока годности — можно оставить пустым.</Text>
                ) : null}
              </View>

              {/* Комментарий */}
              <View style={{ gap: 7 }}>
                <Text style={{ color: T.textMut, fontSize: 12.5, fontWeight: '700' }}>Комментарий</Text>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Причина оприходования"
                  placeholderTextColor={T.textDim}
                  style={{ color: T.text, fontSize: 14.5, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 11 }}
                />
              </View>

              {/* Итог строки */}
              {item && num(qty) > 0 ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
                  <Text style={{ color: T.textMut, fontSize: 13 }}>Сумма прихода</Text>
                  <Text style={{ color: T.greenBright, fontSize: 17, fontWeight: '900' }}>{money(num(qty) * num(unitCost))}</Text>
                </View>
              ) : null}

              {formError ? (
                <View style={{ backgroundColor: '#3b1212', borderRadius: R.md, padding: 12 }}>
                  <Text style={{ color: T.red, fontSize: 12.5 }}>{formError}</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.xs }}>
                <GhostButton label="Отмена" onPress={() => setFormOpen(false)} disabled={saving} style={{ flex: 1 }} />
                <PrimaryButton label="Оприходовать" loading={saving} disabled={saving} onPress={() => void submit()} style={{ flex: 1.4 }} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
