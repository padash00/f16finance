import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, SectionTitle, Pill } from '@/components/ui'

type Tpl = { id: string; title: string; description: string | null; shift_scope: string | null; blocks_shift: boolean | null }
type Item = { id: string; template_id: string; title: string; description: string | null; is_required: boolean | null; requires_photo: boolean | null; severity: string | null; sort_order: number | null }
type Data = { checklist_templates: Tpl[]; checklist_items: Item[]; open_shift: any }

export default function OperatorChecklist() {
  const router = useRouter()
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const r = await apiFetch<{ data: Data }>('/api/operator/knowledge'); setD(r.data) }
    catch (e: any) { setError(e?.message || 'Не удалось загрузить') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const itemsByTpl = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const it of d?.checklist_items || []) {
      const l = m.get(it.template_id) || []; l.push(it); m.set(it.template_id, l)
    }
    for (const l of m.values()) l.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    return m
  }, [d])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Чек-листы</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}>
        <View style={{ backgroundColor: 'rgba(96,165,250,0.08)', borderColor: 'rgba(96,165,250,0.3)', borderWidth: 1, borderRadius: R.md, padding: 10 }}>
          <Text style={{ color: T.blue, fontSize: 12 }}>Отметка пунктов — на открытой смене через терминал. Здесь видно, что нужно проверить.</Text>
        </View>

        {loading && !d ? <ActivityIndicator color={T.green} style={{ marginTop: 40 }} /> : error ? (
          <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : (d?.checklist_templates || []).length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}><Ionicons name="list-outline" size={36} color={T.textDim} /><Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>Чек-листов нет</Text></Card>
        ) : (d?.checklist_templates || []).map((t) => {
          const items = itemsByTpl.get(t.id) || []
          return (
            <View key={t.id} style={{ gap: S.sm }}>
              <SectionTitle hint={`${items.length} пунктов`}>{t.title}</SectionTitle>
              {t.description ? <Text style={{ color: T.textMut, fontSize: 13, marginTop: -6 }}>{t.description}</Text> : null}
              <Card style={{ gap: 2, paddingVertical: 4 }}>
                {items.map((it, i, arr) => (
                  <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                    <Ionicons name="ellipse-outline" size={18} color={T.textDim} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: T.text, fontSize: 14 }}>{it.title}</Text>
                      {it.description ? <Text style={{ color: T.textDim, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{it.description}</Text> : null}
                    </View>
                    {it.requires_photo ? <Ionicons name="camera-outline" size={15} color={T.textDim} /> : null}
                    {it.is_required ? <Pill text="обяз." tone="warn" /> : null}
                  </View>
                ))}
              </Card>
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}
