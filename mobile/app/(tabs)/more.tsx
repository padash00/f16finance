import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { useAuth } from '@/lib/auth'
import { canSee } from '@/lib/access'
import { apiFetch } from '@/lib/api'
import { T } from '@/lib/theme'
import { Card, SectionTitle } from '@/components/ui'

type Sub = { data?: { organization?: { name?: string }; subscription?: { status?: string }; package?: { name?: string } } | null }

// path — web-путь (role_permissions), page — capability-страница из /access.
const SECTIONS: { icon: any; label: string; route?: string; path: string; page?: string }[] = [
  { icon: 'cash', label: 'Доходы', route: '/income', path: '/income', page: 'income' },
  { icon: 'card', label: 'Расходы', route: '/expenses', path: '/expenses', page: 'expenses' },
  { icon: 'swap-horizontal', label: 'Движение денег', path: '/cashflow', page: 'cashflow' },
  { icon: 'alert-circle', label: 'Долги с точки', route: '/debts', path: '/point-debts', page: 'point-debts' },
  { icon: 'calendar', label: 'Смены', path: '/shifts', page: 'shifts' },
  { icon: 'wallet', label: 'Зарплата', path: '/salary', page: 'salary' },
  { icon: 'checkmark-done', label: 'Согласования', route: '/approvals', path: '/expenses', page: 'expenses-pending' },
  { icon: 'cube', label: 'Склад', route: '/warehouse', path: '/store', page: 'store' },
  { icon: 'game-controller', label: 'Арена', path: '/arena' },
  { icon: 'document-text', label: 'Отчёты', path: '/reports', page: 'reports' },
]

export default function MoreScreen() {
  const { session, role, signOut } = useAuth()
  const router = useRouter()
  const [sub, setSub] = useState<Sub['data']>(null)
  const [pending, setPending] = useState(0)

  const sections = SECTIONS.filter((s) => canSee(role, { path: s.path, page: s.page }))

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
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 14 }}>
        <Text style={{ color: T.text, fontSize: 24, fontWeight: '800' }}>Ещё</Text>

        {/* Организация */}
        <Card style={{ gap: 4 }}>
          <Text style={{ color: T.textMut, fontSize: 12 }}>Организация</Text>
          <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>{sub?.organization?.name || '—'}</Text>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }}>
            Тариф: {sub?.package?.name || 'без пакета'}{sub?.subscription?.status ? ` · ${sub.subscription.status}` : ''}
          </Text>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 4 }}>{session?.user?.email}</Text>
        </Card>

        {/* Разделы — отфильтрованы по правам роли (rolePermissionOverrides из /access) */}
        <SectionTitle hint={role?.roleLabel || undefined}>Разделы</SectionTitle>
        <Card style={{ padding: 6 }}>
          {sections.map((s, i) => (
            <Pressable
              key={s.label}
              onPress={() => s.route ? router.push(s.route as any) : Alert.alert(s.label, 'Этот раздел скоро появится в приложении.')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 10, borderBottomWidth: i < sections.length - 1 ? 1 : 0, borderBottomColor: T.border }}
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

        <Pressable onPress={onLogout} style={{ marginTop: 6, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#3b1212', backgroundColor: '#160c0c', alignItems: 'center' }}>
          <Text style={{ color: T.red, fontWeight: '700', fontSize: 15 }}>Выйти из аккаунта</Text>
        </Pressable>
        <Text style={{ color: T.textDim, fontSize: 11, textAlign: 'center', marginTop: 4 }}>Orda · v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  )
}
