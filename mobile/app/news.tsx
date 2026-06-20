import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'

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
  const [posts, setPosts] = useState<Post[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Resp>('/api/news?limit=50')
      setPosts(res?.posts || [])
      setUnread(Number(res?.unreadCount || 0))
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Лента</Text>
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
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && posts.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && posts.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="newspaper-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>Лента пуста</Text>
            <Text style={{ color: T.textMut, fontSize: 13 }}>Ещё нет постов</Text>
          </Card>
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
    </SafeAreaView>
  )
}
