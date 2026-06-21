import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, BarRow, ErrorState, EmptyState } from '@/components/ui'

type IncomeRow = {
  id: string
  date: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
}
type ExpenseRow = {
  id: string
  date: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

type DayRow = {
  date: string
  income: number
  expenses: number
  profit: number
  cumBalance: number
}

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const monthRange = (d: Date) => ({ from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) })
const fmtDay = (s: string) => {
  const [y, m, dd] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, dd || 1).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

const incomeOf = (r: IncomeRow) =>
  Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.online_amount || 0) + Number(r.card_amount || 0)
const expenseOf = (r: ExpenseRow) => Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)

export default function CashflowScreen() {
  const router = useRouter()
  const [cursor, setCursor] = useState(() => new Date())
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: Date) => {
    setLoading(true); setError(null)
    const { from, to } = monthRange(d)
    try {
      const [inc, exp] = await Promise.all([
        apiFetch<{ data: IncomeRow[] }>(`/api/admin/incomes?from=${from}&to=${to}&page_size=5000`),
        apiFetch<{ data: ExpenseRow[] }>(`/api/admin/expenses?from=${from}&to=${to}&page_size=5000`),
      ])
      setIncomes(inc.data || [])
      setExpenses(exp.data || [])
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

  // Агрегация по дням + накопительный баланс
  const dailyData = useMemo<DayRow[]>(() => {
    const incomeMap = new Map<string, number>()
    const expenseMap = new Map<string, number>()
    for (const r of incomes || []) {
      if (!r.date) continue
      incomeMap.set(r.date, (incomeMap.get(r.date) || 0) + incomeOf(r))
    }
    for (const r of expenses || []) {
      if (!r.date) continue
      expenseMap.set(r.date, (expenseMap.get(r.date) || 0) + expenseOf(r))
    }
    const allDates = Array.from(new Set([...incomeMap.keys(), ...expenseMap.keys()])).sort()
    let cumBalance = 0
    return allDates.map((date) => {
      const income = incomeMap.get(date) || 0
      const exp = expenseMap.get(date) || 0
      const profit = income - exp
      cumBalance += profit
      return { date, income, expenses: exp, profit, cumBalance }
    })
  }, [incomes, expenses])

  const stats = useMemo(() => {
    const totalIncome = dailyData.reduce((s, d) => s + d.income, 0)
    const totalExpenses = dailyData.reduce((s, d) => s + d.expenses, 0)
    const profit = totalIncome - totalExpenses
    const margin = totalIncome > 0 ? (profit / totalIncome) * 100 : 0
    const negativeDays = dailyData.filter((d) => d.profit < 0).length
    const finalBalance = dailyData.at(-1)?.cumBalance ?? 0
    return { totalIncome, totalExpenses, profit, margin, negativeDays, finalBalance }
  }, [dailyData])

  const splitMax = Math.max(1, stats.totalIncome, stats.totalExpenses)
  const daysDesc = useMemo(() => [...dailyData].sort((a, b) => b.date.localeCompare(a.date)), [dailyData])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Движение денег</Text>
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
        refreshControl={<RefreshControl refreshing={loading && dailyData.length > 0} onRefresh={() => load(cursor)} tintColor={T.green} />}
      >
        {/* Сводка-герой */}
        <GlowHero glow={stats.profit >= 0 ? T.green : T.red}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ЧИСТЫЙ ПОТОК ЗА МЕСЯЦ</Text>
          <Text style={{ color: stats.profit >= 0 ? T.text : T.red, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>
            {(stats.profit > 0 ? '+' : '') + money(stats.profit)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`доход ${moneyShort(stats.totalIncome)}`} tone="good" />
            <Pill text={`расход ${moneyShort(stats.totalExpenses)}`} tone="bad" />
            <Pill text={`маржа ${stats.margin.toFixed(0)}%`} tone={stats.margin >= 20 ? 'good' : stats.margin >= 10 ? 'warn' : 'bad'} />
          </View>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>
            Баланс на конец: {money(stats.finalBalance)}{stats.negativeDays > 0 ? ` · ${stats.negativeDays} убыточных дн.` : ''}
          </Text>
        </GlowHero>

        {error ? <ErrorState message={error} onRetry={() => load(cursor)} /> : null}

        {loading && dailyData.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : dailyData.length === 0 && !loading ? (
          <EmptyState icon="swap-vertical-outline" title="Нет движений за этот месяц" />
        ) : (
          <>
            {/* Доходы / Расходы */}
            <View>
              <SectionTitle hint={`маржа ${stats.margin.toFixed(0)}%`}>Доходы и расходы</SectionTitle>
              <Card style={{ gap: S.md }}>
                <BarRow label="Доходы" value={stats.totalIncome} max={splitMax} color={T.green} valueLabel={money(stats.totalIncome)} />
                <BarRow label="Расходы" value={stats.totalExpenses} max={splitMax} color={T.red} valueLabel={money(stats.totalExpenses)} />
              </Card>
            </View>

            {/* Таблица по дням */}
            <View>
              <SectionTitle hint={`${dailyData.length} дн.`}>По дням</SectionTitle>
              <Card style={{ padding: 0 }}>
                {daysDesc.map((row, i) => (
                  <View
                    key={row.date}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderBottomWidth: i < daysDesc.length - 1 ? 1 : 0,
                      borderBottomColor: T.borderSoft,
                    }}
                  >
                    <View style={{ width: 52 }}>
                      <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700' }}>{fmtDay(row.date)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <Text style={{ color: T.green, fontSize: 12.5 }} numberOfLines={1}>
                          {row.income > 0 ? `+${moneyShort(row.income)}` : '—'}
                        </Text>
                        <Text style={{ color: T.red, fontSize: 12.5 }} numberOfLines={1}>
                          {row.expenses > 0 ? `-${moneyShort(row.expenses)}` : '—'}
                        </Text>
                      </View>
                      <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>
                        баланс {money(row.cumBalance)}
                      </Text>
                    </View>
                    <Text style={{ color: row.profit >= 0 ? T.green : T.red, fontSize: 14.5, fontWeight: '800' }}>
                      {(row.profit > 0 ? '+' : '') + moneyShort(row.profit)}
                    </Text>
                  </View>
                ))}
              </Card>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
