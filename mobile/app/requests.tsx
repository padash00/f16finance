import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, S, R } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, ErrorState, EmptyState, PrimaryButton, SkeletonList } from '@/components/ui'

type Staff = { id?: string; full_name?: string | null; role?: string | null } | null
type Location = { id?: string; name?: string | null; code?: string | null; company?: { id?: string; name?: string | null } | null } | null
type ReqItem = {
  id?: string
  requested_qty?: number | null
  approved_qty?: number | null
  available_qty?: number | null
  enough_for_requested?: boolean
  comment?: string | null
  item?: { id?: string; name?: string | null; barcode?: string | null } | null
}
type Req = {
  id: string
  status?: string | null
  comment?: string | null
  created_at?: string | null
  approved_at?: string | null
  issued_at?: string | null
  received_at?: string | null
  created_by_staff?: Staff
  company?: { id?: string; name?: string | null } | null
  source_location?: Location
  target_location?: Location
  items?: ReqItem[]
}
type Resp = { ok?: boolean; data?: { requests?: Req[] } }

const firstOrSelf = <X,>(v: X | X[] | null | undefined): X | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

const STATUS: Record<string, { text: string; tone: 'good' | 'bad' | 'warn' | 'mut' }> = {
  new: { text: 'Новая', tone: 'warn' },
  approved_full: { text: 'Одобрена полностью', tone: 'good' },
  approved_partial: { text: 'Одобрена частично', tone: 'warn' },
  issued: { text: 'Выдана', tone: 'warn' },
  received: { text: 'Получена', tone: 'good' },
  rejected: { text: 'Отклонена', tone: 'bad' },
  disputed: { text: 'Спор', tone: 'bad' },
}

const fmtQty = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))
const fmtDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

const reqQty = (r: Req) => (r.items || []).reduce((sum, it) => sum + Number(it?.requested_qty || 0), 0)
const pointName = (r: Req) =>
  r.company?.name || r.target_location?.company?.name || r.target_location?.name || 'Точка'

export default function RequestsScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canDecide = canDo(role, 'store.manage')
  const [items, setItems] = useState<Req[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // модалка решения по заявке (одобрить/отклонить)
  const [decideReq, setDecideReq] = useState<Req | null>(null)
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({})
  const [decisionComment, setDecisionComment] = useState('')
  const [savingDecision, setSavingDecision] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<Resp>('/api/admin/inventory/requests')
      const raw = res?.data?.requests || []
      const normalized: Req[] = raw.map((r: any) => ({
        id: String(r?.id || ''),
        status: r?.status || 'new',
        comment: r?.comment || null,
        created_at: r?.created_at || null,
        approved_at: r?.approved_at || null,
        issued_at: r?.issued_at || null,
        received_at: r?.received_at || null,
        created_by_staff: firstOrSelf(r?.created_by_staff),
        company: firstOrSelf(r?.company),
        source_location: firstOrSelf(r?.source_location),
        target_location: firstOrSelf(r?.target_location),
        items: Array.isArray(r?.items)
          ? r.items.map((it: any) => ({
              id: String(it?.id || ''),
              requested_qty: Number(it?.requested_qty || 0),
              approved_qty: it?.approved_qty == null ? null : Number(it.approved_qty || 0),
              available_qty: it?.available_qty == null ? null : Number(it.available_qty || 0),
              enough_for_requested: typeof it?.enough_for_requested === 'boolean' ? it.enough_for_requested : undefined,
              comment: it?.comment || null,
              item: firstOrSelf(it?.item),
            }))
          : [],
      })).filter((r: Req) => r.id)
      setItems(normalized)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openDecide = (r: Req) => {
    const draft: Record<string, string> = {}
    for (const it of r.items || []) {
      if (it.id) draft[it.id] = fmtQty(Number(it.requested_qty || 0))
    }
    setQtyDraft(draft)
    setDecisionComment('')
    setDecisionError(null)
    setDecideReq(r)
  }

  const closeDecide = () => {
    if (savingDecision) return
    setDecideReq(null)
    setQtyDraft({})
    setDecisionComment('')
    setDecisionError(null)
  }

  const submitDecision = async (approved: boolean) => {
    if (!decideReq) return
    setSavingDecision(true)
    setDecisionError(null)
    try {
      const items = approved
        ? (decideReq.items || [])
            .filter((it) => it.id)
            .map((it) => ({
              request_item_id: String(it.id),
              approved_qty: Number(String(qtyDraft[String(it.id)] ?? it.requested_qty ?? 0).replace(',', '.')) || 0,
            }))
        : []
      await apiFetch('/api/admin/inventory/requests', {
        method: 'POST',
        body: JSON.stringify({
          action: 'decideRequest',
          requestId: decideReq.id,
          approved,
          decision_comment: decisionComment.trim() || null,
          items,
        }),
      })
      haptic.success()
      closeDecide()
      setDecideReq(null)
      setQtyDraft({})
      setDecisionComment('')
      await load()
    } catch (e: any) {
      haptic.error()
      setDecisionError(e?.message || 'Не удалось обработать заявку')
    } finally {
      setSavingDecision(false)
    }
  }

  const groups = useMemo(() => {
    const pending = items.filter((r) => r.status === 'new' || r.status === 'disputed')
    const toIssue = items.filter((r) => r.status === 'approved_full' || r.status === 'approved_partial')
    const issued = items.filter((r) => r.status === 'issued')
    const history = items.filter((r) => r.status === 'received' || r.status === 'rejected')
    return { pending, toIssue, issued, history }
  }, [items])

  const renderRow = (r: Req, i: number, arr: Req[]) => {
    const st = r.status ? STATUS[r.status] : null
    const itemsCount = (r.items || []).length
    return (
      <View
        key={r.id}
        style={{ paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '800', flex: 1 }} numberOfLines={1}>{pointName(r)}</Text>
          {st ? <Pill text={st.text} tone={st.tone} /> : null}
        </View>
        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
          {(r.source_location?.name || 'Склад')} → {(r.target_location?.name || 'Витрина')} · {itemsCount} поз. · {fmtQty(reqQty(r))} ед.
        </Text>
        <Text style={{ color: T.textDim, fontSize: 11, marginTop: 3 }} numberOfLines={1}>
          {fmtDateTime(r.created_at)}{r.created_by_staff?.full_name ? ` · ${r.created_by_staff.full_name}` : ''}
        </Text>
        {(r.items || []).length > 0 ? (
          <View style={{ marginTop: 6, gap: 2 }}>
            {(r.items || []).slice(0, 4).map((it) => (
              <View key={it.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: T.textMut, fontSize: 12, flex: 1 }} numberOfLines={1}>{it.item?.name || 'Товар'}</Text>
                <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700' }}>
                  {fmtQty(Number(it.requested_qty || 0))}
                  {it.approved_qty != null ? ` → ${fmtQty(Number(it.approved_qty || 0))}` : ''}
                </Text>
              </View>
            ))}
            {(r.items || []).length > 4 ? (
              <Text style={{ color: T.textDim, fontSize: 11 }}>+ ещё {(r.items || []).length - 4}</Text>
            ) : null}
          </View>
        ) : null}
        {r.comment ? <Text style={{ color: T.textDim, fontSize: 12, marginTop: 5 }} numberOfLines={2}>{r.comment}</Text> : null}
        {canDecide && (r.status === 'new' || r.status === 'disputed') ? (
          <Pressable
            onPress={() => openDecide(r)}
            hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, backgroundColor: T.green, borderRadius: R.md, paddingVertical: 10 }}
          >
            <Ionicons name="checkmark-circle" size={16} color="#04130d" />
            <Text style={{ color: '#04130d', fontSize: 13, fontWeight: '900' }}>Решить</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  const section = (title: string, hint: string, list: Req[]) =>
    list.length === 0 ? null : (
      <View key={title} style={{ gap: S.sm }}>
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <Card style={{ gap: 0, paddingVertical: 4 }}>{list.map(renderRow)}</Card>
      </View>
    )

  const anyItems = items.length > 0

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Заявки склада</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && anyItems} onRefresh={() => load()} tintColor={T.green} />}
      >
        {loading && !anyItems ? (
          <SkeletonList rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => load()} />
        ) : !anyItems ? (
          <EmptyState icon="swap-horizontal" title="Заявок пока нет" />
        ) : (
          <>
            <GlowHero glow={groups.pending.length > 0 ? T.amber : T.green}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>НОВЫХ ЗАЯВОК</Text>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{groups.pending.length}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                {groups.toIssue.length > 0 ? <Pill text={`ждёт выдачи ${groups.toIssue.length}`} tone="warn" /> : null}
                {groups.issued.length > 0 ? <Pill text={`в пути ${groups.issued.length}`} tone="mut" /> : null}
              </View>
              <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>{items.length} заявок всего</Text>
            </GlowHero>

            {section('Очередь на решение', String(groups.pending.length), groups.pending)}
            {section('Ждёт выдачи со склада', String(groups.toIssue.length), groups.toIssue)}
            {section('Выдано — в пути', String(groups.issued.length), groups.issued)}
            {section('История', String(groups.history.length), groups.history)}
          </>
        )}
      </ScrollView>

      {/* Модалка решения по заявке */}
      <Modal visible={!!decideReq} transparent animationType="slide" onRequestClose={closeDecide}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>Решение по заявке</Text>
              <Pressable onPress={closeDecide} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            {decideReq ? (
              <Text style={{ color: T.textDim, fontSize: 12 }} numberOfLines={1}>
                {pointName(decideReq)} · {(decideReq.source_location?.name || 'Склад')} → {(decideReq.target_location?.name || 'Витрина')}
              </Text>
            ) : null}

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 10 }}>
              {(decideReq?.items || []).map((it) => {
                const id = String(it.id || '')
                const avail = it.available_qty
                const enough = it.enough_for_requested
                return (
                  <View key={id} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={{ color: T.text, fontSize: 13.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>{it.item?.name || 'Товар'}</Text>
                      <Text style={{ color: T.textDim, fontSize: 12 }}>запрос {fmtQty(Number(it.requested_qty || 0))}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        value={qtyDraft[id] ?? ''}
                        onChangeText={(v) => setQtyDraft((d) => ({ ...d, [id]: v }))}
                        placeholder="Кол-во к одобрению"
                        placeholderTextColor={T.textDim}
                        keyboardType="decimal-pad"
                        style={{ flex: 1, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 12, color: T.text, fontSize: 15 }}
                      />
                      {avail != null ? (
                        <Pill text={`на складе ${fmtQty(Number(avail))}`} tone={enough === false ? 'bad' : 'mut'} />
                      ) : null}
                    </View>
                  </View>
                )
              })}

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Комментарий</Text>
                <TextInput
                  value={decisionComment}
                  onChangeText={setDecisionComment}
                  placeholder="Необязательно"
                  placeholderTextColor={T.textDim}
                  multiline
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 12, color: T.text, fontSize: 15, minHeight: 60, textAlignVertical: 'top' }}
                />
              </View>
            </ScrollView>

            {decisionError ? <Text style={{ color: T.red, fontSize: 12 }}>{decisionError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <Pressable
                onPress={() => void submitDecision(false)}
                disabled={savingDecision}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: '#3b1212', backgroundColor: 'rgba(120,20,20,0.18)', opacity: savingDecision ? 0.6 : 1 }}
              >
                {savingDecision ? <ActivityIndicator color={T.red} size="small" /> : <Text style={{ color: T.red, fontWeight: '800' }}>Отклонить</Text>}
              </Pressable>
              <PrimaryButton label="Одобрить" loading={savingDecision} disabled={savingDecision} onPress={() => void submitDecision(true)} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
