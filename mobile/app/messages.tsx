import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { useAuth } from '@/lib/auth'
import { T, R, S } from '@/lib/theme'
import { Card, GlowHero, ErrorState, EmptyState, SkeletonList } from '@/components/ui'

type Thread = {
  otherUserId: string
  otherName: string
  lastMessage: string
  lastAttachmentType?: string | null
  lastAt: string
  lastFromMe: boolean
  unreadCount: number
}

type ChatMessage = {
  id: string
  sender_user_id: string
  recipient_user_id: string
  sender_name: string
  message: string
  deleted_at: string | null
  created_at: string
  read_at: string | null
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
  const { session } = useAuth()
  const myUserId = session?.user?.id || null
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

  // ── Переписка (модалка) ──────────────────────────────────────────────
  const [chatUser, setChatUser] = useState<{ id: string; name: string } | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  const loadConversation = useCallback(async (userId: string) => {
    setChatLoading(true)
    setChatError(null)
    try {
      const res = await apiFetch<{ messages: ChatMessage[] }>(`/api/direct-messages/${userId}`)
      setChatMessages(res?.messages || [])
    } catch (e: any) {
      setChatError(e?.message || 'Не удалось загрузить переписку')
    } finally {
      setChatLoading(false)
    }
  }, [])

  const openChat = useCallback((userId: string, name: string) => {
    setChatUser({ id: userId, name })
    setChatMessages([])
    setDraft('')
    setChatError(null)
    void loadConversation(userId)
  }, [loadConversation])

  const closeChat = useCallback(() => {
    setChatUser(null)
    setChatMessages([])
    setDraft('')
    setChatError(null)
    void load()
  }, [load])

  const sendMessage = useCallback(async () => {
    const text = draft.trim()
    if (!text || !chatUser) return
    setSending(true)
    setChatError(null)
    try {
      await apiFetch('/api/direct-messages', {
        method: 'POST',
        body: JSON.stringify({ recipientUserId: chatUser.id, message: text }),
      })
      setDraft('')
      haptic.success()
      await loadConversation(chatUser.id)
    } catch (e: any) {
      haptic.error()
      setChatError(e?.message || 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }, [draft, chatUser, loadConversation])

  useEffect(() => {
    if (chatMessages.length > 0) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
    }
  }, [chatMessages])

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

        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {loading && threads.length === 0 ? (
          <SkeletonList rows={6} />
        ) : !loading && threads.length === 0 && !error ? (
          <EmptyState icon="chatbubbles-outline" title="Переписок ещё нет" />
        ) : (
          <Card style={{ padding: 0 }}>
            {threads.map((t, i) => (
              <Pressable
                key={t.otherUserId}
                onPress={() => openChat(t.otherUserId, t.otherName || 'Без имени')}
                android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'center',
                  padding: 14,
                  borderBottomWidth: i < threads.length - 1 ? 1 : 0,
                  borderBottomColor: T.borderSoft,
                  opacity: pressed ? 0.6 : 1,
                })}
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
              </Pressable>
            ))}
          </Card>
        )}
      </ScrollView>

      <Modal visible={!!chatUser} animationType="slide" transparent onRequestClose={closeChat}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}
        >
          <View
            style={{
              backgroundColor: T.card,
              borderTopLeftRadius: R.xl,
              borderTopRightRadius: R.xl,
              borderWidth: 1,
              borderColor: T.border,
              height: '82%',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: S.lg,
                paddingTop: 14,
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: T.borderSoft,
              }}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: 'rgba(245,158,11,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: T.amber, fontSize: 16, fontWeight: '900' }}>{initial(chatUser?.name || '?')}</Text>
              </View>
              <Text style={{ color: T.text, fontSize: 16, fontWeight: '900', flex: 1 }} numberOfLines={1}>
                {chatUser?.name || ''}
              </Text>
              <Pressable onPress={closeChat} hitSlop={10}>
                <Ionicons name="close" size={24} color={T.textMut} />
              </Pressable>
            </View>

            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: S.lg, gap: 8 }}
              keyboardShouldPersistTaps="handled"
            >
              {chatLoading && chatMessages.length === 0 ? (
                <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
              ) : chatMessages.length === 0 && !chatError ? (
                <Text style={{ color: T.textDim, fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                  Начните переписку — отправьте первое сообщение
                </Text>
              ) : (
                chatMessages
                  .filter((m) => !m.deleted_at)
                  .map((m) => {
                    const mine = m.sender_user_id === myUserId
                    return (
                      <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                        <View
                          style={{
                            maxWidth: '78%',
                            paddingHorizontal: 12,
                            paddingVertical: 9,
                            borderRadius: 16,
                            backgroundColor: mine ? T.green : '#181d23',
                          }}
                        >
                          <Text style={{ color: mine ? '#04130d' : T.text, fontSize: 14.5 }}>{m.message}</Text>
                          <Text
                            style={{
                              color: mine ? 'rgba(4,19,13,0.6)' : T.textDim,
                              fontSize: 10,
                              marginTop: 3,
                              alignSelf: 'flex-end',
                            }}
                          >
                            {fmtTime(m.created_at)}
                          </Text>
                        </View>
                      </View>
                    )
                  })
              )}
            </ScrollView>

            {chatError ? (
              <Text style={{ color: T.red, fontSize: 12, paddingHorizontal: S.lg, paddingBottom: 6 }}>{chatError}</Text>
            ) : null}

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: 8,
                paddingHorizontal: S.lg,
                paddingTop: 8,
                paddingBottom: 16,
                borderTopWidth: 1,
                borderTopColor: T.borderSoft,
              }}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Сообщение..."
                placeholderTextColor={T.textDim}
                multiline
                maxLength={2000}
                style={{
                  flex: 1,
                  maxHeight: 120,
                  backgroundColor: T.bg,
                  borderWidth: 1,
                  borderColor: T.border,
                  borderRadius: R.md,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  color: T.text,
                  fontSize: 15,
                }}
              />
              <Pressable
                onPress={() => void sendMessage()}
                disabled={sending || !draft.trim()}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: R.md,
                  backgroundColor: T.green,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: sending || !draft.trim() ? 0.5 : 1,
                }}
              >
                {sending ? <ActivityIndicator color="#04130d" /> : <Ionicons name="send" size={20} color="#04130d" />}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
