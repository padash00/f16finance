import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'
import { AuthDiag } from '@/components/auth-diag'

type Overview = {
  operator: { name: string; short_name: string | null }
  week: { grossAmount: number; bonusAmount: number; fineAmount: number; advanceAmount: number; netAmount: number; paidAmount: number; remainingAmount: number; status: string }
  counters: { activeTasks: number; reviewTasks: number; activeDebts: number; activeDebtAmount: number; leadPoints: number }
  nextShift: { label: string } | null
}

const STATUS: Record<string, { text: string; tone: 'good' | 'warn' | 'mut' }> = {
  paid: { text: 'Выплачено', tone: 'good' },
  partial: { text: 'Частично', tone: 'warn' },
  draft: { text: 'Не выплачено', tone: 'mut' },
}

export default function OperatorHome() {
  const router = useRouter()
  const { role } = useAuth()
  const [d, setD] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await apiFetch<{ ok: boolean } & Overview>('/api/operator/overview')
      setD(res)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const st = d ? STATUS[d.week.status] || STATUS.draft : STATUS.draft
  const greeting = (() => {
    const h = new Date().getHours()
    return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  })()

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}>
        <View style={{ marginTop: 2 }}>
          <Text style={{ color: T.textMut, fontSize: 13 }}>{greeting}</Text>
          <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>{d?.operator.name || role?.displayName || 'Оператор'}</Text>
        </View>

        {loading && !d ? <ActivityIndicator color={T.green} style={{ marginTop: 60 }} /> : error ? (
          <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>Не удалось загрузить</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text><AuthDiag /></Card>
        ) : d ? (
          <>
            {/* Зарплата недели */}
            <Pressable onPress={() => router.push('/op/salary')}>
              <GlowHero glow={st.tone === 'good' ? T.green : T.amber}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>К ВЫПЛАТЕ ЗА НЕДЕЛЮ</Text>
                  <Pill text={st.text} tone={st.tone} />
                </View>
                <Text style={{ color: T.text, fontSize: 40, fontWeight: '900', marginTop: 8, letterSpacing: -0.5 }}>{money(d.week.netAmount)}</Text>
                <Text style={{ color: T.textMut, fontSize: 13, marginTop: 3 }}>начислено {money(d.week.grossAmount)} · выплачено {money(d.week.paidAmount)}</Text>
                {d.week.remainingAmount > 0 ? <Text style={{ color: T.amber, fontSize: 13, marginTop: 8, fontWeight: '800' }}>Остаток: {money(d.week.remainingAmount)}</Text> : null}
              </GlowHero>
            </Pressable>

            {/* Следующая смена */}
            {d.nextShift ? (
              <Pressable onPress={() => router.push('/op/shifts')}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="calendar" size={20} color={T.green} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: T.textMut, fontSize: 12 }}>Ближайшая смена</Text>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{d.nextShift.label}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={T.textDim} />
                </Card>
              </Pressable>
            ) : null}

            {/* Счётчики-ссылки */}
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <CounterTile icon="checkbox-outline" tint={T.cyan} label="Задачи" value={d.counters.activeTasks} onPress={() => router.push('/op/tasks')} />
              <CounterTile icon="alert-circle-outline" tint={T.amber} label="Мои долги" value={d.counters.activeDebts} sub={d.counters.activeDebtAmount > 0 ? money(d.counters.activeDebtAmount) : undefined} onPress={() => router.push('/op/salary')} />
            </View>

            {/* Быстрые действия */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              <ActionTile icon="clipboard" tint={T.amber} label="Ревизия" onPress={() => router.push('/op/audit')} />
              <ActionTile icon="list" tint={T.blue} label="Чек-листы" onPress={() => router.push('/op/checklist')} />
              <ActionTile icon="warning" tint={T.red} label="Инциденты" onPress={() => router.push('/op/incidents')} />
              <ActionTile icon="book" tint={T.violet} label="База знаний" onPress={() => router.push('/op/knowledge')} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function ActionTile({ icon, tint, label, onPress }: { icon: any; tint: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: '47.5%', flexGrow: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.lg, padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: tint + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={19} color={tint} />
      </View>
      <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  )
}

function CounterTile({ icon, tint, label, value, sub, onPress }: { icon: any; tint: string; label: string; value: number; sub?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.lg, padding: S.lg }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: tint + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={19} color={tint} />
      </View>
      <Text style={{ color: T.text, fontSize: 26, fontWeight: '900', marginTop: 10 }}>{value}</Text>
      <Text style={{ color: T.textMut, fontSize: 13 }}>{label}</Text>
      {sub ? <Text style={{ color: T.amber, fontSize: 12, fontWeight: '700', marginTop: 2 }}>{sub}</Text> : null}
    </Pressable>
  )
}
