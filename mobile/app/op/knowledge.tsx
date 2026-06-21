import { useCallback, useEffect, useState } from 'react'
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, Pill, ErrorState, EmptyState, PrimaryButton, SkeletonList } from '@/components/ui'

type Article = { id: string; title: string; summary: string | null; content: string | null; severity: string | null; requires_confirmation: boolean; version: number | null; category?: { title?: string | null } | null }
type Data = { articles: Article[]; pending_confirmations: Article[] }

const sevTone = (s: string | null): 'bad' | 'warn' | 'mut' => (s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'mut')

export default function OperatorKnowledge() {
  const router = useRouter()
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Article | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const r = await apiFetch<{ data: Data }>('/api/operator/knowledge'); setD(r.data) }
    catch (e: any) { setError(e?.message || 'Не удалось загрузить') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const pendingIds = new Set((d?.pending_confirmations || []).map((a) => a.id))

  const confirm = async (a: Article) => {
    setConfirming(true)
    try {
      await apiFetch('/api/operator/knowledge/confirm', { method: 'POST', body: JSON.stringify({ article_id: a.id, version: a.version || 1 }) })
      setOpen(null)
      await load()
    } catch (e: any) { setError(e?.message || 'Не удалось подтвердить') }
    finally { setConfirming(false) }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>База знаний</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.sm }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}>
        {pendingIds.size > 0 ? (
          <View style={{ backgroundColor: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.3)', borderWidth: 1, borderRadius: R.md, padding: 12 }}>
            <Text style={{ color: T.amber, fontSize: 13, fontWeight: '800' }}>{pendingIds.size} статей требуют подтверждения</Text>
            <Text style={{ color: T.textMut, fontSize: 12, marginTop: 2 }}>Откройте и подтвердите, что ознакомились.</Text>
          </View>
        ) : null}

        {loading && !d ? <SkeletonList rows={6} /> : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (d?.articles || []).length === 0 ? (
          <EmptyState icon="book-outline" title="Материалов пока нет" />
        ) : (d?.articles || []).map((a) => (
          <Pressable key={a.id} onPress={() => setOpen(a)}>
            <Card style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '800', flex: 1 }} numberOfLines={2}>{a.title}</Text>
                {pendingIds.has(a.id) ? <Pill text="подтвердить" tone="warn" /> : null}
              </View>
              {a.summary ? <Text style={{ color: T.textMut, fontSize: 13 }} numberOfLines={2}>{a.summary}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {a.category?.title ? <Pill text={a.category.title} tone="mut" /> : null}
                {a.severity ? <Pill text={a.severity === 'high' ? 'важно' : a.severity === 'medium' ? 'средне' : 'инфо'} tone={sevTone(a.severity)} /> : null}
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: T.borderSoft }}>
            <Pressable onPress={() => setOpen(null)} hitSlop={10}><Ionicons name="close" size={24} color={T.text} /></Pressable>
            <Text style={{ color: T.text, fontSize: 16, fontWeight: '800', flex: 1 }} numberOfLines={1}>{open?.title}</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: 12 }}>
            <Text style={{ color: T.text, fontSize: 22, fontWeight: '900' }}>{open?.title}</Text>
            {open?.summary ? <Text style={{ color: T.textMut, fontSize: 14, lineHeight: 20 }}>{open.summary}</Text> : null}
            {open?.content ? <Text style={{ color: T.text, fontSize: 15, lineHeight: 23 }}>{open.content}</Text> : null}
            {open && open.requires_confirmation && pendingIds.has(open.id) ? (
              <PrimaryButton label="Подтверждаю, что ознакомился" loading={confirming} disabled={confirming} onPress={() => open && void confirm(open)} style={{ marginTop: 8 }} />

            ) : open && open.requires_confirmation ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 8 }}>
                <Ionicons name="checkmark-circle" size={18} color={T.green} /><Text style={{ color: T.green, fontWeight: '700' }}>Уже подтверждено</Text>
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}
