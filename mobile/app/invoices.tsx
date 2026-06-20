import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented } from '@/components/ui'

// Платформа: счета по всем организациям (только суперадмин). Просмотр.

type Inv = {
  id: string
  organizationId: string
  orgName: string
  orgSlug: string
  amount: number
  currency: string
  periodStart?: string | null
  periodEnd?: string | null
  dueDate: string | null
  status: string
  paidAt: string | null
  note: string | null
  createdAt: string
}

const STATUS: Record<string, { label: string; tone: 'good' | 'bad' | 'warn' | 'mut' }> = {
  issued: { label: 'Выставлен', tone: 'warn' },
  paid: { label: 'Оплачен', tone: 'good' },
  overdue: { label: 'Просрочен', tone: 'bad' },
  void: { label: 'Аннулирован', tone: 'mut' },
  draft: { label: 'Черновик', tone: 'mut' },
}

type FilterKey = 'all' | 'issued' | 'paid' | 'void'
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'issued', label: 'Выставленные' },
  { key: 'paid', label: 'Оплаченные' },
  { key: 'void', label: 'Аннулир.' },
]

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—')

export default function InvoicesScreen() {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [rows, setRows] = useState<Inv[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (status: FilterKey) => {
    setLoading(true)
    setError(null)
    try {
      const qs = status && status !== 'all' ? `?status=${status}` : ''
      const res = await apiFetch<{ data: Inv[] }>(`/api/admin/platform/invoices${qs}`)
      setRows(res.data || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(filter) }, [filter, load])

  const summary = useMemo(() => {
    let unpaid = 0
    let unpaidCount = 0
    let overdue = 0
    let paid = 0
    for (const r of rows) {
      const a = Number(r.amount || 0)
      if (r.status === 'issued' || r.status === 'overdue') {
        unpaid += a
        unpaidCount += 1
      }
      if (r.status === 'overdue') overdue += a
      if (r.status === 'paid') paid += a
    }
    return { unpaid, unpaidCount, overdue, paid }
  }, [rows])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Счета</Text>
      </View>

      <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Segmented value={filter} onChange={(v) => setFilter(v as FilterKey)} options={FILTERS} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={() => load(filter)} tintColor={T.green} />}
      >
        <GlowHero glow={T.amber}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>НЕОПЛАЧЕНО</Text>
          <Text style={{ color: T.text, fontSize: 36, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.unpaid)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`счетов ${summary.unpaidCount}`} tone="warn" />
            {summary.overdue > 0 ? <Pill text={`просрочено ${moneyShort(summary.overdue)}`} tone="bad" /> : null}
            {summary.paid > 0 ? <Pill text={`оплачено ${moneyShort(summary.paid)}`} tone="good" /> : null}
          </View>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Биллинг по всем организациям · {rows.length} в списке</Text>
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && rows.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && rows.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="document-text-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Счетов нет</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {rows.map((r, i) => {
              const st = STATUS[r.status] || STATUS.issued
              const voided = r.status === 'void'
              const sub = [r.orgSlug || null, r.dueDate ? `до ${fmtDate(r.dueDate)}` : fmtDate(r.createdAt)].filter(Boolean).join(' · ')
              return (
                <View
                  key={r.id}
                  style={{
                    flexDirection: 'row',
                    gap: 12,
                    padding: 14,
                    borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{r.orgName || '—'}</Text>
                    {sub ? <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{sub}</Text> : null}
                    {r.note ? <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{r.note}</Text> : null}
                    <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                      <Pill text={st.label} tone={st.tone} />
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                    <Text
                      style={{
                        color: voided ? T.textDim : T.text,
                        fontSize: 15,
                        fontWeight: '800',
                        textDecorationLine: voided ? 'line-through' : 'none',
                      }}
                    >
                      {money(r.amount)}
                    </Text>
                    {r.currency && r.currency !== 'KZT' ? (
                      <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>{r.currency}</Text>
                    ) : null}
                  </View>
                </View>
              )
            })}
          </Card>
        )}

        {!loading && rows.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>Показано {rows.length} счетов</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
