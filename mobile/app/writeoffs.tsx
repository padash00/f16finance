import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented, ErrorState, EmptyState, SkeletonList } from '@/components/ui'

type InventoryItem = {
  id: string
  name: string
  barcode: string
  unit: string
  item_type: string
}

type InventoryLocation = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
  company?: { id: string; name: string; code: string | null } | null
}

type WriteoffLine = {
  id: string
  quantity: number
  unit_cost: number
  total_cost: number
  comment: string | null
  item?: InventoryItem | null
}

type Writeoff = {
  id: string
  written_at: string
  reason: string
  comment: string | null
  total_amount: number
  status?: 'posted' | 'cancelled'
  cancelled_at?: string | null
  cancel_reason?: string | null
  location?: InventoryLocation | null
  items?: WriteoffLine[]
}

type WriteoffsData = {
  items?: InventoryItem[]
  locations?: InventoryLocation[]
  balances?: unknown[]
  writeoffs?: Writeoff[]
}

type Scope = 'all' | 'warehouse' | 'showcase'

const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}

const fmtQty = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

const locationLabel = (loc: InventoryLocation | null | undefined) => {
  if (!loc) return '—'
  return loc.company?.name || loc.name || '—'
}

export default function WriteoffsScreen() {
  const router = useRouter()
  const [scope, setScope] = useState<Scope>('all')
  const [data, setData] = useState<WriteoffsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async (s: Scope) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ ok: boolean; data?: WriteoffsData }>(`/api/admin/store/writeoffs?scope=${s}`)
      setData(res.data || {})
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить списания')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(scope)
  }, [scope, load])

  const writeoffs = useMemo(() => data?.writeoffs || [], [data])

  const summary = useMemo(() => {
    let total = 0
    let cancelled = 0
    const reasons = new Set<string>()
    for (const w of writeoffs) {
      const isCancelled = w.status === 'cancelled'
      if (isCancelled) cancelled += 1
      else total += Number(w.total_amount || 0)
      if (w.reason) reasons.add(w.reason)
    }
    return { total, cancelled, reasons: reasons.size, count: writeoffs.length }
  }, [writeoffs])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Списания</Text>
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
        refreshControl={<RefreshControl refreshing={loading && writeoffs.length > 0} onRefresh={() => load(scope)} tintColor={T.green} />}
      >
        <GlowHero glow={T.red}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>СУММА СПИСАНИЙ</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.total)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`${summary.count} документов`} tone="mut" />
            {summary.reasons > 0 ? <Pill text={`причин ${summary.reasons}`} tone="warn" /> : null}
            {summary.cancelled > 0 ? <Pill text={`отменено ${summary.cancelled}`} tone="bad" /> : null}
          </View>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Брак, просрочка, служебный расход</Text>
        </GlowHero>

        {error ? <ErrorState message={error} onRetry={() => load(scope)} /> : null}

        {loading && writeoffs.length === 0 ? (
          <SkeletonList rows={6} />
        ) : !loading && writeoffs.length === 0 ? (
          <EmptyState icon="trash-outline" title="Списаний пока нет" />
        ) : (
          <Card style={{ padding: 0 }}>
            {writeoffs.map((w, i) => {
              const isCancelled = w.status === 'cancelled'
              const lines = w.items || []
              const open = expanded === w.id
              return (
                <View
                  key={w.id}
                  style={{
                    borderBottomWidth: i < writeoffs.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <Pressable
                    onPress={() => setExpanded(open ? null : w.id)}
                    style={{ flexDirection: 'row', gap: 12, padding: 14 }}
                  >
                    <View style={{ alignItems: 'center', width: 46 }}>
                      <Ionicons name="trash" size={18} color={isCancelled ? T.textDim : T.red} />
                      <Text style={{ color: T.textDim, fontSize: 10, fontWeight: '700', marginTop: 4, textAlign: 'center' }}>
                        {fmtDate(w.written_at).replace(/ \d{4}$/, '')}
                      </Text>
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                          {w.reason || 'Без причины'}
                        </Text>
                        {isCancelled ? <Pill text="отменено" tone="warn" /> : null}
                      </View>
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {locationLabel(w.location)}
                        {lines.length > 0 ? ` • ${lines.length} поз.` : ''}
                      </Text>
                      {w.comment ? (
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{w.comment}</Text>
                      ) : null}
                    </View>

                    <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                      <Text
                        style={{
                          color: isCancelled ? T.textDim : T.red,
                          fontSize: 15,
                          fontWeight: '800',
                          textDecorationLine: isCancelled ? 'line-through' : 'none',
                        }}
                      >
                        {money(Number(w.total_amount || 0))}
                      </Text>
                      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={T.textDim} style={{ marginTop: 4 }} />
                    </View>
                  </Pressable>

                  {open ? (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
                      {isCancelled ? (
                        <View style={{ backgroundColor: 'rgba(251,191,36,0.10)', borderColor: 'rgba(251,191,36,0.28)', borderWidth: 1, borderRadius: 12, padding: 10 }}>
                          <Text style={{ color: T.amber, fontSize: 12 }}>
                            Списание отменено{w.cancelled_at ? ` • ${fmtDate(w.cancelled_at)}` : ''}. Товар возвращён на остаток.
                            {w.cancel_reason ? ` Причина: ${w.cancel_reason}` : ''}
                          </Text>
                        </View>
                      ) : null}

                      {lines.length === 0 ? (
                        <Text style={{ color: T.textDim, fontSize: 12 }}>Позиции не указаны</Text>
                      ) : (
                        <View style={{ backgroundColor: T.card2, borderRadius: 12, overflow: 'hidden' }}>
                          {lines.map((ln, li) => (
                            <View
                              key={ln.id}
                              style={{
                                flexDirection: 'row',
                                gap: 10,
                                paddingVertical: 9,
                                paddingHorizontal: 12,
                                borderBottomWidth: li < lines.length - 1 ? 1 : 0,
                                borderBottomColor: T.borderSoft,
                              }}
                            >
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: T.text, fontSize: 13 }} numberOfLines={1}>{ln.item?.name || 'Товар'}</Text>
                                <Text style={{ color: T.textDim, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                                  {fmtQty(Number(ln.quantity || 0))} {ln.item?.unit || 'шт'} × {money(Number(ln.unit_cost || 0))}
                                  {ln.comment ? ` • ${ln.comment}` : ''}
                                </Text>
                              </View>
                              <Text style={{ color: T.text, fontSize: 13, fontWeight: '700' }}>{money(Number(ln.total_cost || 0))}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      <Text style={{ color: T.textDim, fontSize: 11 }}>Дата: {fmtDate(w.written_at)}</Text>
                    </View>
                  ) : null}
                </View>
              )
            })}
          </Card>
        )}

        {!loading && writeoffs.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Всего документов: {writeoffs.length} • активная сумма {moneyShort(summary.total)}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
