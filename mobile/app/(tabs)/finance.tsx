import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { apiFetch } from '@/lib/api'
import { T, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill } from '@/components/ui'

type Totals = { totalIncome: number; totalExpense: number; profit: number; incomeCash: number; incomeKaspi: number; incomeOnline: number; incomeCard: number; transactionCount: number; avgTransaction: number }
type Bundle = { data: { aggregate: { totalsCur: Totals; totalsPrev: Totals; expenseByCategory: Record<string, number>; incomeByCompany: Record<string, any> } } }

const PRESETS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
] as const

function rangeFor(preset: string) {
  const d = new Date()
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  const to = iso(d)
  if (preset === 'today') return { from: to, to }
  if (preset === 'week') { const f = new Date(d); f.setDate(d.getDate() - 6); return { from: iso(f), to } }
  return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to }
}

export default function FinanceScreen() {
  const [preset, setPreset] = useState<string>('month')
  const [b, setB] = useState<Totals | null>(null)
  const [cats, setCats] = useState<{ name: string; value: number }[]>([])
  const [comps, setComps] = useState<{ name: string; value: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (p: string) => {
    setError(null); setLoading(true)
    try {
      const { from, to } = rangeFor(p)
      const res = await apiFetch<Bundle>(`/api/admin/reports/bundle?from=${from}&to=${to}`)
      const agg = res.data?.aggregate
      setB(agg?.totalsCur || null)
      setCats(Object.entries(agg?.expenseByCategory || {}).map(([name, value]) => ({ name, value: Number(value) })).sort((a, b) => b.value - a.value).slice(0, 6))
      // incomeByCompany: ключ = company_id, значение = { name, value, cash, kaspi, ... }
      setComps(Object.values(agg?.incomeByCompany || {}).map((v: any) => ({ name: (v && v.name) || 'Компания', value: Number(v?.value ?? v?.revenue ?? 0) })).filter((c) => c.value > 0).sort((a, b) => b.value - a.value).slice(0, 6))
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(preset) }, [preset, load])

  const margin = useMemo(() => (b && b.totalIncome > 0 ? Math.round((b.profit / b.totalIncome) * 100) : 0), [b])
  const maxCat = Math.max(1, ...cats.map((c) => c.value))
  const maxComp = Math.max(1, ...comps.map((c) => c.value))

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 14 }} refreshControl={<RefreshControl refreshing={loading && !!b} onRefresh={() => load(preset)} tintColor={T.green} />}>
        <Text style={{ color: T.text, fontSize: 24, fontWeight: '800' }}>Финансы</Text>

        {/* период */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {PRESETS.map((p) => (
            <Pressable key={p.key} onPress={() => setPreset(p.key)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: preset === p.key ? T.green : T.card, borderWidth: 1, borderColor: preset === p.key ? T.green : T.border }}>
              <Text style={{ color: preset === p.key ? '#04130d' : T.textMut, fontWeight: '700', fontSize: 13 }}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        {loading && !b ? <ActivityIndicator color={T.green} style={{ marginTop: 50 }} /> : error ? (
          <Card><Text style={{ color: T.red, fontWeight: '700' }}>Не удалось загрузить</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : b ? (
          <>
            {/* KPI */}
            <Card style={{ padding: 20 }}>
              <Text style={{ color: T.textMut, fontSize: 13 }}>Прибыль за период</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <Text style={{ color: b.profit >= 0 ? T.green : T.red, fontSize: 34, fontWeight: '900' }}>{money(b.profit)}</Text>
                <Pill text={`маржа ${margin}%`} tone={margin >= 20 ? 'good' : margin >= 10 ? 'warn' : 'bad'} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <Mini label="Доход" value={b.totalIncome} color={T.green} />
                <Mini label="Расход" value={b.totalExpense} color={T.amber} />
                <Mini label="Чеков" value={b.transactionCount} color={T.blue} raw />
              </View>
            </Card>

            {/* По компаниям */}
            {comps.length > 0 ? (
              <>
                <SectionTitle hint="доход">По компаниям</SectionTitle>
                <Card style={{ gap: 12 }}>
                  {comps.map((c) => (
                    <View key={c.name} style={{ gap: 5 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: T.text, fontSize: 13 }} numberOfLines={1}>{c.name}</Text>
                        <Text style={{ color: T.text, fontSize: 13, fontWeight: '700' }}>{moneyShort(c.value)}</Text>
                      </View>
                      <View style={{ height: 7, backgroundColor: '#23262b', borderRadius: 999 }}><View style={{ width: `${Math.max(4, (c.value / maxComp) * 100)}%`, height: 7, borderRadius: 999, backgroundColor: T.green }} /></View>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Топ расходов */}
            {cats.length > 0 ? (
              <>
                <SectionTitle hint="топ по сумме">Расходы по категориям</SectionTitle>
                <Card style={{ gap: 12 }}>
                  {cats.map((c) => (
                    <View key={c.name} style={{ gap: 5 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: T.text, fontSize: 13 }} numberOfLines={1}>{c.name}</Text>
                        <Text style={{ color: T.amber, fontSize: 13, fontWeight: '700' }}>{moneyShort(c.value)}</Text>
                      </View>
                      <View style={{ height: 7, backgroundColor: '#23262b', borderRadius: 999 }}><View style={{ width: `${Math.max(4, (c.value / maxCat) * 100)}%`, height: 7, borderRadius: 999, backgroundColor: T.amber }} /></View>
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

function Mini({ label, value, color, raw }: { label: string; value: number; color: string; raw?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: T.textDim, fontSize: 11 }}>{label}</Text>
      <Text style={{ color, fontSize: 15, fontWeight: '800', marginTop: 3 }}>{raw ? String(value) : moneyShort(value)}</Text>
    </View>
  )
}
