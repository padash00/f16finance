import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, SectionTitle, Pill } from '@/components/ui'

type Act = { act_id: string; locationName: string; comment: string | null; opened_at: string; sectionLabel: string }
type Item = { item_id: string; name: string; barcode: string | null; unit: string | null; counted: number | null; otherQty?: number | null; otherBy?: string | null }

const fmtDate = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function OperatorAudit() {
  const [acts, setActs] = useState<Act[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [active, setActive] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [autoStatus, setAutoStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const editsRef = useRef<Record<string, string>>({})
  const dirty = useRef<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { editsRef.current = edits }, [edits])

  const loadActs = useCallback(async () => {
    setLoading(true)
    try { const j = await apiFetch<{ data: Act[] }>('/api/operator/audit'); setActs(j.data || []); setError(null) }
    catch (e: any) { setError(e?.message || 'Не удалось загрузить') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void loadActs() }, [loadActs])

  const refreshItems = useCallback(async (id: string) => {
    try { const j = await apiFetch<{ data: { items: Item[] } }>(`/api/operator/audit?act=${encodeURIComponent(id)}`); if (Array.isArray(j.data?.items)) setItems(j.data.items) } catch { /* */ }
  }, [])

  const openAct = useCallback(async (id: string) => {
    setActive(id); setItemsLoading(true); setEdits({}); setAutoStatus('idle'); dirty.current = new Set()
    try {
      const j = await apiFetch<{ data: { items: Item[] } }>(`/api/operator/audit?act=${encodeURIComponent(id)}`)
      const list = j.data?.items || []
      setItems(list)
      const init: Record<string, string> = {}
      for (const it of list) if (it.counted != null) init[it.item_id] = String(it.counted)
      setEdits(init)
    } catch (e: any) { setError(e?.message || 'Не удалось загрузить товары') }
    finally { setItemsLoading(false) }
  }, [])

  // живой опрос отметок других кассиров
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => void refreshItems(active), 10000)
    return () => clearInterval(t)
  }, [active, refreshItems])

  const flush = useCallback(async () => {
    if (!active) return
    const ids = Array.from(dirty.current); dirty.current = new Set()
    const counts = ids.map((id) => ({ item_id: id, v: editsRef.current[id] }))
      .filter((x) => x.v != null && String(x.v).trim() !== '')
      .map((x) => ({ item_id: x.item_id, counted_qty: Number(String(x.v).replace(',', '.')) || 0 }))
    if (counts.length === 0) { setAutoStatus('idle'); return }
    setAutoStatus('saving')
    try {
      await apiFetch('/api/operator/audit', { method: 'POST', body: JSON.stringify({ act_id: active, counts }) })
      setItems((prev) => prev.map((it) => { const c = counts.find((x) => x.item_id === it.item_id); return c ? { ...it, counted: c.counted_qty } : it }))
      setAutoStatus('saved')
    } catch { for (const c of counts) dirty.current.add(c.item_id); setAutoStatus('error') }
  }, [active])

  const onCount = useCallback((id: string, val: string) => {
    setEdits((p) => ({ ...p, [id]: val })); dirty.current.add(id); setAutoStatus('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 800)
  }, [flush])

  const countedNum = Object.values(edits).filter((v) => String(v).trim() !== '').length

  // ── Список актов ──
  if (!active) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
        <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading} onRefresh={loadActs} tintColor={T.green} />}>
          <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>Ревизия</Text>
          <Text style={{ color: T.textMut, fontSize: 13 }}>Считайте товар по своей секции. Системный остаток не показывается.</Text>

          {error ? <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>{error}</Text></Card> : null}
          {loading ? <ActivityIndicator color={T.green} style={{ marginTop: 40 }} /> : acts.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: 36, gap: 8 }}>
              <Ionicons name="clipboard-outline" size={38} color={T.textDim} />
              <Text style={{ color: T.text, fontSize: 16, fontWeight: '800' }}>Нет активных ревизий</Text>
              <Text style={{ color: T.textDim, fontSize: 13, textAlign: 'center' }}>Когда руководитель назначит вас на акт — он появится здесь.</Text>
            </Card>
          ) : acts.map((a) => (
            <Pressable key={a.act_id} onPress={() => void openAct(a.act_id)}>
              <Card style={{ gap: 6, borderLeftWidth: 3, borderLeftColor: T.amber }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="clipboard" size={16} color={T.amber} />
                  <Text style={{ color: T.text, fontSize: 15, fontWeight: '800', flex: 1 }}>{a.locationName}</Text>
                  <Ionicons name="chevron-forward" size={18} color={T.textDim} />
                </View>
                <Text style={{ color: T.textDim, fontSize: 12 }}>секция: {a.sectionLabel} · {fmtDate(a.opened_at)}</Text>
                {a.comment ? <Text style={{ color: T.textMut, fontSize: 12 }}>{a.comment}</Text> : null}
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Подсчёт ──
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => { setActive(null); void loadActs() }} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: T.text, fontSize: 18, fontWeight: '900' }}>Подсчёт</Text>
          <Text style={{ color: T.textDim, fontSize: 11 }}>введено {countedNum} из {items.length}</Text>
        </View>
        <Text style={{ fontSize: 11, fontWeight: '700' }}>
          {autoStatus === 'saving' ? <Text style={{ color: T.amber }}>сохраняю…</Text> : autoStatus === 'saved' ? <Text style={{ color: T.greenBright }}>сохранено ✓</Text> : autoStatus === 'error' ? <Text style={{ color: T.red }}>ошибка</Text> : <Text style={{ color: T.textDim }}>автосейв</Text>}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 4, paddingBottom: S.xxl, gap: 8 }} keyboardShouldPersistTaps="handled">
        {items.some((it) => it.otherBy) ? (
          <View style={{ backgroundColor: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)', borderWidth: 1, borderRadius: R.md, padding: 10 }}>
            <Text style={{ color: T.greenBright, fontSize: 11 }}>Зелёным — уже посчитал другой кассир. Не считайте повторно.</Text>
          </View>
        ) : null}

        {itemsLoading ? <ActivityIndicator color={T.green} style={{ marginTop: 30 }} /> : items.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="cube-outline" size={36} color={T.textDim} />
            <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>В вашей секции нет товаров</Text>
          </Card>
        ) : items.map((it) => {
          const mineEmpty = (edits[it.item_id] ?? '') === ''
          return (
            <View key={it.item_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.card, borderWidth: 1, borderColor: it.otherBy && mineEmpty ? 'rgba(16,185,129,0.4)' : T.border, borderRadius: R.md, padding: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: T.text, fontSize: 14 }} numberOfLines={1}>{it.name}</Text>
                {it.barcode ? <Text style={{ color: T.textDim, fontSize: 10 }}>{it.barcode}</Text> : null}
                {it.otherBy ? <Text style={{ color: T.greenBright, fontSize: 10, marginTop: 1 }}>✓ уже посчитал(а) {it.otherBy}: {it.otherQty}</Text> : null}
              </View>
              <TextInput
                value={edits[it.item_id] ?? ''}
                onChangeText={(v) => onCount(it.item_id, v)}
                onBlur={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null } void flush() }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={T.textDim}
                style={{ width: 70, textAlign: 'center', color: T.amber, fontSize: 18, fontWeight: '900', backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingVertical: 8 }}
              />
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}
