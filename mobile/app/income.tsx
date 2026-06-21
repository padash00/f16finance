import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, S, R, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'

type Income = {
  id: string
  date: string | null
  company_id: string | null
  operator_id: string | null
  shift: string | null
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  kaspi_before_midnight: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
}

type Company = { id: string; name?: string }
type Operator = { id: string; name?: string; short_name?: string | null }

type Shift = 'day' | 'night'

type FormState = {
  date: string
  companyId: string
  operatorId: string
  shift: Shift
  zone: string
  cash: string
  kaspi: string
  card: string
  online: string
  comment: string
}

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const monthRange = (d: Date) => ({ from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) })
const amountOf = (e: Income) => Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0) + Number(e.online_amount || 0) + Number(e.card_amount || 0)
const fmtDay = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—')
const shiftLabel = (s: string | null) => (s === 'day' ? 'День' : s === 'night' ? 'Ночь' : s || '')
const num = (v: string) => {
  const n = Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}
const emptyForm = (): FormState => ({
  date: iso(new Date()),
  companyId: '',
  operatorId: '',
  shift: 'day',
  zone: '',
  cash: '',
  kaspi: '',
  card: '',
  online: '',
  comment: '',
})

export default function IncomeScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canCreate = canDo(role, 'income.create')
  const canEdit = canDo(role, 'income.edit')

  const [cursor, setCursor] = useState(() => new Date())
  const [items, setItems] = useState<Income[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [companyName, setCompanyName] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // модалка добавления / редактирования дохода
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  // сохраняем «касса до полуночи» при редактировании, чтобы апдейт не обнулил поле
  const [editKaspiBeforeMidnight, setEditKaspiBeforeMidnight] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async (d: Date) => {
    setLoading(true); setError(null)
    const { from, to } = monthRange(d)
    try {
      const [inc, comp, ops] = await Promise.all([
        apiFetch<{ data: Income[] }>(`/api/admin/incomes?from=${from}&to=${to}`),
        apiFetch<{ data: Company[] }>('/api/admin/companies').catch(() => ({ data: [] })),
        apiFetch<{ data: Operator[] }>('/api/admin/operators?active_only=true').catch(() => ({ data: [] })),
      ])
      const rows = (inc.data || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      setItems(rows)
      const comps = comp.data || []
      setCompanies(comps)
      setOperators(ops.data || [])
      const map: Record<string, string> = {}
      for (const c of comps) if (c?.id) map[String(c.id)] = c.name || ''
      setCompanyName(map)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(cursor) }, [cursor, load])

  const shiftMonth = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  const isCurrentMonth = useMemo(() => {
    const now = new Date()
    return cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()
  }, [cursor])

  const summary = useMemo(() => {
    let total = 0, cash = 0, kaspi = 0, other = 0
    for (const e of items) {
      total += amountOf(e)
      cash += Number(e.cash_amount || 0)
      kaspi += Number(e.kaspi_amount || 0)
      other += Number(e.online_amount || 0) + Number(e.card_amount || 0)
    }
    return { total, cash, kaspi, other }
  }, [items])

  const openCreate = () => {
    const f = emptyForm()
    if (companies.length === 1 && companies[0]?.id) f.companyId = String(companies[0].id)
    setEditId(null)
    setEditKaspiBeforeMidnight(null)
    setForm(f)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (e: Income) => {
    setEditId(e.id)
    setEditKaspiBeforeMidnight(e.kaspi_before_midnight ?? null)
    setForm({
      date: e.date || iso(new Date()),
      companyId: e.company_id ? String(e.company_id) : '',
      operatorId: e.operator_id ? String(e.operator_id) : '',
      shift: (e.shift === 'night' ? 'night' : 'day') as Shift,
      zone: e.zone || '',
      cash: e.cash_amount != null ? String(e.cash_amount) : '',
      kaspi: e.kaspi_amount != null ? String(e.kaspi_amount) : '',
      card: e.card_amount != null ? String(e.card_amount) : '',
      online: e.online_amount != null ? String(e.online_amount) : '',
      comment: e.comment || '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditId(null)
    setEditKaspiBeforeMidnight(null)
    setFormError(null)
  }

  const formTotal = useMemo(
    () => num(form.cash) + num(form.kaspi) + num(form.card) + num(form.online),
    [form.cash, form.kaspi, form.card, form.online],
  )

  const submit = async () => {
    if (!form.date.trim()) { setFormError('Дата обязательна'); return }
    if (!form.companyId) { setFormError('Выберите компанию'); return }
    if (!form.operatorId) { setFormError('Выберите оператора'); return }
    if (formTotal <= 0) { setFormError('Введите хотя бы одну сумму'); return }
    setSaving(true)
    setFormError(null)
    try {
      if (editId) {
        // Эндпоинт updateIncome правит только эти поля; company/shift/zone неизменны
        await apiFetch('/api/admin/incomes', {
          method: 'POST',
          body: JSON.stringify({
            action: 'updateIncome',
            incomeId: editId,
            payload: {
              date: form.date.trim(),
              operator_id: form.operatorId,
              cash_amount: num(form.cash),
              kaspi_amount: num(form.kaspi),
              kaspi_before_midnight: editKaspiBeforeMidnight,
              online_amount: num(form.online),
              card_amount: num(form.card),
              comment: form.comment.trim() || null,
            },
          }),
        })
      } else {
        await apiFetch('/api/admin/incomes', {
          method: 'POST',
          body: JSON.stringify({
            action: 'createIncome',
            payload: {
              date: form.date.trim(),
              company_id: form.companyId,
              operator_id: form.operatorId,
              shift: form.shift,
              zone: form.zone.trim() || null,
              cash_amount: num(form.cash),
              kaspi_amount: num(form.kaspi),
              online_amount: num(form.online),
              card_amount: num(form.card),
              comment: form.comment.trim() || null,
            },
          }),
        })
      }
      setModalOpen(false)
      setEditId(null)
      setEditKaspiBeforeMidnight(null)
      await load(cursor)
    } catch (e: any) {
      const msg = e?.message === 'duplicate' ? 'Такой доход уже есть за эту дату и смену' : (e?.message || 'Не удалось сохранить')
      setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '800', flex: 1 }}>Доходы</Text>
        {canCreate ? (
          <Pressable
            onPress={openCreate}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.green, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 7 }}
          >
            <Ionicons name="add" size={16} color="#04130d" />
            <Text style={{ color: '#04130d', fontSize: 13, fontWeight: '900' }}>Добавить</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 6 }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={{ padding: 6 }}><Ionicons name="chevron-back" size={20} color={T.textMut} /></Pressable>
        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>
          {cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable onPress={() => !isCurrentMonth && shiftMonth(1)} hitSlop={10} style={{ padding: 6, opacity: isCurrentMonth ? 0.3 : 1 }} disabled={isCurrentMonth}>
          <Ionicons name="chevron-forward" size={20} color={T.textMut} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 18, paddingTop: 6, paddingBottom: 28, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load(cursor)} tintColor={T.green} />}
      >
        <GlowHero glow={T.green}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ДОХОД ЗА МЕСЯЦ</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.total)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`нал ${moneyShort(summary.cash)}`} tone="mut" />
            <Pill text={`Kaspi ${moneyShort(summary.kaspi)}`} tone="brand" />
            {summary.other > 0 ? <Pill text={`карта/онлайн ${moneyShort(summary.other)}`} tone="mut" /> : null}
          </View>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>{items.length} записей</Text>
        </GlowHero>

        {error ? <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontSize: 13 }}>{error}</Text></Card> : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : items.length === 0 && !loading ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Ionicons name="cash-outline" size={36} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14, marginTop: 8 }}>В этом месяце доходов нет</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {items.map((e, i) => {
              const cmp = e.company_id ? companyName[e.company_id] : null
              const meta = [cmp, shiftLabel(e.shift), e.zone].filter(Boolean).join(' · ')
              return (
                <Pressable
                  key={e.id}
                  onPress={canEdit ? () => openEdit(e) : undefined}
                  disabled={!canEdit}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: T.border }}
                >
                  <View style={{ alignItems: 'center', width: 42 }}>
                    <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>{fmtDay(e.date)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{meta || 'Смена'}</Text>
                    {e.comment ? <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{e.comment}</Text> : null}
                  </View>
                  <Text style={{ color: T.green, fontSize: 15, fontWeight: '800' }}>{money(amountOf(e))}</Text>
                  {canEdit ? <Ionicons name="create-outline" size={16} color={T.textDim} /> : null}
                </Pressable>
              )
            })}
          </Card>
        )}
      </ScrollView>

      {/* Модалка добавления дохода */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>{editId ? 'Изменить доход' : 'Новый доход'}</Text>
              <Pressable onPress={closeModal} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 12 }}>
              {/* Дата */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Дата *</Text>
                <TextInput
                  value={form.date}
                  onChangeText={(v) => setForm((f) => ({ ...f, date: v }))}
                  placeholder="ГГГГ-ММ-ДД"
                  placeholderTextColor={T.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              {/* Компания */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Компания *{editId ? ' (нельзя изменить)' : ''}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: editId ? 0.55 : 1 }}>
                  {companies.length === 0 ? (
                    <Text style={{ color: T.textDim, fontSize: 13 }}>Нет доступных компаний</Text>
                  ) : companies.map((c) => {
                    const active = form.companyId === String(c.id)
                    return (
                      <Pressable
                        key={c.id}
                        disabled={!!editId}
                        onPress={() => setForm((f) => ({ ...f, companyId: String(c.id) }))}
                        style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: R.md, borderWidth: 1, borderColor: active ? T.green : T.border, backgroundColor: active ? 'rgba(16,185,129,0.14)' : T.bg }}
                      >
                        <Text style={{ color: active ? T.green : T.textMut, fontSize: 13, fontWeight: '700' }}>{c.name || 'Компания'}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              {/* Оператор */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Оператор *</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {operators.length === 0 ? (
                    <Text style={{ color: T.textDim, fontSize: 13 }}>Нет операторов</Text>
                  ) : operators.map((o) => {
                    const active = form.operatorId === String(o.id)
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => setForm((f) => ({ ...f, operatorId: String(o.id) }))}
                        style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: R.md, borderWidth: 1, borderColor: active ? T.green : T.border, backgroundColor: active ? 'rgba(16,185,129,0.14)' : T.bg }}
                      >
                        <Text style={{ color: active ? T.green : T.textMut, fontSize: 13, fontWeight: '700' }}>{o.short_name || o.name || 'Оператор'}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              {/* Смена */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Смена *{editId ? ' (нельзя изменить)' : ''}</Text>
                <View style={{ flexDirection: 'row', gap: 8, opacity: editId ? 0.55 : 1 }}>
                  {(['day', 'night'] as Shift[]).map((sh) => {
                    const active = form.shift === sh
                    return (
                      <Pressable
                        key={sh}
                        disabled={!!editId}
                        onPress={() => setForm((f) => ({ ...f, shift: sh }))}
                        style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: R.md, borderWidth: 1, borderColor: active ? T.green : T.border, backgroundColor: active ? 'rgba(16,185,129,0.14)' : T.bg }}
                      >
                        <Text style={{ color: active ? T.green : T.textMut, fontSize: 14, fontWeight: '800' }}>{sh === 'day' ? 'День' : 'Ночь'}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              {/* Зона */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Зона{editId ? ' (нельзя изменить)' : ''}</Text>
                <TextInput
                  value={form.zone}
                  editable={!editId}
                  onChangeText={(v) => setForm((f) => ({ ...f, zone: v }))}
                  placeholder="Необязательно"
                  placeholderTextColor={T.textDim}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: editId ? T.textMut : T.text, fontSize: 15, opacity: editId ? 0.6 : 1 }}
                />
              </View>

              {/* Суммы */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Наличные</Text>
                  <TextInput
                    value={form.cash}
                    onChangeText={(v) => setForm((f) => ({ ...f, cash: v }))}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="numeric"
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                  />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Kaspi</Text>
                  <TextInput
                    value={form.kaspi}
                    onChangeText={(v) => setForm((f) => ({ ...f, kaspi: v }))}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="numeric"
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Карта</Text>
                  <TextInput
                    value={form.card}
                    onChangeText={(v) => setForm((f) => ({ ...f, card: v }))}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="numeric"
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                  />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Онлайн</Text>
                  <TextInput
                    value={form.online}
                    onChangeText={(v) => setForm((f) => ({ ...f, online: v }))}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="numeric"
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                  />
                </View>
              </View>

              {/* Комментарий */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Комментарий</Text>
                <TextInput
                  value={form.comment}
                  onChangeText={(v) => setForm((f) => ({ ...f, comment: v }))}
                  placeholder="Дополнительно"
                  placeholderTextColor={T.textDim}
                  multiline
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15, minHeight: 64, textAlignVertical: 'top' }}
                />
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 2 }}>
                <Text style={{ color: T.textDim, fontSize: 13, fontWeight: '700' }}>Итого</Text>
                <Text style={{ color: T.green, fontSize: 17, fontWeight: '900' }}>{money(formTotal)}</Text>
              </View>
            </ScrollView>

            {formError ? <Text style={{ color: T.red, fontSize: 12 }}>{formError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <Pressable onPress={closeModal} disabled={saving} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: T.border, opacity: saving ? 0.6 : 1 }}>
                <Text style={{ color: T.textMut, fontWeight: '700' }}>Отмена</Text>
              </Pressable>
              <Pressable onPress={() => void submit()} disabled={saving} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: T.green, opacity: saving ? 0.6 : 1 }}>
                {saving ? <ActivityIndicator color="#04130d" size="small" /> : <Text style={{ color: '#04130d', fontWeight: '900' }}>{editId ? 'Изменить' : 'Добавить'}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
