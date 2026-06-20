import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { T, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, Sparkline } from '@/components/ui'

type Dash = {
  today: { total: number; count: number; cash: number; kaspi: number; card: number; online: number }
  yesterday: { total: number }
  change_percent: number | null
  month_total: number
  week_by_day: Record<string, number>
  low_stock: { id: string; name: string; balance: number; threshold: number }[]
  recent_sales: { id: string; sold_at: string; total_amount: number; payment_method: string; items_count: number }[]
}

export default function HomeScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const [d, setD] = useState<Dash | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await apiFetch<{ data: Dash }>('/api/admin/dashboard')
      setD(res.data)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const week = d ? Object.keys(d.week_by_day).sort().map((k) => d.week_by_day[k]) : []
  const chg = d?.change_percent
  const greeting = (() => {
    const h = new Date().getHours()
    return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  })()

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 14 }}
        refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <View>
            <Text style={{ color: T.textMut, fontSize: 13 }}>{greeting}{role?.displayName ? `, ${role.displayName.split(' ')[0]}` : ''}</Text>
            <Text style={{ color: T.text, fontSize: 24, fontWeight: '800' }}>{role?.isSuperAdmin ? 'Платформа' : 'Кабинет владельца'}</Text>
          </View>
          {role?.isSuperAdmin ? <Pill text="Суперадмин" tone="warn" /> : role?.roleLabel ? <Pill text={role.roleLabel} tone="mut" /> : null}
        </View>

        {loading && !d ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 60 }} />
        ) : error ? (
          <Card><Text style={{ color: T.red, fontWeight: '700' }}>Не удалось загрузить</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : d ? (
          <>
            {/* HERO — сегодня */}
            <Card style={{ padding: 20, borderColor: '#1f3a30', backgroundColor: '#0f1714' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '600' }}>Продажи сегодня</Text>
                {chg != null ? <Pill text={`${chg > 0 ? '↑' : chg < 0 ? '↓' : ''} ${Math.abs(chg)}% ко вчера`} tone={chg >= 0 ? 'good' : 'bad'} /> : null}
              </View>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6 }}>{money(d.today.total)}</Text>
              <Text style={{ color: T.textDim, fontSize: 13, marginTop: 2 }}>{d.today.count} чеков · вчера {moneyShort(d.yesterday.total)}</Text>
              <View style={{ marginTop: 16 }}><Sparkline values={week.length ? week : [0]} /></View>
              <Text style={{ color: T.textDim, fontSize: 11, marginTop: 8 }}>динамика за неделю</Text>
            </Card>

            {/* Способы оплаты */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PayStat label="Наличные" value={d.today.cash} color={T.green} />
              <PayStat label="Kaspi" value={d.today.kaspi} color={T.blue} />
              <PayStat label="Карта" value={d.today.card} color={T.amber} />
            </View>
            <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: T.textMut, fontSize: 13 }}>Продажи за месяц</Text>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>{money(d.month_total)}</Text>
            </Card>

            {/* Быстрые действия */}
            <SectionTitle>Быстрые действия</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <QuickAction icon="stats-chart" label="Финансы" onPress={() => router.push('/finance')} />
              <QuickAction icon="people" label="Команда" onPress={() => router.push('/team')} />
              <QuickAction icon="sparkles" label="AI-разбор" onPress={() => router.push('/ai')} />
              <QuickAction icon="grid" label="Ещё" onPress={() => router.push('/more')} />
            </View>

            {/* Требует внимания */}
            {d.low_stock.length > 0 ? (
              <>
                <SectionTitle hint={`${d.low_stock.length} позиций`}>Требует внимания</SectionTitle>
                <Card style={{ gap: 10 }}>
                  {d.low_stock.slice(0, 5).map((it) => (
                    <View key={it.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <Ionicons name="alert-circle" size={16} color={T.amber} />
                        <Text style={{ color: T.text, fontSize: 14, flex: 1 }} numberOfLines={1}>{it.name}</Text>
                      </View>
                      <Text style={{ color: T.amber, fontSize: 13, fontWeight: '700' }}>{it.balance} / {it.threshold}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Последние продажи */}
            {d.recent_sales.length > 0 ? (
              <>
                <SectionTitle>Последние продажи</SectionTitle>
                <Card style={{ gap: 12 }}>
                  {d.recent_sales.slice(0, 6).map((s) => (
                    <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View>
                        <Text style={{ color: T.text, fontSize: 14, fontWeight: '600' }}>{money(s.total_amount)}</Text>
                        <Text style={{ color: T.textDim, fontSize: 11 }}>{s.items_count} поз. · {s.payment_method}</Text>
                      </View>
                      <Text style={{ color: T.textDim, fontSize: 11 }}>{s.sold_at ? new Date(s.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}</Text>
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

function PayStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 12 }}>
      <Text style={{ color: T.textDim, fontSize: 11 }}>{label}</Text>
      <Text style={{ color, fontSize: 15, fontWeight: '800', marginTop: 4 }}>{moneyShort(value)}</Text>
    </View>
  )
}

function QuickAction({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: '47%', flexGrow: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: '#10261f', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={T.green} />
      </View>
      <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  )
}
