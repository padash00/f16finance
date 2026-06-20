import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented } from '@/components/ui'

type Company = { id: string; name: string; code: string | null } | null

type Location = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display' | string
  company?: Company | Company[] | null
} | null

type Movement = {
  id: string
  movement_type: string
  quantity: number | null
  unit_cost: number | null
  total_amount: number | null
  reference_type: string | null
  comment: string | null
  created_at: string | null
  item?: { id: string; name: string; barcode: string; unit?: string | null } | { id: string; name: string; barcode: string; unit?: string | null }[] | null
  from_location?: Location | Location[]
  to_location?: Location | Location[]
}

type Scope = 'all' | 'warehouse' | 'showcase'

const firstOrSelf = <X,>(v: X | X[] | null | undefined): X | null => {
  if (Array.isArray(v)) return (v[0] as X) || null
  return (v as X) ?? null
}

const TYPE_LABEL: Record<string, string> = {
  receipt: 'Приемка',
  receipt_cancel: 'Отмена приёмки',
  transfer_to_point: 'Выдача на точку',
  transfer_cancel: 'Откат выдачи',
  transfer_warehouse_to_showcase: 'Получение точкой',
  transfer_showcase_to_warehouse: 'Возврат на склад',
  reservation: 'Резерв',
  reservation_release: 'Снятие резерва',
  sale: 'Продажа',
  debt: 'Долг',
  return: 'Возврат с кассы',
  writeoff: 'Списание',
  inventory_adjustment: 'Корректировка',
  set_stock: 'Синхронизация',
  posting: 'Оприходование',
  migration_initial: 'Миграция',
  auto_warehouse_to_showcase: 'Авто-перенос',
}

const typeLabel = (t: string) => TYPE_LABEL[t] || t

const typeTone = (t: string): 'good' | 'bad' | 'warn' | 'mut' | 'brand' => {
  if (t === 'receipt' || t === 'posting') return 'good'
  if (t === 'receipt_cancel') return 'bad'
  if (t === 'transfer_to_point' || t === 'transfer_warehouse_to_showcase') return 'brand'
  if (t === 'transfer_cancel' || t === 'transfer_showcase_to_warehouse') return 'warn'
  if (t === 'reservation' || t === 'reservation_release') return 'warn'
  if (t === 'sale' || t === 'debt' || t === 'return') return 'warn'
  if (t === 'writeoff') return 'bad'
  return 'mut'
}

const formatQty = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

const formatDateTime = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

const locName = (loc: Location | Location[] | null | undefined): string => {
  const l = firstOrSelf(loc)
  if (!l) return '—'
  const c = firstOrSelf(l.company)
  return c?.name || l.name || '—'
}

export default function MovementsScreen() {
  const router = useRouter()
  const [scope, setScope] = useState<Scope>('all')
  const [items, setItems] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (sc: Scope) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ ok?: boolean; data?: { movements?: Movement[] } }>(
        `/api/admin/store/movements?scope=${sc}`,
      )
      setItems(res.data?.movements || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить движения')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(scope)
  }, [scope, load])

  const summary = useMemo(() => {
    let total = 0
    let receipts = 0
    let transfers = 0
    for (const m of items) {
      total += Number(m.total_amount || 0)
      if (m.movement_type === 'receipt') receipts += 1
      if (m.movement_type === 'transfer_to_point') transfers += 1
    }
    return { count: items.length, total, receipts, transfers }
  }, [items])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Движения склада</Text>
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
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load(scope)} tintColor={T.green} />}
      >
        <GlowHero glow={T.green}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО ДВИЖЕНИЙ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.count}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            {summary.receipts > 0 ? <Pill text={`приёмок ${summary.receipts}`} tone="good" /> : null}
            {summary.transfers > 0 ? <Pill text={`выдач ${summary.transfers}`} tone="brand" /> : null}
          </View>
          {summary.total > 0 ? (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Сумма движений: {moneyShort(summary.total)}</Text>
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
        ) : !loading && items.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="cube-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Движений не найдено</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {items.map((m, i) => {
              const item = firstOrSelf(m.item)
              const qty = Number(m.quantity || 0)
              const from = locName(m.from_location)
              const to = locName(m.to_location)
              return (
                <View
                  key={m.id}
                  style={{
                    padding: 14,
                    gap: 6,
                    borderBottomWidth: i < items.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>
                        {item?.name || 'Товар'}
                      </Text>
                      <Text style={{ color: T.textDim, fontSize: 11.5, marginTop: 2 }}>{formatDateTime(m.created_at)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '800' }}>
                        {formatQty(qty)} <Text style={{ color: T.textDim, fontSize: 12 }}>{item?.unit || 'шт'}</Text>
                      </Text>
                      {m.total_amount != null ? (
                        <Text style={{ color: T.greenBright, fontSize: 12.5, fontWeight: '700', marginTop: 2 }}>{money(Number(m.total_amount))}</Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pill text={typeLabel(m.movement_type)} tone={typeTone(m.movement_type)} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}>
                      <Text style={{ color: T.textMut, fontSize: 12 }} numberOfLines={1}>{from}</Text>
                      <Ionicons name="arrow-forward" size={12} color={T.textDim} />
                      <Text style={{ color: T.textMut, fontSize: 12 }} numberOfLines={1}>{to}</Text>
                    </View>
                  </View>

                  {m.comment ? (
                    <Text style={{ color: T.textDim, fontSize: 12 }} numberOfLines={2}>{m.comment}</Text>
                  ) : null}
                </View>
              )
            })}
          </Card>
        )}

        {!loading && items.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Показано {items.length} последних движений
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
