import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'

type Staff = {
  id: string
  full_name: string | null
  role: string | null
  short_name: string | null
  monthly_salary: number | null
  is_active: boolean
  phone?: string | null
  email?: string | null
}

type AccountState = 'no_email' | 'no_account' | 'invited' | 'active'

type AccountInfo = {
  staffId: string
  email: string | null
  phone: string | null
  full_name: string | null
  accountState: AccountState
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Собственник',
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  other: 'Сотрудник',
}

const ACCOUNT_LABEL: Record<AccountState, { text: string; tone: 'good' | 'warn' | 'mut' }> = {
  active: { text: 'Аккаунт активен', tone: 'good' },
  invited: { text: 'Приглашён', tone: 'warn' },
  no_account: { text: 'Нет аккаунта', tone: 'warn' },
  no_email: { text: 'Нет email', tone: 'warn' },
}

export default function StaffScreen() {
  const router = useRouter()
  const [items, setItems] = useState<Staff[]>([])
  const [accounts, setAccounts] = useState<Record<string, AccountInfo>>({})
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ staff?: Staff[] }>('/api/admin/staff')
      const rows = res.staff || []
      setItems(rows)

      if (rows.length > 0) {
        const ids = rows.map((r) => r.id).join(',')
        try {
          const acc = await apiFetch<{ items?: AccountInfo[] }>(
            `/api/admin/staff-accounts?staffIds=${encodeURIComponent(ids)}`,
          )
          const map: Record<string, AccountInfo> = {}
          for (const a of acc.items || []) if (a?.staffId) map[a.staffId] = a
          setAccounts(map)
        } catch {
          setAccounts({})
        }
      } else {
        setAccounts({})
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    let totalBudget = 0
    let active = 0
    let inactive = 0
    for (const s of items) {
      if (s.is_active) {
        active += 1
        totalBudget += Number(s.monthly_salary || 0)
      } else {
        inactive += 1
      }
    }
    const avg = active > 0 ? totalBudget / active : 0
    return { totalBudget, active, inactive, avg }
  }, [items])

  const visible = useMemo(() => {
    const list = items.filter((s) => showInactive || s.is_active)
    return [...list].sort((a, b) => {
      if (Number(b.is_active) - Number(a.is_active) !== 0) return Number(b.is_active) - Number(a.is_active)
      return (a.full_name || '').localeCompare(b.full_name || '')
    })
  }, [items, showInactive])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Сотрудники</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.green}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ФОНД ОПЛАТЫ ТРУДА</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(stats.totalBudget)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`активных ${stats.active}`} tone="good" />
            {stats.inactive > 0 ? <Pill text={`в архиве ${stats.inactive}`} tone="mut" /> : null}
            {stats.avg > 0 ? <Pill text={`средний ${moneyShort(stats.avg)}`} tone="brand" /> : null}
          </View>
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {stats.inactive > 0 ? (
          <Pressable
            onPress={() => setShowInactive((v) => !v)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 8,
            }}
          >
            <Ionicons name={showInactive ? 'eye-off-outline' : 'eye-outline'} size={16} color={T.textMut} />
            <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '600' }}>
              {showInactive ? 'Скрыть архивных' : `Показать архивных (${stats.inactive})`}
            </Text>
          </Pressable>
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : visible.length === 0 && !loading ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Ionicons name="people-outline" size={36} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14, marginTop: 8 }}>Список сотрудников пуст</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {visible.map((s, i) => {
              const role = ROLE_LABEL[s.role || 'other'] || 'Сотрудник'
              const acc = accounts[s.id]
              const accState = acc?.accountState
              return (
                <View
                  key={s.id}
                  style={{
                    flexDirection: 'row',
                    gap: 12,
                    padding: 14,
                    opacity: s.is_active ? 1 : 0.55,
                    borderBottomWidth: i < visible.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                      {s.full_name || s.short_name || 'Без имени'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
                      <Pill text={role} tone="brand" />
                      {!s.is_active ? <Pill text="Архив" tone="bad" /> : null}
                      {accState ? <Pill text={ACCOUNT_LABEL[accState].text} tone={ACCOUNT_LABEL[accState].tone} /> : null}
                    </View>
                    {acc?.email || s.email ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 6 }} numberOfLines={1}>
                        {acc?.email || s.email}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{money(Number(s.monthly_salary || 0))}</Text>
                    <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>оклад / мес</Text>
                  </View>
                </View>
              )
            })}
          </Card>
        )}

        {visible.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center' }}>
            Показано {visible.length} из {items.length}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
