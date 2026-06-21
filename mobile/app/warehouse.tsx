import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, ErrorState } from '@/components/ui'

type Balance = {
  location_id: string
  item_id: string
  quantity: number
  item?: any
  location?: any
}
type Overview = { balances: Balance[]; items?: any[]; locations?: any[] }

const one = (v: any) => (Array.isArray(v) ? v[0] : v)
const locKind = (t: string) => (t === 'warehouse' ? 'Склад' : t === 'point_display' ? 'Витрина' : t || '')

export default function WarehouseScreen() {
  const router = useRouter()
  const [d, setD] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const r = await apiFetch<{ data: Overview }>('/api/admin/inventory'); setD(r.data) }
    catch (e: any) { setError(e?.message || 'Не удалось загрузить') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const { positions, lowStock, locations } = useMemo(() => {
    const balances = (d?.balances || []).filter((b) => Number(b.quantity) > 0)
    const low: { id: string; name: string; qty: number; threshold: number; loc: string }[] = []
    const locMap = new Map<string, { name: string; kind: string; company: string | null; count: number; qty: number }>()
    for (const b of d?.balances || []) {
      const item = one(b.item); const loc = one(b.location)
      const qty = Number(b.quantity || 0)
      const th = Number(item?.low_stock_threshold || 0)
      if (th > 0 && qty <= th) low.push({ id: `${b.location_id}-${b.item_id}`, name: item?.name || 'Товар', qty, threshold: th, loc: loc?.name || '' })
      if (qty > 0 && loc) {
        const key = String(b.location_id)
        const e = locMap.get(key) || { name: loc?.name || 'Локация', kind: locKind(loc?.location_type), company: one(loc?.company)?.name || null, count: 0, qty: 0 }
        e.count += 1; e.qty += qty
        locMap.set(key, e)
      }
    }
    low.sort((a, b) => a.qty / a.threshold - b.qty / b.threshold)
    return { positions: balances.length, lowStock: low, locations: Array.from(locMap.values()).sort((a, b) => b.count - a.count) }
  }, [d])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Склад</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}>
        {loading && !d ? <ActivityIndicator color={T.green} style={{ marginTop: 40 }} /> : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : d ? (
          <>
            <GlowHero glow={lowStock.length > 0 ? T.amber : T.green}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ПОЗИЦИЙ НА ОСТАТКЕ</Text>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6 }}>{positions}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                <Pill text={`${locations.length} локаций`} tone="mut" />
                {lowStock.length > 0 ? <Pill text={`${lowStock.length} заканчивается`} tone="warn" /> : <Pill text="дефицита нет" tone="good" />}
              </View>
            </GlowHero>

            {lowStock.length > 0 ? (
              <>
                <SectionTitle hint={`${lowStock.length}`}>Заканчивается</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 4 }}>
                  {lowStock.slice(0, 20).map((it, i, arr) => (
                    <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(251,191,36,0.12)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="alert" size={15} color={T.amber} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.text, fontSize: 14 }} numberOfLines={1}>{it.name}</Text>
                        {it.loc ? <Text style={{ color: T.textDim, fontSize: 11 }}>{it.loc}</Text> : null}
                      </View>
                      <Text style={{ color: T.amber, fontSize: 13, fontWeight: '800' }}>{it.qty} / {it.threshold}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {locations.length > 0 ? (
              <>
                <SectionTitle>Локации</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 4 }}>
                  {locations.map((l, i, arr) => (
                    <View key={`${l.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: '#181d23', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={l.kind === 'Витрина' ? 'storefront-outline' : 'cube-outline'} size={19} color={T.textMut} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>{l.company ? `${l.company} · ` : ''}{l.kind || l.name}</Text>
                        <Text style={{ color: T.textDim, fontSize: 12 }}>{l.count} позиций</Text>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
