import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/auth'
import { apiFetch, ApiError } from '@/lib/api'

type SubscriptionResp = {
  data?: {
    organization?: { name?: string; slug?: string; status?: string } | null
    subscription?: { status?: string } | null
    package?: { name?: string } | null
  } | null
}

export default function DashboardScreen() {
  const { session, signOut } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [planName, setPlanName] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      // Простой авторизованный вызов — доказывает сквозной путь:
      // Supabase-сессия → Bearer → Next.js API → данные своей орг.
      const res = await apiFetch<SubscriptionResp>('/api/admin/my-subscription')
      setOrgName(res.data?.organization?.name ?? '—')
      setPlanName(res.data?.package?.name ?? 'без пакета')
      setStatus(res.data?.subscription?.status ?? res.data?.organization?.status ?? null)
    } catch (e: any) {
      const msg = e instanceof ApiError ? `${e.message} (${e.status})` : e?.message || 'Ошибка'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B0C0A' }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#10b981" />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700' }}>Кабинет</Text>
          <Pressable onPress={signOut}>
            <Text style={{ color: '#9ca3af' }}>Выйти</Text>
          </Pressable>
        </View>

        <Text style={{ color: '#6b7280' }}>{session?.user?.email}</Text>

        {loading ? (
          <ActivityIndicator color="#10b981" style={{ marginTop: 40 }} />
        ) : error ? (
          <Card>
            <Text style={{ color: '#f87171', fontWeight: '600' }}>Не удалось загрузить</Text>
            <Text style={{ color: '#9ca3af', marginTop: 6 }}>{error}</Text>
          </Card>
        ) : (
          <>
            <Card>
              <Label>Организация</Label>
              <Value>{orgName}</Value>
            </Card>
            <Card>
              <Label>Тариф</Label>
              <Value>{planName}</Value>
              {status ? <Text style={{ color: '#10b981', marginTop: 4 }}>{status}</Text> : null}
            </Card>
            <Card>
              <Label>Финансы</Label>
              <Text style={{ color: '#6b7280', marginTop: 4 }}>Дашборд/выручка — следующий экран.</Text>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: '#15171a', borderWidth: 1, borderColor: '#23262b', borderRadius: 18, padding: 18 }}>
      {children}
    </View>
  )
}
function Label({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: '#9ca3af', fontSize: 13 }}>{children}</Text>
}
function Value({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 4 }}>{children}</Text>
}
