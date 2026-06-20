import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S } from '@/lib/theme'
import { Card, GlowHero } from '@/components/ui'

type Thread = {
  otherUserId: string
  otherName: string
  lastMessage: string
  lastAttachmentType?: string | null
  lastAt: string
  lastFromMe: boolean
  unreadCount: number
}

const fmtTime = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

const initial = (name: string) => (name?.trim()?.charAt(0) || '?').toUpperCase()

export default function MessagesScreen() {
  const router = useRouter()
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ threads: Thread[] }>('/api/direct-messages/threads')
      setThreads(res?.threads || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const totalUnread = useMemo(
    () => threads.reduce((sum, t) => sum + Number(t.unreadCount || 0), 0),
    [threads],
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Сообщения</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && threads.length > 0} onRefresh={load} tintColor={T.green} />}
      >
        <GlowHero glow={T.violet}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>НЕПРОЧИТАННЫХ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{totalUnread}</Text>
          <Text style={{ color: T.textMut, fontSize: 13, marginTop: 3 }}>{threads.length} переписок</Text>
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && threads.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && threads.length === 0 && !error ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="chatbubbles-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Переписок ещё нет</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {threads.map((t, i) => (
              <View
                key={t.otherUserId}
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'center',
                  padding: 14,
                  borderBottomWidth: i < threads.length - 1 ? 1 : 0,
                  borderBottomColor: T.borderSoft,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: 'rgba(245,158,11,0.15)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: T.amber, fontSize: 17, fontWeight: '900' }}>{initial(t.otherName)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                      {t.otherName || 'Без имени'}
                    </Text>
                    <Text style={{ color: T.textDim, fontSize: 11, fontWeight: '600' }}>{fmtTime(t.lastAt)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 12.5,
                        color: t.unreadCount > 0 ? T.text : T.textDim,
                        fontWeight: t.unreadCount > 0 ? '600' : '400',
                      }}
                      numberOfLines={1}
                    >
                      {t.lastFromMe ? 'Вы: ' : ''}
                      {t.lastMessage || ''}
                    </Text>
                    {t.unreadCount > 0 ? (
                      <View
                        style={{
                          minWidth: 20,
                          paddingHorizontal: 6,
                          height: 20,
                          borderRadius: 10,
                          backgroundColor: T.amber,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#0b0b0b', fontSize: 11, fontWeight: '900' }}>{t.unreadCount}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
