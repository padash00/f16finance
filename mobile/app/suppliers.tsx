import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented, ErrorState, EmptyState, SkeletonList } from '@/components/ui'

type Supplier = {
  id: string
  name: string | null
  organization_name: string | null
  bin_iin: string | null
  contact_name: string | null
  phone: string | null
  preferred_expense_category_id: string | null
  created_at: string | null
  receipts_count: number | null
  receipts_total: number | null
  last_receipt_date: string | null
  open_debts_count: number | null
  open_debts_sum: number | null
  aliases_count: number | null
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export default function SuppliersScreen() {
  const router = useRouter()
  const [filter, setFilter] = useState<'all' | 'debts'>('all')
  const [items, setItems] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ data: { suppliers: Supplier[] } }>('/api/admin/store/suppliers')
      setItems(res.data?.suppliers || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    let total = items.length
    let receiptsTotal = 0
    let debtSum = 0
    let debtCount = 0
    for (const s of items) {
      receiptsTotal += Number(s.receipts_total || 0)
      debtSum += Number(s.open_debts_sum || 0)
      if (Number(s.open_debts_count || 0) > 0) debtCount += 1
    }
    return { total, receiptsTotal, debtSum, debtCount }
  }, [items])

  const visible = useMemo(() => {
    const list = filter === 'debts' ? items.filter((s) => Number(s.open_debts_count || 0) > 0) : items
    return [...list].sort((a, b) => Number(b.receipts_total || 0) - Number(a.receipts_total || 0))
  }, [items, filter])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Поставщики</Text>
      </View>

      <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as 'all' | 'debts')}
          options={[
            { key: 'all', label: 'Все' },
            { key: 'debts', label: 'С долгом' },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.amber}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО ПОСТАВЩИКОВ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.total}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`приёмок ${moneyShort(summary.receiptsTotal)}`} tone="good" />
            {summary.debtSum > 0 ? <Pill text={`долг ${moneyShort(summary.debtSum)}`} tone="bad" /> : null}
          </View>
          {summary.debtCount > 0 ? (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>{summary.debtCount} поставщиков с открытым долгом</Text>
          ) : null}
        </GlowHero>

        {error ? <ErrorState message={error} onRetry={() => load()} /> : null}

        {loading && items.length === 0 ? (
          <SkeletonList rows={6} />
        ) : !loading && visible.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title={filter === 'debts' ? 'Нет поставщиков с долгом' : 'Поставщики не найдены'}
          />
        ) : (
          <Card style={{ padding: 0 }}>
            {visible.map((s, i) => {
              const name = s.name?.trim() || s.organization_name?.trim() || 'Без названия'
              const org = s.organization_name?.trim() && s.organization_name.trim() !== name ? s.organization_name.trim() : null
              const contact = [s.contact_name?.trim() || null, s.phone?.trim() || null].filter(Boolean).join(' • ')
              const hasDebt = Number(s.open_debts_count || 0) > 0
              return (
                <View
                  key={s.id}
                  style={{
                    flexDirection: 'row',
                    gap: 12,
                    padding: 14,
                    borderBottomWidth: i < visible.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: hasDebt ? T.red + '22' : T.amber + '22',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: hasDebt ? T.red : T.amber, fontSize: 14, fontWeight: '900' }}>{initials(name)}</Text>
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{name}</Text>
                      {hasDebt ? <Pill text="долг" tone="bad" /> : null}
                    </View>
                    {org ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{org}</Text>
                    ) : null}
                    {s.bin_iin ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>БИН/ИИН {s.bin_iin}</Text>
                    ) : null}
                    {contact ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{contact}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: T.textMut, fontSize: 11 }}>Приёмок: {Number(s.receipts_count || 0)}</Text>
                      {s.last_receipt_date ? (
                        <Text style={{ color: T.textMut, fontSize: 11 }}>Посл.: {fmtDate(s.last_receipt_date)}</Text>
                      ) : null}
                      {hasDebt ? (
                        <Text style={{ color: T.red, fontSize: 11 }}>Долг {moneyShort(Number(s.open_debts_sum || 0))}</Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                    <Text style={{ color: T.amber, fontSize: 14.5, fontWeight: '800' }}>{money(Number(s.receipts_total || 0))}</Text>
                    <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>оборот</Text>
                  </View>
                </View>
              )
            })}
          </Card>
        )}

        {!loading && items.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Показано {visible.length} из {items.length}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
