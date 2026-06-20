import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented } from '@/components/ui'

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

type Scope = 'all' | 'warehouse' | 'showcase'

const fmtDay = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—'

export default function ReceiptsScreen() {
  const router = useRouter()
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Приёмка</Text>
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

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && !data ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && receipts.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="cube-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Документов приёмки пока нет</Text>
          </Card>
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
    </SafeAreaView>
  )
}
