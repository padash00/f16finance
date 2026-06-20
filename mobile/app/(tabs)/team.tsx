import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { apiFetch } from '@/lib/api'
import { T } from '@/lib/theme'
import { Card, SectionTitle, Pill } from '@/components/ui'

type Device = { id: string; name: string; isOnline: boolean; ageSeconds: number | null; operatorName: string | null }
type Presence = { devices: Device[]; onlineCount: number }

function ago(sec: number | null) {
  if (sec == null) return '—'
  if (sec < 60) return `${sec} сек назад`
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`
  return `${Math.floor(sec / 3600)} ч назад`
}

export default function TeamScreen() {
  const [p, setP] = useState<Presence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await apiFetch<Presence>('/api/admin/operators-presence')
      setP(res)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const online = p?.devices.filter((d) => d.isOnline) || []
  const offline = p?.devices.filter((d) => !d.isOnline) || []

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 14 }} refreshControl={<RefreshControl refreshing={loading && !!p} onRefresh={load} tintColor={T.green} />}>
        <Text style={{ color: T.text, fontSize: 24, fontWeight: '800' }}>Команда</Text>

        {loading && !p ? <ActivityIndicator color={T.green} style={{ marginTop: 50 }} /> : error ? (
          <Card><Text style={{ color: T.red, fontWeight: '700' }}>Не удалось загрузить</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : p ? (
          <>
            <Card style={{ padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: T.textMut, fontSize: 13 }}>Сейчас на смене</Text>
                <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 4 }}>{p.onlineCount}</Text>
              </View>
              <Pill text={`${p.devices.length} устройств`} tone="mut" />
            </Card>

            {online.length > 0 ? (
              <>
                <SectionTitle hint="онлайн">Активны</SectionTitle>
                <Card style={{ gap: 14 }}>
                  {online.map((d) => (
                    <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: T.green }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.text, fontSize: 15, fontWeight: '600' }}>{d.operatorName || d.name}</Text>
                        <Text style={{ color: T.textDim, fontSize: 11 }}>{d.name} · {ago(d.ageSeconds)}</Text>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            ) : (
              <Card><Text style={{ color: T.textMut }}>Сейчас никто не на смене</Text></Card>
            )}

            {offline.length > 0 ? (
              <>
                <SectionTitle hint={`${offline.length}`}>Не в сети</SectionTitle>
                <Card style={{ gap: 12 }}>
                  {offline.slice(0, 10).map((d) => (
                    <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: '#3b3f46' }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.textMut, fontSize: 14 }}>{d.operatorName || d.name}</Text>
                        <Text style={{ color: T.textDim, fontSize: 11 }}>{ago(d.ageSeconds)}</Text>
                      </View>
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
