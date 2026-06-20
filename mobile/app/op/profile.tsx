import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { T, R, S } from '@/lib/theme'
import { Card, SectionTitle, Pill } from '@/components/ui'

type Profile = {
  operator: {
    name: string; short_name: string | null; username: string | null; auth_role: string | null
    profile: { position: string | null; phone: string | null; email: string | null; hire_date: string | null; city: string | null; about: string | null }
  }
  assignments: { id: string; companyName: string | null; role: string | null; isPrimary: boolean }[]
}

const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }) : null)

export default function OperatorProfile() {
  const { signOut } = useAuth()
  const [d, setD] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setD(await apiFetch<{ ok: boolean } & Profile>('/api/operator/profile')) }
    catch (e: any) { setError(e?.message || 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const onLogout = () => Alert.alert('Выйти из аккаунта?', '', [{ text: 'Отмена', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: () => void signOut() }])

  const p = d?.operator
  const contacts = p ? [
    { icon: 'call-outline', value: p.profile.phone },
    { icon: 'mail-outline', value: p.profile.email },
    { icon: 'location-outline', value: p.profile.city },
    { icon: 'calendar-outline', value: fmtDate(p.profile.hire_date) ? `в команде с ${fmtDate(p.profile.hire_date)}` : null },
  ].filter((c) => c.value) : []

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}>
        <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>Профиль</Text>

        {loading && !d ? <ActivityIndicator color={T.green} style={{ marginTop: 50 }} /> : error ? (
          <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>Не удалось загрузить</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : p ? (
          <>
            <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
              <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(16,185,129,0.16)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.4)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: T.greenBright, fontSize: 28, fontWeight: '900' }}>{initials(p.name)}</Text>
              </View>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: '900', marginTop: 6 }}>{p.name}</Text>
              {p.profile.position ? <Text style={{ color: T.textMut, fontSize: 14 }}>{p.profile.position}</Text> : null}
              {p.username ? <Pill text={`@${p.username}`} tone="mut" /> : null}
            </Card>

            {p.profile.about ? <Card><Text style={{ color: T.textMut, fontSize: 14, lineHeight: 20 }}>{p.profile.about}</Text></Card> : null}

            {contacts.length > 0 ? (
              <Card style={{ gap: 2, paddingVertical: 4 }}>
                {contacts.map((c, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: i < contacts.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                    <Ionicons name={c.icon as any} size={18} color={T.textMut} />
                    <Text style={{ color: T.text, fontSize: 14 }}>{c.value}</Text>
                  </View>
                ))}
              </Card>
            ) : null}

            {d.assignments.length > 0 ? (
              <>
                <SectionTitle>Мои точки</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 4 }}>
                  {d.assignments.map((a, i, arr) => (
                    <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        <Ionicons name="business-outline" size={18} color={T.textMut} />
                        <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>{a.companyName || 'Точка'}</Text>
                      </View>
                      {a.isPrimary ? <Pill text="основная" tone="good" /> : null}
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            <Pressable onPress={onLogout} style={{ marginTop: 4, padding: 16, borderRadius: R.lg, borderWidth: 1, borderColor: '#3b1212', backgroundColor: '#160c0c', alignItems: 'center' }}>
              <Text style={{ color: T.red, fontWeight: '800', fontSize: 15 }}>Выйти из аккаунта</Text>
            </Pressable>
            <Text style={{ color: T.textDim, fontSize: 11, textAlign: 'center' }}>Orda · v0.1.0</Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
