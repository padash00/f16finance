import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, R, S } from '@/lib/theme'
import { Card, Pill, GlowHero, ErrorState, EmptyState, PrimaryButton, GhostButton } from '@/components/ui'

type Post = {
  id: string
  author_name: string | null
  title: string | null
  body: string | null
  image_url: string | null
  link_url: string | null
  link_label: string | null
  created_at: string | null
  viewed: boolean
}

type Resp = { posts: Post[]; unreadCount: number; canPublish: boolean }

const fmtTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return 'сегодня · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function NewsScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canCreateCap = canDo(role, 'news.create')

  const [posts, setPosts] = useState<Post[]>([])
  const [unread, setUnread] = useState(0)
  const [canPublish, setCanPublish] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // модалка публикации
  const [modalOpen, setModalOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Resp>('/api/news?limit=50')
      setPosts(res?.posts || [])
      setUnread(Number(res?.unreadCount || 0))
      setCanPublish(!!res?.canPublish)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Кнопку показываем только если есть и право в приложении, и серверный флаг публикации
  const showPublish = canCreateCap && canPublish

  const openCreate = () => {
    setDraftTitle('')
    setDraftBody('')
    setFormError(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setDraftTitle('')
    setDraftBody('')
    setFormError(null)
  }

  const submit = async () => {
    const text = draftBody.trim()
    if (!text) { setFormError('Введите текст новости'); return }
    if (text.length > 2000) { setFormError('Слишком длинный текст (макс 2000)'); return }
    setSaving(true)
    setFormError(null)
    try {
      await apiFetch('/api/news', {
        method: 'POST',
        body: JSON.stringify({
          title: draftTitle.trim() || null,
          body: text,
        }),
      })
      haptic.success()
      setModalOpen(false)
      setDraftTitle('')
      setDraftBody('')
      await load()
    } catch (e: any) {
      haptic.error()
      setFormError(e?.message || 'Не удалось опубликовать')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Лента</Text>
        {showPublish ? (
          <Pressable
            onPress={openCreate}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.green, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 7 }}
          >
            <Ionicons name="add" size={16} color="#04130d" />
            <Text style={{ color: '#04130d', fontSize: 13, fontWeight: '900' }}>Новость</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && posts.length > 0} onRefresh={load} tintColor={T.green} />}
      >
        <GlowHero glow={T.violet}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>НОВОСТИ И ОБЪЯВЛЕНИЯ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{posts.length}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`${posts.length} постов`} tone="brand" />
            {unread > 0 ? <Pill text={`${unread} непрочитанных`} tone="warn" /> : null}
          </View>
        </GlowHero>

        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : null}

        {loading && posts.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && posts.length === 0 ? (
          <EmptyState icon="newspaper-outline" title="Лента пуста" hint="Ещё нет постов" />
        ) : (
          posts.map((post) => (
            <Card key={post.id} style={post.viewed ? undefined : { borderColor: 'rgba(139,92,246,0.4)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: post.title || post.body || post.image_url ? S.md : 0 }}>
                <View style={{ width: 38, height: 38, borderRadius: R.pill, backgroundColor: 'rgba(139,92,246,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: T.violet, fontSize: 16, fontWeight: '900' }}>
                    {(post.author_name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{post.author_name || 'Владелец'}</Text>
                  <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }}>{fmtTime(post.created_at)}</Text>
                </View>
                {!post.viewed ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.violet }} /> : null}
              </View>

              {post.title ? (
                <Text style={{ color: T.text, fontSize: 17, fontWeight: '800', marginBottom: S.sm }}>{post.title}</Text>
              ) : null}

              {post.image_url ? (
                <Image
                  source={{ uri: post.image_url }}
                  style={{ width: '100%', height: 200, borderRadius: R.md, marginBottom: S.md, backgroundColor: T.card2 }}
                  resizeMode="cover"
                />
              ) : null}

              {post.body ? (
                <Text style={{ color: T.text, fontSize: 14, lineHeight: 20 }}>{post.body}</Text>
              ) : null}

              {post.link_url ? (
                <Pressable
                  onPress={() => post.link_url && Linking.openURL(post.link_url).catch(() => {})}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: S.md }}
                  hitSlop={6}
                >
                  <Ionicons name="link-outline" size={15} color={T.blue} />
                  <Text style={{ color: T.blue, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
                    {post.link_label || post.link_url}
                  </Text>
                </Pressable>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>

      {/* Модалка публикации новости */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>Новая новость</Text>
              <Pressable onPress={closeModal} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 12 }}>
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Заголовок</Text>
                <TextInput
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  placeholder="Необязательно"
                  placeholderTextColor={T.textDim}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Текст *</Text>
                <TextInput
                  value={draftBody}
                  onChangeText={setDraftBody}
                  placeholder="Текст новости..."
                  placeholderTextColor={T.textDim}
                  multiline
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15, minHeight: 120, textAlignVertical: 'top' }}
                />
              </View>
            </ScrollView>

            {formError ? <Text style={{ color: T.red, fontSize: 12 }}>{formError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <GhostButton label="Отмена" onPress={closeModal} disabled={saving} style={{ flex: 1 }} />
              <PrimaryButton label="Опубликовать" loading={saving} disabled={saving} onPress={() => void submit()} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
