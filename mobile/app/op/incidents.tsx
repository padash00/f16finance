import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill } from '@/components/ui'

type Incident = {
  id: string; kind: string | null; severity: string | null; status: string | null
  title: string | null; description: string | null
  fine_amount: number | null; bonus_amount: number | null
  occurred_at: string | null; created_at: string | null
}

const sevTone = (s: string | null): 'bad' | 'warn' | 'mut' => (s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'mut')
const statusLabel = (s: string | null) => (s === 'open' ? 'Открыт' : s === 'resolved' ? 'Решён' : s === 'closed' ? 'Закрыт' : s || '')
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

export default function OperatorIncidents() {
  const router = useRouter()
  const [items, setItems] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const r = await apiFetch<{ incidents: Incident[] }>('/api/operator/incidents?limit=100'); setItems(r.incidents || []) }
    catch (e: any) { setError(e?.message || 'Не удалось загрузить') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Инциденты</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.sm }} refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={load} tintColor={T.green} />}>
        {loading && items.length === 0 ? <ActivityIndicator color={T.green} style={{ marginTop: 40 }} /> : error ? (
          <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : items.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={38} color={T.green} />
            <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>Инцидентов нет</Text>
          </Card>
        ) : items.map((it) => (
          <Card key={it.id} style={{ gap: 8, borderLeftWidth: 3, borderLeftColor: it.severity === 'high' ? T.red : it.severity === 'medium' ? T.amber : T.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <Text style={{ color: T.text, fontSize: 15, fontWeight: '800', flex: 1 }} numberOfLines={2}>{it.title || it.kind || 'Инцидент'}</Text>
              <Pill text={statusLabel(it.status)} tone={it.status === 'open' ? 'warn' : 'mut'} />
            </View>
            {it.description ? <Text style={{ color: T.textMut, fontSize: 13 }} numberOfLines={3}>{it.description}</Text> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {it.severity ? <Pill text={it.severity === 'high' ? 'важно' : it.severity === 'medium' ? 'средне' : 'инфо'} tone={sevTone(it.severity)} /> : null}
              {Number(it.fine_amount) > 0 ? <Pill text={`штраф ${money(it.fine_amount)}`} tone="bad" /> : null}
              {Number(it.bonus_amount) > 0 ? <Pill text={`бонус ${money(it.bonus_amount)}`} tone="good" /> : null}
              <Text style={{ color: T.textDim, fontSize: 11 }}>{fmt(it.occurred_at || it.created_at)}</Text>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}
