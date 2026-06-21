import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, ErrorState, EmptyState, PrimaryButton, GhostButton, SkeletonList } from '@/components/ui'
import { haptic } from '@/lib/haptics'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'

// Возврат по чеку (таблица point_returns). Только просмотр.
type ReturnRow = {
  id: string
  sale_id?: string | null
  company_id?: string | null
  company_name?: string | null
  operator_name?: string | null
  total_amount?: number | null
  cash_amount?: number | null
  kaspi_amount?: number | null
  comment?: string | null
  shift?: string | null
  return_date?: string | null
  returned_at?: string | null
  created_at?: string | null
  items_count?: number | null
}

type Totals = { count?: number | null; amount?: number | null; cash?: number | null; kaspi?: number | null }
type Resp = { items?: ReturnRow[] | null; totals?: Totals | null; from?: string | null; to?: string | null }

// Оформление возврата по чеку. GET /api/pos/return?short_id=… отдаёт чек с returnable_qty,
// POST /api/pos/return { sale_id, items:[{item_id,quantity,unit_price}], reason } проводит возврат.
type SaleLine = {
  id?: string | null
  item_id: string
  quantity?: number | null
  unit_price?: number | null
  total_price?: number | null
  returned_qty?: number | null
  returnable_qty?: number | null
  inventory_items?: { name?: string | null } | null
}
type SaleLookup = {
  id: string
  sale_date?: string | null
  sold_at?: string | null
  total_amount?: number | null
  payment_method?: string | null
  items?: SaleLine[] | null
}

const toNum = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const iso = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const monthRange = (d: Date) => ({
  from: iso(new Date(d.getFullYear(), d.getMonth(), 1)),
  to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
})

const amountOf = (r: ReturnRow) => {
  const total = Number(r.total_amount || 0)
  if (total > 0) return total
  return Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
}

const dateOf = (r: ReturnRow) => r.returned_at || r.return_date || r.created_at || null
const fmtDay = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—'
const shortId = (id: string | null | undefined) => (id ? `#${String(id).slice(-6).toUpperCase()}` : '')

export default function PosReturnsScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canReturn = canDo(role, 'pos.return') || canDo(role, 'pos.manage')
  const [cursor, setCursor] = useState(() => new Date())
  const [data, setData] = useState<Resp | null>(null)
  const [companyName, setCompanyName] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // --- Оформление возврата ---
  const [formOpen, setFormOpen] = useState(false)
  const [lookupValue, setLookupValue] = useState('')
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [sale, setSale] = useState<SaleLookup | null>(null)
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const lineKeyOf = (l: SaleLine, idx: number) => `${l.id || l.item_id}:${idx}`

  const resetForm = useCallback(() => {
    setLookupValue('')
    setLookupError(null)
    setSale(null)
    setQtyByLine({})
    setReason('')
    setSaving(false)
    setLooking(false)
  }, [])

  const openForm = useCallback(() => {
    resetForm()
    setFormOpen(true)
  }, [resetForm])

  const closeForm = useCallback(() => {
    if (saving) return
    setFormOpen(false)
    resetForm()
  }, [saving, resetForm])

  const lookupSale = useCallback(async () => {
    const raw = lookupValue.trim()
    if (!raw) return
    setLooking(true)
    setLookupError(null)
    setSale(null)
    setQtyByLine({})
    try {
      // длинная строка похожа на UUID → ищем по sale_id, иначе по последним символам
      const param = raw.length >= 20 ? `sale_id=${encodeURIComponent(raw)}` : `short_id=${encodeURIComponent(raw.replace(/^#/, ''))}`
      const res = await apiFetch<{ ok?: boolean; data?: SaleLookup }>(`/api/pos/return?${param}`)
      const found = res?.data || null
      if (!found?.id) {
        setLookupError('Чек не найден')
        return
      }
      setSale(found)
      haptic.tap()
    } catch (e: any) {
      setLookupError(e?.message || 'Чек не найден')
      haptic.error()
    } finally {
      setLooking(false)
    }
  }, [lookupValue])

  const returnTotal = useMemo(() => {
    if (!sale?.items) return 0
    let sum = 0
    sale.items.forEach((l, idx) => {
      const q = toNum(qtyByLine[lineKeyOf(l, idx)])
      if (q > 0) sum += q * toNum(l.unit_price)
    })
    return sum
  }, [sale, qtyByLine])

  const submitReturn = useCallback(async () => {
    if (!sale?.id || saving) return
    const items: Array<{ item_id: string; quantity: number; unit_price: number }> = []
    let invalid = false
    ;(sale.items || []).forEach((l, idx) => {
      const q = toNum(qtyByLine[lineKeyOf(l, idx)])
      if (q <= 0) return
      const max = toNum(l.returnable_qty)
      if (q > max + 0.0001) invalid = true
      items.push({ item_id: l.item_id, quantity: q, unit_price: toNum(l.unit_price) })
    })
    if (invalid) {
      haptic.warning()
      Alert.alert('Слишком много', 'Количество к возврату больше доступного по чеку.')
      return
    }
    if (items.length === 0) {
      haptic.warning()
      Alert.alert('Пусто', 'Укажите количество хотя бы по одной позиции.')
      return
    }
    setSaving(true)
    try {
      await apiFetch('/api/pos/return', {
        method: 'POST',
        body: JSON.stringify({ sale_id: sale.id, items, reason: reason.trim() || null }),
      })
      haptic.success()
      setFormOpen(false)
      resetForm()
      void load(cursor)
    } catch (e: any) {
      haptic.error()
      Alert.alert('Ошибка возврата', e?.message || 'Не удалось оформить возврат')
    } finally {
      setSaving(false)
    }
  }, [sale, qtyByLine, reason, saving, resetForm, cursor])

  const load = useCallback(async (d: Date) => {
    setLoading(true)
    setError(null)
    const { from, to } = monthRange(d)
    try {
      const [res, comp] = await Promise.all([
        apiFetch<{ data: Resp }>(`/api/admin/pos-returns?from=${from}&to=${to}`),
        apiFetch<{ data: Array<{ id: string; name?: string }> }>('/api/admin/companies').catch(() => ({ data: [] })),
      ])
      setData(res?.data || {})
      const map: Record<string, string> = {}
      for (const c of comp?.data || []) if (c?.id) map[String(c.id)] = c.name || ''
      setCompanyName(map)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(cursor)
  }, [cursor, load])

  const shiftMonth = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  const isCurrentMonth = useMemo(() => {
    const now = new Date()
    return cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()
  }, [cursor])

  const items = useMemo(() => (data?.items || []).slice(), [data])

  const summary = useMemo(() => {
    const t = data?.totals
    if (t && (t.amount != null || t.count != null)) {
      return { amount: Number(t.amount || 0), count: Number(t.count || items.length) }
    }
    let amount = 0
    for (const r of items) amount += amountOf(r)
    return { amount, count: items.length }
  }, [data, items])

  // группировка по компании
  const byCompany = useMemo(() => {
    const m = new Map<string, { name: string; items: ReturnRow[]; amount: number }>()
    for (const r of items) {
      const cid = String(r.company_id || '')
      const name = r.company_name || (cid ? companyName[cid] : '') || 'Без точки'
      const key = name
      const e = m.get(key) || { name, items: [], amount: 0 }
      e.items.push(r)
      e.amount += amountOf(r)
      m.set(key, e)
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount)
  }, [items, companyName])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>POS-возвраты</Text>
      </View>

      {/* Переключатель месяца */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={20} color={T.textMut} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>
          {cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable onPress={() => !isCurrentMonth && shiftMonth(1)} hitSlop={10} disabled={isCurrentMonth} style={{ padding: 6, opacity: isCurrentMonth ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => load(cursor)} tintColor={T.green} />}
      >
        {/* Сводка */}
        <GlowHero glow={T.red}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВОЗВРАТОВ ЗА МЕСЯЦ</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.amount)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`${summary.count} возвратов`} tone="bad" />
            {byCompany.length > 0 ? <Pill text={`${byCompany.length} точек`} tone="mut" /> : null}
          </View>
        </GlowHero>

        {error ? (
          <ErrorState message={error} onRetry={() => load(cursor)} />
        ) : null}

        {loading && !data ? (
          <SkeletonList rows={6} />
        ) : !loading && items.length === 0 && !error ? (
          <EmptyState icon="checkmark-done-circle-outline" title="Возвратов в этом месяце нет" />
        ) : (
          byCompany.map((g) => (
            <View key={g.name} style={{ gap: S.sm }}>
              <SectionTitle hint={moneyShort(g.amount)}>{g.name}</SectionTitle>
              <Card style={{ padding: 0 }}>
                {g.items.map((r, i, arr) => {
                  const op = r.operator_name?.trim() || null
                  const cnt = r.items_count != null ? Number(r.items_count) : null
                  const sub = [
                    op,
                    cnt != null && cnt > 0 ? `${cnt} поз.` : null,
                    r.comment?.trim() || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <View
                      key={r.id}
                      style={{
                        padding: 14,
                        borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                        borderBottomColor: T.borderSoft,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 42, alignItems: 'center' }}>
                          <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>{fmtDay(dateOf(r))}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
                            {shortId(r.sale_id || r.id) || 'Возврат'}
                          </Text>
                          {sub ? (
                            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                              {sub}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={{ color: T.red, fontSize: 15, fontWeight: '800' }}>−{money(amountOf(r))}</Text>
                      </View>
                    </View>
                  )
                })}
              </Card>
            </View>
          ))
        )}

        {!loading && items.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Показано {items.length} возвратов
          </Text>
        ) : null}
      </ScrollView>

      {/* Кнопка оформления возврата (по праву pos.return / pos.manage) */}
      {canReturn ? (
        <Pressable
          onPress={() => {
            haptic.light()
            openForm()
          }}
          style={{
            position: 'absolute',
            right: S.lg,
            bottom: S.xl,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: T.red,
            paddingHorizontal: 18,
            paddingVertical: 14,
            borderRadius: R.pill,
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}
        >
          <Ionicons name="return-down-back" size={20} color="#0b0e12" />
          <Text style={{ color: '#0b0e12', fontWeight: '900', fontSize: 15 }}>Оформить возврат</Text>
        </Pressable>
      ) : null}

      <ReturnForm
        visible={formOpen}
        onClose={closeForm}
        lookupValue={lookupValue}
        setLookupValue={setLookupValue}
        looking={looking}
        lookupError={lookupError}
        onLookup={lookupSale}
        sale={sale}
        qtyByLine={qtyByLine}
        setQtyByLine={setQtyByLine}
        lineKeyOf={lineKeyOf}
        reason={reason}
        setReason={setReason}
        returnTotal={returnTotal}
        saving={saving}
        onSubmit={submitReturn}
      />
    </SafeAreaView>
  )
}

function ReturnForm(props: {
  visible: boolean
  onClose: () => void
  lookupValue: string
  setLookupValue: (v: string) => void
  looking: boolean
  lookupError: string | null
  onLookup: () => void
  sale: SaleLookup | null
  qtyByLine: Record<string, string>
  setQtyByLine: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  lineKeyOf: (l: SaleLine, idx: number) => string
  reason: string
  setReason: (v: string) => void
  returnTotal: number
  saving: boolean
  onSubmit: () => void
}) {
  const {
    visible, onClose, lookupValue, setLookupValue, looking, lookupError, onLookup,
    sale, qtyByLine, setQtyByLine, lineKeyOf, reason, setReason, returnTotal, saving, onSubmit,
  } = props

  const inputStyle = {
    backgroundColor: T.bg,
    borderWidth: 1,
    borderColor: T.borderSoft,
    borderRadius: R.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: T.text,
    fontSize: 15,
  } as const

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View
          style={{
            backgroundColor: T.card,
            borderTopLeftRadius: R.xl,
            borderTopRightRadius: R.xl,
            paddingHorizontal: S.lg,
            paddingTop: S.md,
            paddingBottom: S.xxl,
            maxHeight: '88%',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: S.md }}>
            <Text style={{ color: T.text, fontSize: 19, fontWeight: '900', flex: 1 }}>Оформить возврат</Text>
            <Pressable onPress={onClose} hitSlop={10} disabled={saving} style={{ opacity: saving ? 0.4 : 1 }}>
              <Ionicons name="close" size={24} color={T.textMut} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S.md }}>
            {/* Поиск чека */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700' }}>Номер чека</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={lookupValue}
                  onChangeText={setLookupValue}
                  placeholder="последние 6 символов или ID"
                  placeholderTextColor={T.textDim}
                  autoCapitalize="characters"
                  editable={!saving}
                  onSubmitEditing={onLookup}
                  returnKeyType="search"
                  style={[inputStyle, { flex: 1 }]}
                />
                <Pressable
                  onPress={onLookup}
                  disabled={looking || !lookupValue.trim() || saving}
                  style={{
                    paddingHorizontal: 16,
                    justifyContent: 'center',
                    borderRadius: R.md,
                    backgroundColor: T.green,
                    opacity: looking || !lookupValue.trim() || saving ? 0.5 : 1,
                  }}
                >
                  {looking ? (
                    <ActivityIndicator color="#0b0e12" />
                  ) : (
                    <Ionicons name="search" size={18} color="#0b0e12" />
                  )}
                </Pressable>
              </View>
              {lookupError ? (
                <Text style={{ color: T.red, fontSize: 12.5, fontWeight: '700' }}>{lookupError}</Text>
              ) : null}
            </View>

            {/* Позиции чека */}
            {sale ? (
              <View style={{ gap: S.sm }}>
                <SectionTitle hint={shortId(sale.id)}>Позиции чека</SectionTitle>
                <Card style={{ padding: 0 }}>
                  {(sale.items || []).map((l, idx, arr) => {
                    const key = lineKeyOf(l, idx)
                    const name = l.inventory_items?.name?.trim() || l.item_id
                    const max = toNum(l.returnable_qty)
                    const disabled = max <= 0
                    return (
                      <View
                        key={key}
                        style={{
                          padding: 12,
                          borderBottomWidth: idx < arr.length - 1 ? 1 : 0,
                          borderBottomColor: T.borderSoft,
                          opacity: disabled ? 0.45 : 1,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>
                              {name}
                            </Text>
                            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }}>
                              {money(toNum(l.unit_price))} · можно вернуть {max}
                            </Text>
                          </View>
                          <TextInput
                            value={qtyByLine[key] ?? ''}
                            onChangeText={(v) =>
                              setQtyByLine((prev) => ({ ...prev, [key]: v.replace(/[^0-9.,]/g, '') }))
                            }
                            editable={!disabled && !saving}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={T.textDim}
                            style={[inputStyle, { width: 64, textAlign: 'center' }]}
                          />
                        </View>
                      </View>
                    )
                  })}
                </Card>

                {/* Причина */}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700' }}>Причина (необязательно)</Text>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="брак, ошибка кассира…"
                    placeholderTextColor={T.textDim}
                    editable={!saving}
                    multiline
                    style={[inputStyle, { minHeight: 44, textAlignVertical: 'top' }]}
                  />
                </View>

                {/* Итог */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                  <Text style={{ color: T.textMut, fontSize: 14, fontWeight: '700' }}>К возврату</Text>
                  <Text style={{ color: T.red, fontSize: 20, fontWeight: '900' }}>−{money(returnTotal)}</Text>
                </View>
              </View>
            ) : null}

            {/* Кнопки */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: S.sm }}>
              <GhostButton label="Отмена" onPress={onClose} disabled={saving} style={{ flex: 1 }} />
              <PrimaryButton
                label="Оформить возврат"
                tone="red"
                loading={saving}
                disabled={saving || !sale || returnTotal <= 0}
                onPress={() => void onSubmit()}
                style={{ flex: 1.4 }}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
