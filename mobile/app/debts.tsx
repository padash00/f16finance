import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero } from '@/components/ui'

type Item = { id: string; company_name: string; debtor_name: string; item_name: string; quantity: number; total_amount: number; created_by_name: string; comment: string | null; created_at: string }
type Resp = { weekStart: string; weekEnd: string; items: Item[]; totals: { count: number; amount: number } }

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const mondayOf = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x }

export default function DebtsScreen() {
  const router = useRouter()
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const [d, setD] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (ws: Date) => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<{ data: Resp }>(`/api/admin/point-debts?weekStart=${iso(ws)}`)
      setD(res.data)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(week) }, [week, load])

  const shiftWeek = (delta: number) => setWeek((w) => { const x = new Date(w); x.setDate(x.getDate() + delta * 7); return x })
  const isThisWeek = useMemo(() => iso(week) === iso(mondayOf(new Date())), [week])

  // группировка по компании
  const byCompany = useMemo(() => {
    const m = new Map<string, { name: string; items: Item[]; amount: number }>()
    for (const it of d?.items || []) {
      const e = m.get(it.company_name) || { name: it.company_name, items: [], amount: 0 }
      e.items.push(it); e.amount += Number(it.total_amount || 0)
      m.set(it.company_name, e)
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount)
  }, [d])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Долги с точки</Text>
      </View>

      {/* неделя */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Pressable onPress={() => shiftWeek(-1)} hitSlop={10} style={{ padding: 6 }}><Ionicons name="chevron-back" size={20} color={T.textMut} /></Pressable>
        <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }}>{d ? `${new Date(d.weekStart).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })} — ${new Date(d.weekEnd).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}` : '…'}</Text>
        <Pressable onPress={() => !isThisWeek && shiftWeek(1)} hitSlop={10} disabled={isThisWeek} style={{ padding: 6, opacity: isThisWeek ? 0.3 : 1 }}><Ionicons name="chevron-forward" size={20} color={T.textMut} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={() => load(week)} tintColor={T.green} />}>
        {loading && !d ? <ActivityIndicator color={T.green} style={{ marginTop: 40 }} /> : error ? (
          <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : d ? (
          <>
            <GlowHero glow={T.amber}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ДОЛГОВ ЗА НЕДЕЛЮ</Text>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(d.totals.amount)}</Text>
              <Text style={{ color: T.textMut, fontSize: 13, marginTop: 3 }}>{d.totals.count} позиций</Text>
            </GlowHero>

            {byCompany.length === 0 ? (
              <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
                <Ionicons name="checkmark-done-circle" size={38} color={T.green} />
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>Долгов на этой неделе нет</Text>
              </Card>
            ) : byCompany.map((g) => (
              <View key={g.name} style={{ gap: S.sm }}>
                <SectionTitle hint={moneyShort(g.amount)}>{g.name}</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 4 }}>
                  {g.items.map((it, i, arr) => (
                    <View key={it.id} style={{ paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <Text style={{ color: T.text, fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>{it.debtor_name}</Text>
                        <Text style={{ color: T.amber, fontSize: 14.5, fontWeight: '800' }}>{money(it.total_amount)}</Text>
                      </View>
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {it.item_name}{it.quantity > 1 ? ` × ${it.quantity}` : ''}{it.comment ? ` · ${it.comment}` : ''}
                      </Text>
                    </View>
                  ))}
                </Card>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
