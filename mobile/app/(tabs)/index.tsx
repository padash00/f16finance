import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { T, R, S, money, moneyShort, shadow } from '@/lib/theme'
import { Card, SectionTitle, Pill, Sparkline, GlowHero, Skeleton } from '@/components/ui'
import { AuthDiag } from '@/components/auth-diag'

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
        contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}
      >
        {/* Шапка */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, marginBottom: 2 }}>
          <View>
            <Text style={{ color: T.textMut, fontSize: 13 }}>{greeting}{role?.displayName ? `, ${role.displayName.split(' ')[0]}` : ''}</Text>
            <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>{role?.isSuperAdmin ? 'Платформа' : 'Кабинет владельца'}</Text>
          </View>
          {role?.isSuperAdmin ? <Pill text="Суперадмин" tone="warn" /> : role?.roleLabel ? <Pill text={role.roleLabel} tone="brand" /> : null}
        </View>

        {loading && !d ? (
          <>
            <Skeleton h={170} style={{ borderRadius: R.xl }} />
            <View style={{ flexDirection: 'row', gap: S.sm }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={70} style={{ flex: 1, borderRadius: R.lg }} />)}</View>
            <Skeleton h={120} style={{ borderRadius: R.xl, marginTop: 4 }} />
          </>
        ) : error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Не удалось загрузить</Text>
            <Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text>
            <AuthDiag />
          </Card>
        ) : d ? (
          <>
            {/* HERO — продажи сегодня */}
            <GlowHero glow={chg != null && chg < 0 ? T.amber : T.green}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: T.textMut, fontSize: 14, fontWeight: '800', letterSpacing: 0.4 }}>ПРОДАЖИ СЕГОДНЯ</Text>
                {chg != null ? <Pill text={`${chg > 0 ? '↑' : chg < 0 ? '↓' : ''} ${Math.abs(chg)}%`} tone={chg >= 0 ? 'good' : 'bad'} /> : null}
              </View>
              <Text style={{ color: T.text, fontSize: 48, fontWeight: '900', marginTop: 8, letterSpacing: -1 }}>{money(d.today.total)}</Text>
              <Text style={{ color: T.textMut, fontSize: 15, marginTop: 4 }}>{d.today.count} чеков · вчера {moneyShort(d.yesterday.total)}</Text>
              <View style={{ marginTop: S.lg }}><Sparkline values={week.length ? week : [0]} peakColor={T.greenBright} /></View>
              <Text style={{ color: T.textDim, fontSize: 12, marginTop: S.sm, letterSpacing: 0.5 }}>ДИНАМИКА ЗА НЕДЕЛЮ</Text>
            </GlowHero>

            {/* Способы оплаты */}
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <PayStat label="Наличные" value={d.today.cash} color={T.greenBright} icon="cash-outline" />
              <PayStat label="Kaspi" value={d.today.kaspi} color={T.cyan} icon="card-outline" />
              <PayStat label="Карта" value={d.today.card + d.today.online} color={T.amber} icon="wallet-outline" />
            </View>

            <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: T.textMut, fontSize: 13.5 }}>Продажи за месяц</Text>
                <Text style={{ color: T.text, fontSize: 23, fontWeight: '900', marginTop: 2 }}>{money(d.month_total)}</Text>
              </View>
              <Pressable onPress={() => router.push('/finance')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ color: T.green, fontWeight: '800', fontSize: 13 }}>Финансы</Text>
                <Ionicons name="arrow-forward" size={15} color={T.green} />
              </Pressable>
            </Card>

            {/* Быстрые действия */}
            <SectionTitle>Быстрые действия</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              <QuickAction icon="stats-chart" label="Финансы" tint={T.green} onPress={() => router.push('/finance')} />
              <QuickAction icon="people" label="Команда" tint={T.cyan} onPress={() => router.push('/team')} />
              <QuickAction icon="sparkles" label="AI-разбор" tint={T.violet} onPress={() => router.push('/ai')} />
              <QuickAction icon="grid" label="Ещё" tint={T.amber} onPress={() => router.push('/more')} />
            </View>

            {/* Требует внимания */}
            {d.low_stock.length > 0 ? (
              <>
                <SectionTitle hint={`${d.low_stock.length} позиций`}>Требует внимания</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 6 }}>
                  {d.low_stock.slice(0, 5).map((it, i, arr) => (
                    <View key={it.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(251,191,36,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="alert" size={18} color={T.amber} />
                        </View>
                        <Text style={{ color: T.text, fontSize: 15.5, flex: 1 }} numberOfLines={1}>{it.name}</Text>
                      </View>
                      <Text style={{ color: T.amber, fontSize: 15, fontWeight: '800' }}>{it.balance} / {it.threshold}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Последние продажи */}
            {d.recent_sales.length > 0 ? (
              <>
                <SectionTitle>Последние продажи</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 6 }}>
                  {d.recent_sales.slice(0, 6).map((s, i, arr) => (
                    <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View>
                        <Text style={{ color: T.text, fontSize: 16, fontWeight: '800' }}>{money(s.total_amount)}</Text>
                        <Text style={{ color: T.textMut, fontSize: 13, marginTop: 1 }}>{s.items_count} поз. · {s.payment_method}</Text>
                      </View>
                      <Text style={{ color: T.textDim, fontSize: 13 }}>{s.sold_at ? new Date(s.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        ) : null}
        <Text style={{ color: T.textDim, fontSize: 11, textAlign: 'center', marginTop: 8 }}>сборка 21.06 · v4 (хаптика + pull-to-refresh)</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function PayStat({ label, value, color, icon }: { label: string; value: number; color: string; icon: any }) {
  return (
    <View style={[{ flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.lg, padding: S.md, alignItems: 'flex-start' }, shadow.card]}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={{ color: T.textMut, fontSize: 13, marginTop: 9 }}>{label}</Text>
      <Text style={{ color, fontSize: 17, fontWeight: '900', marginTop: 2 }}>{moneyShort(value)}</Text>
    </View>
  )
}

function QuickAction({ icon, label, tint, onPress }: { icon: any; label: string; tint: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width: '47.5%', flexGrow: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.lg, padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: 13, opacity: pressed ? 0.7 : 1 }, shadow.card]}>
      <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: tint + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={25} color={tint} />
      </View>
      <Text style={{ color: T.text, fontSize: 16.5, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  )
}
