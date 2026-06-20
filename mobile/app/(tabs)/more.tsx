import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { useAuth } from '@/lib/auth'
import { canSee } from '@/lib/access'
import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, SectionTitle } from '@/components/ui'

type Sub = { data?: { organization?: { name?: string }; subscription?: { status?: string }; package?: { name?: string } } | null }
type Section = { icon: any; label: string; route?: string; path: string; page?: string; group: string }

// group — раздел меню, path — web-путь (role_permissions), page — capability из /access.
const SECTIONS: Section[] = [
  // Финансы
  { group: 'Финансы', icon: 'cash', label: 'Доходы', route: '/income', path: '/income', page: 'income' },
  { group: 'Финансы', icon: 'card', label: 'Расходы', route: '/expenses', path: '/expenses', page: 'expenses' },
  { group: 'Финансы', icon: 'checkmark-done', label: 'Согласования', route: '/approvals', path: '/expenses', page: 'expenses-pending' },
  { group: 'Финансы', icon: 'alert-circle', label: 'Долги с точки', route: '/debts', path: '/point-debts', page: 'point-debts' },
  { group: 'Финансы', icon: 'analytics', label: 'Анализ', route: '/analysis', path: '/analysis', page: 'analysis' },
  { group: 'Финансы', icon: 'bar-chart', label: 'Аналитика', route: '/analytics', path: '/analytics', page: 'analysis' },
  { group: 'Финансы', icon: 'trending-up', label: 'Рентабельность', route: '/profitability', path: '/profitability', page: 'profitability' },
  // Команда
  { group: 'Команда', icon: 'calendar', label: 'Смены', route: '/shifts', path: '/shifts', page: 'shifts' },
  { group: 'Команда', icon: 'people-circle', label: 'Операторы', route: '/operators', path: '/operators', page: 'operators' },
  { group: 'Команда', icon: 'stats-chart', label: 'Аналитика операторов', route: '/operator-analytics', path: '/operator-analytics', page: 'operator-analytics' },
  { group: 'Команда', icon: 'trophy', label: 'Рейтинг операторов', route: '/performance', path: '/performance', page: 'performance' },
  { group: 'Команда', icon: 'id-card', label: 'Сотрудники', route: '/staff', path: '/staff', page: 'staff' },
  { group: 'Команда', icon: 'wallet', label: 'Зарплата', path: '/salary', page: 'salary' },
  // Клиенты
  { group: 'Клиенты', icon: 'person', label: 'Клиенты', route: '/customers', path: '/customers', page: 'customers' },
  { group: 'Клиенты', icon: 'pricetags', label: 'Скидки', route: '/discounts', path: '/discounts', page: 'discounts' },
  // Склад
  { group: 'Склад', icon: 'cube', label: 'Склад', route: '/warehouse', path: '/store', page: 'store' },
  { group: 'Склад', icon: 'pricetag', label: 'Каталог товаров', route: '/catalog', path: '/store', page: 'store' },
  { group: 'Склад', icon: 'swap-horizontal', label: 'Заявки склада', route: '/requests', path: '/store', page: 'store' },
  { group: 'Склад', icon: 'restaurant', label: 'Производство', route: '/production', path: '/production', page: 'production' },
  // Планы и связь
  { group: 'Планы и связь', icon: 'flag', label: 'Цели и KPI', route: '/goals', path: '/goals', page: 'goals' },
  { group: 'Планы и связь', icon: 'newspaper', label: 'Новости', route: '/news', path: '/news', page: 'news' },
  { group: 'Планы и связь', icon: 'chatbubbles', label: 'Сообщения', route: '/messages', path: '/messages', page: 'messages' },
  { group: 'Планы и связь', icon: 'calendar-number', label: 'Календарь', route: '/calendar', path: '/calendar', page: 'calendar' },
  // Прочее
  { group: 'Прочее', icon: 'game-controller', label: 'Арена', route: '/arena', path: '/arena' },
]

const GROUP_ORDER = ['Финансы', 'Команда', 'Клиенты', 'Склад', 'Планы и связь', 'Прочее']

export default function MoreScreen() {
  const { session, role, signOut } = useAuth()
  const router = useRouter()
  const [sub, setSub] = useState<Sub['data']>(null)
  const [pending, setPending] = useState(0)

  const visible = SECTIONS.filter((s) => canSee(role, { path: s.path, page: s.page }))
  const groups = GROUP_ORDER.map((g) => ({ name: g, items: visible.filter((s) => s.group === g) })).filter((g) => g.items.length > 0)

  const load = useCallback(async () => {
    try { const r = await apiFetch<Sub>('/api/admin/my-subscription'); setSub(r.data || null) } catch { /* ignore */ }
    try { const p = await apiFetch<{ data: any[] }>('/api/admin/expenses/pending'); setPending((p.data || []).length) } catch { /* ignore */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const onLogout = () => {
    Alert.alert('Выйти из аккаунта?', '', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: () => void signOut() },
    ])
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }}>
        <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>Ещё</Text>

        {/* Организация */}
        <Card style={{ gap: 4 }}>
          <Text style={{ color: T.textMut, fontSize: 12 }}>Организация</Text>
          <Text style={{ color: T.text, fontSize: 18, fontWeight: '900' }}>{sub?.organization?.name || '—'}</Text>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }}>
            Тариф: {sub?.package?.name || 'без пакета'}{sub?.subscription?.status ? ` · ${sub.subscription.status}` : ''}
          </Text>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 4 }}>{session?.user?.email}{role?.roleLabel ? ` · ${role.roleLabel}` : ''}</Text>
        </Card>

        {groups.map((g) => (
          <View key={g.name} style={{ gap: S.sm }}>
            <SectionTitle>{g.name}</SectionTitle>
            <Card style={{ padding: 6 }}>
              {g.items.map((s, i) => (
                <Pressable
                  key={s.label}
                  onPress={() => (s.route ? router.push(s.route as any) : Alert.alert(s.label, 'Этот раздел скоро появится в приложении.'))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: i < g.items.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#181b1f', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={s.icon} size={18} color={T.textMut} />
                  </View>
                  <Text style={{ color: T.text, fontSize: 15, flex: 1 }}>{s.label}</Text>
                  {s.label === 'Согласования' && pending > 0 ? (
                    <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, backgroundColor: T.green, alignItems: 'center', justifyContent: 'center', marginRight: 6 }}>
                      <Text style={{ color: '#04130d', fontSize: 12, fontWeight: '800' }}>{pending}</Text>
                    </View>
                  ) : null}
                  {s.route ? <Ionicons name="chevron-forward" size={18} color={T.textDim} /> : <Text style={{ color: T.textDim, fontSize: 11 }}>скоро</Text>}
                </Pressable>
              ))}
            </Card>
          </View>
        ))}

        <Pressable onPress={onLogout} style={{ marginTop: 4, padding: 16, borderRadius: R.lg, borderWidth: 1, borderColor: '#3b1212', backgroundColor: '#160c0c', alignItems: 'center' }}>
          <Text style={{ color: T.red, fontWeight: '800', fontSize: 15 }}>Выйти из аккаунта</Text>
        </Pressable>
        <Text style={{ color: T.textDim, fontSize: 11, textAlign: 'center', marginTop: 4 }}>Orda · v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  )
}
