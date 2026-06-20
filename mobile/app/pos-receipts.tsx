import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'

type SaleItem = {
  id: string
  item_id: string | null
  quantity: number | null
  unit_price: number | null
  total_price: number | null
  inventory_items: { name: string } | null
}

type Sale = {
  id: string
  sale_date: string | null
  sold_at: string | null
  payment_method: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
  total_amount: number | null
  discount_amount: number | null
  loyalty_points_earned: number | null
  loyalty_points_spent: number | null
  loyalty_discount_amount: number | null
  customer_id: string | null
  source: string | null
  comment: string | null
  items: SaleItem[]
}

type Resp = { ok?: boolean; data?: Sale[]; total?: number; page?: number; page_size?: number }

const PAYMENT: Record<string, { label: string; tone: 'good' | 'warn' | 'brand' | 'mut' | 'bad' }> = {
  cash: { label: 'Наличные', tone: 'good' },
  kaspi: { label: 'Безналичный', tone: 'warn' },
  card: { label: 'Карта', tone: 'brand' },
  online: { label: 'Онлайн', tone: 'warn' },
  mixed: { label: 'Смешанный', tone: 'mut' },
}

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const monthRange = (d: Date) => ({ from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) })

const detectMethod = (s: Sale): string => {
  if (s.payment_method && PAYMENT[s.payment_method]) return s.payment_method
  const nonZero = [
    Number(s.cash_amount || 0) > 0 ? 'cash' : null,
    Number(s.kaspi_amount || 0) > 0 ? 'kaspi' : null,
    Number(s.card_amount || 0) > 0 ? 'card' : null,
    Number(s.online_amount || 0) > 0 ? 'online' : null,
  ].filter(Boolean) as string[]
  if (nonZero.length === 0) return 'cash'
  if (nonZero.length === 1) return nonZero[0]
  return 'mixed'
}

const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '')
const fmtDay = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—')
const shortId = (id: string) => `#${(id || '').slice(-6).toUpperCase()}`

export default function PosReceiptsScreen() {
  const router = useRouter()
  const [cursor, setCursor] = useState(() => new Date())
  const [items, setItems] = useState<Sale[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const load = useCallback(async (d: Date) => {
    setLoading(true); setError(null)
    const { from, to } = monthRange(d)
    try {
      const res = await apiFetch<Resp>(`/api/pos/receipts?date_from=${from}&date_to=${to}&page=1`)
      setItems((res.data || []).map((s) => ({ ...s, items: Array.isArray(s.items) ? s.items : [] })))
      setTotal(Number(res.total || 0))
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(cursor) }, [cursor, load])

  const shiftMonth = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  const isCurrentMonth = useMemo(() => {
    const now = new Date()
    return cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()
  }, [cursor])

  const summary = useMemo(() => {
    let sum = 0
    for (const s of items) sum += Number(s.total_amount || 0)
    return { sum, count: items.length }
  }, [items])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>POS-чеки</Text>
      </View>

      {/* Переключатель месяца */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={{ padding: 6 }}><Ionicons name="chevron-back" size={20} color={T.textMut} /></Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>
          {cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable onPress={() => !isCurrentMonth && shiftMonth(1)} hitSlop={10} disabled={isCurrentMonth} style={{ padding: 6, opacity: isCurrentMonth ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load(cursor)} tintColor={T.green} />}
      >
        <GlowHero glow={T.green}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВЫРУЧКА ПО ЧЕКАМ</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.sum)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`${summary.count} чеков`} tone="good" />
            {total > items.length ? <Pill text={`всего ${total}`} tone="mut" /> : null}
          </View>
          {total > items.length ? (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Показаны последние {items.length} из {total}</Text>
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
            <Ionicons name="receipt-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Чеки не найдены</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {items.map((s, i) => {
              const method = detectMethod(s)
              const pm = PAYMENT[method] || PAYMENT.mixed
              const isOpen = !!open[s.id]
              const goods = s.items || []
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
                  style={{ padding: 14, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ alignItems: 'center', width: 46 }}>
                      <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>{fmtDay(s.sold_at || s.sale_date)}</Text>
                      <Text style={{ color: T.textDim, fontSize: 11, marginTop: 1 }}>{fmtTime(s.sold_at)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: T.text, fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{shortId(s.id)}</Text>
                        <Pill text={pm.label} tone={pm.tone} />
                      </View>
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
                        {goods.length} тов.{s.comment ? ` · ${s.comment}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: T.greenBright, fontSize: 15, fontWeight: '800' }}>{money(s.total_amount)}</Text>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={T.textDim} style={{ marginTop: 3 }} />
                    </View>
                  </View>

                  {isOpen ? (
                    <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: T.borderSoft, gap: 6 }}>
                      {goods.length === 0 ? (
                        <Text style={{ color: T.textDim, fontSize: 12 }}>Позиции не указаны</Text>
                      ) : goods.map((g) => (
                        <View key={g.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                          <Text style={{ color: T.textMut, fontSize: 12.5, flex: 1 }} numberOfLines={1}>
                            {g.inventory_items?.name || '—'}{Number(g.quantity || 0) > 1 ? ` × ${g.quantity}` : ''}
                          </Text>
                          <Text style={{ color: T.text, fontSize: 12.5, fontWeight: '700' }}>{money(g.total_price)}</Text>
                        </View>
                      ))}
                      {Number(s.discount_amount || 0) > 0 ? (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ color: T.textDim, fontSize: 12 }}>Скидка</Text>
                          <Text style={{ color: T.red, fontSize: 12, fontWeight: '700' }}>−{money(s.discount_amount)}</Text>
                        </View>
                      ) : null}
                      {Number(s.loyalty_discount_amount || 0) > 0 ? (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ color: T.textDim, fontSize: 12 }}>Баллы лояльности</Text>
                          <Text style={{ color: T.amber, fontSize: 12, fontWeight: '700' }}>−{money(s.loyalty_discount_amount)}</Text>
                        </View>
                      ) : null}
                      {Number(s.loyalty_points_earned || 0) > 0 ? (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ color: T.textDim, fontSize: 12 }}>Начислено баллов</Text>
                          <Text style={{ color: T.amber, fontSize: 12, fontWeight: '700' }}>+{s.loyalty_points_earned}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </Pressable>
              )
            })}
          </Card>
        )}

        {!loading && items.length > 0 && total > items.length ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Всего за месяц {total} чеков · показано {items.length} ({moneyShort(summary.sum)})
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
