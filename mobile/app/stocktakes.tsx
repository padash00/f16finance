import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented, ErrorState, EmptyState } from '@/components/ui'

type InvItem = {
  id: string
  name?: string | null
  barcode?: string | null
  sale_price?: number | null
  default_purchase_price?: number | null
}

type RevisionLine = {
  id: string
  expected_qty?: number | null
  actual_qty?: number | null
  delta_qty?: number | null
  comment?: string | null
  item?: InvItem | null
}

type Location = {
  id: string
  name?: string | null
  location_type?: 'warehouse' | 'point_display' | string | null
  company?: { id: string; name?: string | null } | null
}

type Revision = {
  id: string
  counted_at: string
  comment?: string | null
  created_by?: string | null
  created_by_staff?: { id: string; full_name?: string | null; role?: string | null } | null
  location?: Location | null
  items?: RevisionLine[]
}

type Resp = {
  ok: boolean
  data?: {
    stocktakes?: Revision[]
  }
  error?: string
}

type Scope = 'all' | 'warehouse' | 'showcase'

const formatQty = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const actorLabel = (r: Revision) => {
  const name = r.created_by_staff?.full_name?.trim()
  if (name) return name
  if (r.created_by) return `ID ${String(r.created_by).slice(0, 8)}`
  return '—'
}

const locationLabel = (loc: Location | null | undefined) => {
  if (!loc) return '—'
  return loc.company?.name || loc.name || '—'
}

type RevStats = { positions: number; shortage: number; surplus: number; saleAmount: number; purchaseAmount: number }

const statsOf = (r: Revision): RevStats => {
  const items = r.items || []
  let shortage = 0
  let surplus = 0
  let saleAmount = 0
  let purchaseAmount = 0
  for (const it of items) {
    const delta = Number(it.delta_qty || 0)
    if (delta < 0) shortage += Math.abs(delta)
    else if (delta > 0) surplus += delta
    const absDelta = Math.abs(delta)
    saleAmount += absDelta * Number(it.item?.sale_price || 0)
    purchaseAmount += absDelta * Number(it.item?.default_purchase_price || 0)
  }
  return { positions: items.length, shortage, surplus, saleAmount, purchaseAmount }
}

export default function StocktakesScreen() {
  const router = useRouter()
  const [scope, setScope] = useState<Scope>('all')
  const [items, setItems] = useState<Revision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async (s: Scope) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Resp>(`/api/admin/store/revisions?scope=${s}`)
      setItems(res?.data?.stocktakes || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(scope)
  }, [scope, load])

  const summary = useMemo(() => {
    let withMismatch = 0
    let shortage = 0
    let surplus = 0
    let damage = 0
    for (const r of items) {
      const st = statsOf(r)
      if (st.shortage > 0 || st.surplus > 0) withMismatch += 1
      shortage += st.shortage
      surplus += st.surplus
      damage += st.saleAmount
    }
    return { count: items.length, withMismatch, shortage, surplus, damage }
  }, [items])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Ревизии склада</Text>
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
        <GlowHero glow={T.amber}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>АКТОВ РЕВИЗИИ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.count}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            {summary.withMismatch > 0 ? <Pill text={`с расхождениями ${summary.withMismatch}`} tone="warn" /> : null}
            {summary.shortage > 0 ? <Pill text={`недостача ${formatQty(summary.shortage)}`} tone="bad" /> : null}
            {summary.surplus > 0 ? <Pill text={`излишек ${formatQty(summary.surplus)}`} tone="good" /> : null}
          </View>
          {summary.damage > 0 ? (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Ущерб по продаже: {moneyShort(summary.damage)}</Text>
          ) : null}
        </GlowHero>

        {error ? <ErrorState message={error} onRetry={() => load(scope)} /> : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && items.length === 0 ? (
          <EmptyState icon="clipboard-outline" title="Ревизий пока нет" />
        ) : (
          <Card style={{ padding: 0 }}>
            {items.map((r, i) => {
              const st = statsOf(r)
              const isOpen = openId === r.id
              const mismatch = st.shortage > 0 || st.surplus > 0
              const lines = r.items || []
              return (
                <View
                  key={r.id}
                  style={{ borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}
                >
                  <Pressable
                    onPress={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
                    style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                          {locationLabel(r.location)}
                        </Text>
                        {!mismatch ? <Pill text="без расхождений" tone="good" /> : null}
                      </View>
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {formatDate(r.counted_at)} · {actorLabel(r)} · {st.positions} поз.
                      </Text>
                      {r.comment ? (
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{r.comment}</Text>
                      ) : null}
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                        {st.shortage > 0 ? <Text style={{ color: T.red, fontSize: 11.5, fontWeight: '700' }}>−{formatQty(st.shortage)}</Text> : null}
                        {st.surplus > 0 ? <Text style={{ color: T.greenBright, fontSize: 11.5, fontWeight: '700' }}>+{formatQty(st.surplus)}</Text> : null}
                        {st.saleAmount > 0 ? <Text style={{ color: T.amber, fontSize: 11.5 }}>{moneyShort(st.saleAmount)}</Text> : null}
                      </View>
                    </View>
                    <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={T.textDim} style={{ marginTop: 2 }} />
                  </Pressable>

                  {isOpen ? (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 2 }}>
                      {lines.length === 0 ? (
                        <Text style={{ color: T.textDim, fontSize: 12, paddingVertical: 8 }}>Позиций нет</Text>
                      ) : (
                        lines.map((ln, j) => {
                          const delta = Number(ln.delta_qty || 0)
                          const deltaColor = delta === 0 ? T.textDim : delta > 0 ? T.greenBright : T.red
                          return (
                            <View
                              key={ln.id || `${r.id}-${j}`}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 8,
                                paddingVertical: 8,
                                borderTopWidth: 1,
                                borderTopColor: T.borderSoft,
                              }}
                            >
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: T.text, fontSize: 13 }} numberOfLines={1}>{ln.item?.name || 'Товар'}</Text>
                                {ln.comment ? (
                                  <Text style={{ color: T.textDim, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{ln.comment}</Text>
                                ) : null}
                              </View>
                              <Text style={{ color: T.textMut, fontSize: 12, width: 84, textAlign: 'right' }}>
                                {formatQty(Number(ln.expected_qty || 0))} → {formatQty(Number(ln.actual_qty || 0))}
                              </Text>
                              <Text style={{ color: deltaColor, fontSize: 13, fontWeight: '800', width: 56, textAlign: 'right' }}>
                                {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${formatQty(delta)}`}
                              </Text>
                            </View>
                          )
                        })
                      )}
                    </View>
                  ) : null}
                </View>
              )
            })}
          </Card>
        )}

        {!loading && items.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Нажмите на акт, чтобы раскрыть позиции
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
