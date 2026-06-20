import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero } from '@/components/ui'

// Возврат по чеку (таблица point_returns). Только просмотр.
type ReturnRow = {
  id: string
  sale_id?: string | null
  company_id?: string | null
  company_name?: string | null
  operator_name?: string | null
  total_amount?: number | null
  cash_amount?: number | null
  kaspi_amount?: number | null
  comment?: string | null
  shift?: string | null
  return_date?: string | null
  returned_at?: string | null
  created_at?: string | null
  items_count?: number | null
}

type Totals = { count?: number | null; amount?: number | null; cash?: number | null; kaspi?: number | null }
type Resp = { items?: ReturnRow[] | null; totals?: Totals | null; from?: string | null; to?: string | null }

const iso = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const monthRange = (d: Date) => ({
  from: iso(new Date(d.getFullYear(), d.getMonth(), 1)),
  to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
})

const amountOf = (r: ReturnRow) => {
  const total = Number(r.total_amount || 0)
  if (total > 0) return total
  return Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
}

const dateOf = (r: ReturnRow) => r.returned_at || r.return_date || r.created_at || null
const fmtDay = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—'
const shortId = (id: string | null | undefined) => (id ? `#${String(id).slice(-6).toUpperCase()}` : '')

export default function PosReturnsScreen() {
  const router = useRouter()
  const [cursor, setCursor] = useState(() => new Date())
  const [data, setData] = useState<Resp | null>(null)
  const [companyName, setCompanyName] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: Date) => {
    setLoading(true)
    setError(null)
    const { from, to } = monthRange(d)
    try {
      const [res, comp] = await Promise.all([
        apiFetch<{ data: Resp }>(`/api/admin/pos-returns?from=${from}&to=${to}`),
        apiFetch<{ data: Array<{ id: string; name?: string }> }>('/api/admin/companies').catch(() => ({ data: [] })),
      ])
      setData(res?.data || {})
      const map: Record<string, string> = {}
      for (const c of comp?.data || []) if (c?.id) map[String(c.id)] = c.name || ''
      setCompanyName(map)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(cursor)
  }, [cursor, load])

  const shiftMonth = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  const isCurrentMonth = useMemo(() => {
    const now = new Date()
    return cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()
  }, [cursor])

  const items = useMemo(() => (data?.items || []).slice(), [data])

  const summary = useMemo(() => {
    const t = data?.totals
    if (t && (t.amount != null || t.count != null)) {
      return { amount: Number(t.amount || 0), count: Number(t.count || items.length) }
    }
    let amount = 0
    for (const r of items) amount += amountOf(r)
    return { amount, count: items.length }
  }, [data, items])

  // группировка по компании
  const byCompany = useMemo(() => {
    const m = new Map<string, { name: string; items: ReturnRow[]; amount: number }>()
    for (const r of items) {
      const cid = String(r.company_id || '')
      const name = r.company_name || (cid ? companyName[cid] : '') || 'Без точки'
      const key = name
      const e = m.get(key) || { name, items: [], amount: 0 }
      e.items.push(r)
      e.amount += amountOf(r)
      m.set(key, e)
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount)
  }, [items, companyName])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>POS-возвраты</Text>
      </View>

      {/* Переключатель месяца */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={20} color={T.textMut} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>
          {cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable onPress={() => !isCurrentMonth && shiftMonth(1)} hitSlop={10} disabled={isCurrentMonth} style={{ padding: 6, opacity: isCurrentMonth ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => load(cursor)} tintColor={T.green} />}
      >
        {/* Сводка */}
        <GlowHero glow={T.red}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВОЗВРАТОВ ЗА МЕСЯЦ</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.amount)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`${summary.count} возвратов`} tone="bad" />
            {byCompany.length > 0 ? <Pill text={`${byCompany.length} точек`} tone="mut" /> : null}
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
        ) : !loading && items.length === 0 && !error ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="checkmark-done-circle" size={38} color={T.green} />
            <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>Возвратов в этом месяце нет</Text>
          </Card>
        ) : (
          byCompany.map((g) => (
            <View key={g.name} style={{ gap: S.sm }}>
              <SectionTitle hint={moneyShort(g.amount)}>{g.name}</SectionTitle>
              <Card style={{ padding: 0 }}>
                {g.items.map((r, i, arr) => {
                  const op = r.operator_name?.trim() || null
                  const cnt = r.items_count != null ? Number(r.items_count) : null
                  const sub = [
                    op,
                    cnt != null && cnt > 0 ? `${cnt} поз.` : null,
                    r.comment?.trim() || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <View
                      key={r.id}
                      style={{
                        padding: 14,
                        borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                        borderBottomColor: T.borderSoft,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 42, alignItems: 'center' }}>
                          <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>{fmtDay(dateOf(r))}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
                            {shortId(r.sale_id || r.id) || 'Возврат'}
                          </Text>
                          {sub ? (
                            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                              {sub}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={{ color: T.red, fontSize: 15, fontWeight: '800' }}>−{money(amountOf(r))}</Text>
                      </View>
                    </View>
                  )
                })}
              </Card>
            </View>
          ))
        )}

        {!loading && items.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Показано {items.length} возвратов
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
