import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { useAuth } from '@/lib/auth'
import { canSee, hasFeature } from '@/lib/access'
import { apiFetch } from '@/lib/api'
import { authenticate, biometricLabel, isBiometricAvailable, isBiometricEnabled, setBiometricEnabled } from '@/lib/biometric'
import { haptic } from '@/lib/haptics'
import { T, R, S } from '@/lib/theme'
import { Card, SectionTitle } from '@/components/ui'

type Sub = { data?: { organization?: { name?: string }; subscription?: { status?: string }; package?: { name?: string } } | null }
type Section = { icon: any; label: string; route?: string; path: string; page?: string; group: string; superadmin?: boolean; feature?: string }

// group — раздел меню, path — web-путь (role_permissions), page — capability из /access,
// feature — код подписки/пакета (скрывается, если у орг нет этой фичи; F16 allAccess → всё видно).
const SECTIONS: Section[] = [
  // Финансы (база — core, без гейта; аналитика — finance.pnl)
  { group: 'Финансы', icon: 'cash', label: 'Доходы', route: '/income', path: '/income', page: 'income' },
  { group: 'Финансы', icon: 'card', label: 'Расходы', route: '/expenses', path: '/expenses', page: 'expenses' },
  { group: 'Финансы', icon: 'checkmark-done', label: 'Согласования', route: '/approvals', path: '/expenses', page: 'expenses-pending' },
  { group: 'Финансы', icon: 'alert-circle', label: 'Долги с точки', route: '/debts', path: '/point-debts', page: 'point-debts', feature: 'club.pos' },
  { group: 'Финансы', icon: 'swap-vertical', label: 'Движение денег', route: '/cashflow', path: '/cashflow', page: 'cashflow', feature: 'finance.pnl' },
  { group: 'Финансы', icon: 'analytics', label: 'Анализ', route: '/analysis', path: '/analysis', page: 'analysis', feature: 'finance.pnl' },
  { group: 'Финансы', icon: 'bar-chart', label: 'Аналитика', route: '/analytics', path: '/analytics', page: 'analysis', feature: 'finance.pnl' },
  { group: 'Финансы', icon: 'trending-up', label: 'Рентабельность', route: '/profitability', path: '/profitability', page: 'profitability', feature: 'finance.pnl' },
  { group: 'Финансы', icon: 'trending-up-outline', label: 'Прогноз', route: '/forecast', path: '/forecast', page: 'forecast', feature: 'finance.pnl' },
  // Команда (POS/операторы — club.pos; HR — hr.pro)
  { group: 'Команда', icon: 'calendar', label: 'Смены', route: '/shifts', path: '/shifts', page: 'shifts', feature: 'club.pos' },
  { group: 'Команда', icon: 'people-circle', label: 'Операторы', route: '/operators', path: '/operators', page: 'operators', feature: 'club.pos' },
  { group: 'Команда', icon: 'stats-chart', label: 'Аналитика операторов', route: '/operator-analytics', path: '/operator-analytics', page: 'operator-analytics', feature: 'club.pos' },
  { group: 'Команда', icon: 'trophy', label: 'Рейтинг операторов', route: '/performance', path: '/performance', page: 'performance', feature: 'club.pos' },
  { group: 'Команда', icon: 'id-card', label: 'Сотрудники', route: '/staff', path: '/staff', page: 'staff', feature: 'hr.pro' },
  { group: 'Команда', icon: 'gift', label: 'Дни рождения', route: '/birthdays', path: '/birthdays', page: 'hr', feature: 'hr.pro' },
  { group: 'Команда', icon: 'wallet', label: 'Зарплата', route: '/salary', path: '/salary', page: 'salary', feature: 'club.pos' },
  // Клиенты (loyalty.crm)
  { group: 'Клиенты', icon: 'person', label: 'Клиенты', route: '/customers', path: '/customers', page: 'customers', feature: 'loyalty.crm' },
  { group: 'Клиенты', icon: 'pricetags', label: 'Скидки', route: '/discounts', path: '/discounts', page: 'discounts', feature: 'loyalty.crm' },
  // Склад (shop.catalog)
  { group: 'Склад', icon: 'cube', label: 'Склад', route: '/warehouse', path: '/store', page: 'store', feature: 'shop.catalog' },
  { group: 'Склад', icon: 'pricetag', label: 'Каталог товаров', route: '/catalog', path: '/store', page: 'store', feature: 'shop.catalog' },
  { group: 'Склад', icon: 'swap-horizontal', label: 'Заявки склада', route: '/requests', path: '/store', page: 'store', feature: 'shop.catalog' },
  { group: 'Склад', icon: 'download', label: 'Приходы', route: '/receipts', path: '/store', page: 'store', feature: 'shop.catalog' },
  { group: 'Склад', icon: 'git-compare', label: 'Движения склада', route: '/movements', path: '/store', page: 'store', feature: 'shop.catalog' },
  { group: 'Склад', icon: 'clipboard', label: 'Ревизии склада', route: '/stocktakes', path: '/store', page: 'store', feature: 'shop.catalog' },
  { group: 'Склад', icon: 'trash', label: 'Списания', route: '/writeoffs', path: '/store', page: 'store', feature: 'shop.catalog' },
  { group: 'Склад', icon: 'business', label: 'Поставщики', route: '/suppliers', path: '/store', page: 'store', feature: 'shop.catalog' },
  { group: 'Склад', icon: 'restaurant', label: 'Производство', route: '/production', path: '/production', page: 'production', feature: 'restaurant.recipes_lite' },
  // Продажи (POS) — club.pos
  { group: 'Продажи', icon: 'receipt', label: 'POS-чеки', route: '/pos-receipts', path: '/pos-receipts', page: 'pos', feature: 'club.pos' },
  { group: 'Продажи', icon: 'arrow-undo', label: 'POS-возвраты', route: '/pos-returns', path: '/pos-returns', page: 'pos', feature: 'club.pos' },
  // Планы и связь
  { group: 'Планы и связь', icon: 'flag', label: 'Цели и KPI', route: '/goals', path: '/goals', page: 'goals', feature: 'finance.pnl' },
  { group: 'Планы и связь', icon: 'calculator', label: 'Финмодель точки', route: '/branch-plan', path: '/branch-plan', page: 'branch-plan', feature: 'finance.pnl' },
  { group: 'Планы и связь', icon: 'flask', label: 'Симуляция', route: '/simulation', path: '/simulation', page: 'simulation', feature: 'finance.pnl' },
  { group: 'Планы и связь', icon: 'newspaper', label: 'Новости', route: '/news', path: '/news', page: 'news' },
  { group: 'Планы и связь', icon: 'chatbubbles', label: 'Сообщения', route: '/messages', path: '/messages', page: 'messages' },
  { group: 'Планы и связь', icon: 'calendar-number', label: 'Календарь', route: '/calendar', path: '/calendar', page: 'calendar' },
  // Прочее
  { group: 'Прочее', icon: 'game-controller', label: 'Арена', route: '/arena', path: '/arena', feature: 'club.pos' },
  // Платформа (только суперадмин)
  { group: 'Платформа', icon: 'planet', label: 'Кокпит платформы', route: '/platform', path: '/platform', superadmin: true },
  { group: 'Платформа', icon: 'business', label: 'Организации', route: '/organizations', path: '/organizations', superadmin: true },
  { group: 'Платформа', icon: 'document-text', label: 'Счета', route: '/invoices', path: '/invoices', superadmin: true },
]

const GROUP_ORDER = ['Финансы', 'Команда', 'Клиенты', 'Склад', 'Продажи', 'Планы и связь', 'Прочее', 'Платформа']

export default function MoreScreen() {
  const { session, role, signOut } = useAuth()
  const router = useRouter()
  const [sub, setSub] = useState<Sub['data']>(null)
  const [pending, setPending] = useState(0)

  const visible = SECTIONS.filter((s) =>
    s.superadmin
      ? !!role?.isSuperAdmin
      : canSee(role, { path: s.path, page: s.page }) && hasFeature(role, s.feature),
  )
  const groups = GROUP_ORDER.map((g) => ({ name: g, items: visible.filter((s) => s.group === g) })).filter((g) => g.items.length > 0)

  const load = useCallback(async () => {
    try { const r = await apiFetch<Sub>('/api/admin/my-subscription'); setSub(r.data || null) } catch { /* ignore */ }
    try { const p = await apiFetch<{ data: any[] }>('/api/admin/expenses/pending'); setPending((p.data || []).length) } catch { /* ignore */ }
  }, [])
  useEffect(() => { void load() }, [load])

  // биометрия входа
  const [bioAvail, setBioAvail] = useState(false)
  const [bioOn, setBioOn] = useState(false)
  const [bioLabel, setBioLabel] = useState('биометрии')
  useEffect(() => {
    void (async () => {
      const av = await isBiometricAvailable()
      setBioAvail(av)
      if (av) { setBioOn(await isBiometricEnabled()); setBioLabel(await biometricLabel()) }
    })()
  }, [])
  const toggleBio = async (v: boolean) => {
    if (v) {
      if (!(await authenticate())) { haptic.error(); return }
      haptic.success()
    }
    await setBiometricEnabled(v)
    setBioOn(v)
  }

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

        {bioAvail ? (
          <View style={{ gap: S.sm }}>
            <SectionTitle>Безопасность</SectionTitle>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(16,185,129,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="finger-print" size={20} color={T.green} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }}>Вход по {bioLabel}</Text>
                <Text style={{ color: T.textDim, fontSize: 12 }}>Блокировать приложение при открытии</Text>
              </View>
              <Switch value={bioOn} onValueChange={(v) => void toggleBio(v)} trackColor={{ true: T.green, false: '#2a2f37' }} thumbColor="#fff" />
            </Card>
          </View>
        ) : null}

        <Pressable onPress={onLogout} style={{ marginTop: 4, padding: 16, borderRadius: R.lg, borderWidth: 1, borderColor: '#3b1212', backgroundColor: '#160c0c', alignItems: 'center' }}>
          <Text style={{ color: T.red, fontWeight: '800', fontSize: 15 }}>Выйти из аккаунта</Text>
        </Pressable>
        <Text style={{ color: T.textDim, fontSize: 11, textAlign: 'center', marginTop: 4 }}>Orda · v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  )
}
