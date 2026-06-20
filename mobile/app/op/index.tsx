import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { T, money } from '@/lib/theme'
import { Card, SectionTitle, Pill } from '@/components/ui'

type Overview = {
  operator: { name: string; short_name: string | null }
  week: { grossAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; paidAmount: number; remainingAmount: number; status: string }
  counters: { activeTasks: number; reviewTasks: number; activeDebts: number; activeDebtAmount: number; leadPoints: number }
  nextShift: { label: string } | null
  activeTasks: { id: string; title: string; status: string; priority: string; due_date: string | null }[]
  recentDebts: { id: string; amount: number; comment: string | null; companyName: string | null }[]
}

const STATUS: Record<string, { text: string; tone: 'good' | 'warn' | 'mut' }> = {
  paid: { text: 'Выплачено', tone: 'good' },
  partial: { text: 'Частично', tone: 'warn' },
  draft: { text: 'Не выплачено', tone: 'mut' },
}

export default function OperatorHome() {
  const { role, signOut } = useAuth()
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

  const onLogout = () => Alert.alert('Выйти?', '', [{ text: 'Отмена', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: () => void signOut() }])
  const st = d ? STATUS[d.week.status] || STATUS.draft : STATUS.draft

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 14 }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text style={{ color: T.textMut, fontSize: 13 }}>{role?.roleLabel || 'Оператор'}</Text>
            <Text style={{ color: T.text, fontSize: 24, fontWeight: '800' }}>{d?.operator.name || role?.displayName || 'Оператор'}</Text>
          </View>
          <Pressable onPress={onLogout} hitSlop={10}><Ionicons name="log-out-outline" size={22} color={T.textMut} /></Pressable>
        </View>

        {loading && !d ? <ActivityIndicator color={T.green} style={{ marginTop: 60 }} /> : error ? (
          <Card><Text style={{ color: T.red, fontWeight: '700' }}>Не удалось загрузить</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : d ? (
          <>
            {/* Зарплата недели */}
            <Card style={{ padding: 20, borderColor: '#1f3a30', backgroundColor: '#0f1714' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: T.textMut, fontSize: 13 }}>К выплате за неделю</Text>
                <Pill text={st.text} tone={st.tone} />
              </View>
              <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6 }}>{money(d.week.netAmount)}</Text>
              <Text style={{ color: T.textDim, fontSize: 13, marginTop: 2 }}>начислено {money(d.week.grossAmount)} · выплачено {money(d.week.paidAmount)}</Text>
              {d.week.remainingAmount > 0 ? <Text style={{ color: T.amber, fontSize: 13, marginTop: 6, fontWeight: '700' }}>Остаток: {money(d.week.remainingAmount)}</Text> : null}
            </Card>

            {/* Корректировки */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Mini label="Бонус" value={d.week.bonusAmount} color={T.green} />
              <Mini label="Штраф" value={d.week.fineAmount} color={T.red} />
              <Mini label="Аванс" value={d.week.advanceAmount} color={T.blue} />
            </View>

            {/* Следующая смена */}
            {d.nextShift ? (
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name="calendar" size={20} color={T.green} />
                <View><Text style={{ color: T.textMut, fontSize: 12 }}>Ближайшая смена</Text><Text style={{ color: T.text, fontSize: 15, fontWeight: '600' }}>{d.nextShift.label}</Text></View>
              </Card>
            ) : null}

            {/* Задачи */}
            {d.activeTasks.length > 0 ? (
              <>
                <SectionTitle hint={`${d.counters.activeTasks}`}>Мои задачи</SectionTitle>
                <Card style={{ gap: 12 }}>
                  {d.activeTasks.map((t) => (
                    <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: t.priority === 'high' ? T.red : T.amber }} />
                      <Text style={{ color: T.text, fontSize: 14, flex: 1 }} numberOfLines={1}>{t.title}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Долги */}
            {d.recentDebts.length > 0 ? (
              <>
                <SectionTitle hint={money(d.counters.activeDebtAmount)}>Мои долги</SectionTitle>
                <Card style={{ gap: 12 }}>
                  {d.recentDebts.map((db) => (
                    <View key={db.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: T.text, fontSize: 14, flex: 1 }} numberOfLines={1}>{db.comment || db.companyName || 'Долг'}</Text>
                      <Text style={{ color: T.amber, fontSize: 14, fontWeight: '700' }}>{money(db.amount)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            <Pressable onPress={onLogout} style={{ marginTop: 6, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#3b1212', backgroundColor: '#160c0c', alignItems: 'center' }}>
              <Text style={{ color: T.red, fontWeight: '700', fontSize: 15 }}>Выйти из аккаунта</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Mini({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 12 }}>
      <Text style={{ color: T.textDim, fontSize: 11 }}>{label}</Text>
      <Text style={{ color, fontSize: 15, fontWeight: '800', marginTop: 4 }}>{money(value)}</Text>
    </View>
  )
}
