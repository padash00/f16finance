import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'

type Expense = {
  id: string
  date: string | null
  company_id: string | null
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
  status: string | null
  one_off_payee: string | null
  created_at: string | null
}

const STATUS: Record<string, { text: string; tone: 'good' | 'warn' | 'bad' | 'mut' }> = {
  approved: { text: 'Одобрен', tone: 'good' },
  pending_approval: { text: 'Ожидает', tone: 'warn' },
  declined: { text: 'Отклонён', tone: 'bad' },
}

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const monthRange = (d: Date) => ({ from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) })
const amountOf = (e: Expense) => Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0)
const fmtDay = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—')

export default function ExpensesScreen() {
  const router = useRouter()
  const [cursor, setCursor] = useState(() => new Date())
  const [items, setItems] = useState<Expense[]>([])
  const [companyName, setCompanyName] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: Date) => {
    setLoading(true); setError(null)
    const { from, to } = monthRange(d)
    try {
      const [exp, comp] = await Promise.all([
        apiFetch<{ data: Expense[] }>(`/api/admin/expenses?from=${from}&to=${to}&sort=date_desc`),
        apiFetch<{ data: Array<{ id: string; name?: string }> }>('/api/admin/companies').catch(() => ({ data: [] })),
      ])
      setItems(exp.data || [])
      const map: Record<string, string> = {}
      for (const c of comp.data || []) if (c?.id) map[String(c.id)] = c.name || ''
      setCompanyName(map)
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
    let total = 0, approved = 0, pending = 0
    for (const e of items) {
      const a = amountOf(e)
      total += a
      if (e.status === 'approved') approved += a
      else if (e.status === 'pending_approval') pending += a
    }
    return { total, approved, pending }
  }, [items])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '800', flex: 1 }}>Расходы</Text>
      </View>

      {/* Переключатель месяца */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 6 }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={{ padding: 6 }}><Ionicons name="chevron-back" size={20} color={T.textMut} /></Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>
          {cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable onPress={() => !isCurrentMonth && shiftMonth(1)} hitSlop={10} style={{ padding: 6, opacity: isCurrentMonth ? 0.3 : 1 }} disabled={isCurrentMonth}>
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 18, paddingTop: 6, paddingBottom: 28, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load(cursor)} tintColor={T.green} />}
      >
        {/* Сводка */}
        <GlowHero glow={T.amber}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО ЗА МЕСЯЦ</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.total)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`одобрено ${money(summary.approved)}`} tone="good" />
            {summary.pending > 0 ? <Pill text={`ожидает ${money(summary.pending)}`} tone="warn" /> : null}
          </View>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>{items.length} записей</Text>
        </GlowHero>

        {error ? <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontSize: 13 }}>{error}</Text></Card> : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : items.length === 0 && !loading ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Ionicons name="receipt-outline" size={36} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14, marginTop: 8 }}>В этом месяце расходов нет</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {items.map((e, i) => {
              const st = e.status ? STATUS[e.status] : null
              const title = e.one_off_payee || e.category || 'Расход'
              const cmp = e.company_id ? companyName[e.company_id] : null
              return (
                <View key={e.id} style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: T.border }}>
                  <View style={{ alignItems: 'center', width: 42 }}>
                    <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>{fmtDay(e.date || e.created_at)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{title}</Text>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                      {cmp ? `${cmp}` : ''}{e.comment ? `${cmp ? ' · ' : ''}${e.comment}` : ''}
                    </Text>
                    {st ? <View style={{ marginTop: 6, alignSelf: 'flex-start' }}><Pill text={st.text} tone={st.tone} /></View> : null}
                  </View>
                  <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{money(amountOf(e))}</Text>
                </View>
              )
            })}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
