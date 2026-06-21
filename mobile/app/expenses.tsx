import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'

type Expense = {
  id: string
  date: string | null
  company_id: string | null
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
  status: string | null
  one_off_payee: string | null
  created_at: string | null
}

type Company = { id: string; name?: string; code?: string | null }
type Category = { id: string; name: string; accounting_group: string | null }

const STATUS: Record<string, { text: string; tone: 'good' | 'warn' | 'bad' | 'mut' }> = {
  approved: { text: 'Одобрен', tone: 'good' },
  pending_approval: { text: 'Ожидает', tone: 'warn' },
  declined: { text: 'Отклонён', tone: 'bad' },
}

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const monthRange = (d: Date) => ({ from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) })
const amountOf = (e: Expense) => Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0)
const fmtDay = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—')

type FormState = {
  company_id: string
  category_id: string
  category_name: string
  item_name: string
  amount_cash: string
  amount_kaspi: string
  comment: string
  one_off_payee: string
  one_off_reason: string
}
const emptyForm: FormState = {
  company_id: '',
  category_id: '',
  category_name: '',
  item_name: '',
  amount_cash: '',
  amount_kaspi: '',
  comment: '',
  one_off_payee: '',
  one_off_reason: '',
}

const num = (v: string) => Number(String(v).replace(',', '.')) || 0

export default function ExpensesScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canCreate = canDo(role, 'expenses.create')
  const canDelete = canDo(role, 'expenses.delete')

  const [cursor, setCursor] = useState(() => new Date())
  const [items, setItems] = useState<Expense[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyName, setCompanyName] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // модалка создания расхода
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [categories, setCategories] = useState<Category[]>([])
  const [catLoading, setCatLoading] = useState(false)
  const [catQuery, setCatQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async (d: Date) => {
    setLoading(true); setError(null)
    const { from, to } = monthRange(d)
    try {
      const [exp, comp] = await Promise.all([
        apiFetch<{ data: Expense[] }>(`/api/admin/expenses?from=${from}&to=${to}&sort=date_desc`),
        apiFetch<{ data: Array<{ id: string; name?: string; code?: string | null }> }>('/api/admin/companies').catch(() => ({ data: [] })),
      ])
      setItems(exp.data || [])
      const list = (comp.data || []).filter((c) => c?.id) as Company[]
      setCompanies(list)
      const map: Record<string, string> = {}
      for (const c of list) map[String(c.id)] = c.name || ''
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
    let total = 0, approved = 0, pending = 0
    for (const e of items) {
      const a = amountOf(e)
      total += a
      if (e.status === 'approved') approved += a
      else if (e.status === 'pending_approval') pending += a
    }
    return { total, approved, pending }
  }, [items])

  const openCreate = useCallback(async () => {
    const preferred = companies.find((c) => String(c.code || '').toLowerCase() === 'arena') || companies[0]
    setForm({ ...emptyForm, company_id: preferred?.id || '' })
    setFormError(null)
    setCatQuery('')
    setModalOpen(true)
    // справочник категорий — без COGS (COGS нельзя добавлять вручную)
    setCatLoading(true)
    try {
      const res = await apiFetch<{ data: Category[] }>('/api/admin/expense-categories')
      setCategories((res.data || []).filter((c) => String(c.accounting_group || '').toLowerCase() !== 'cogs'))
    } catch {
      setCategories([])
    } finally {
      setCatLoading(false)
    }
  }, [companies])

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setForm(emptyForm)
    setFormError(null)
  }

  const filteredCats = useMemo(() => {
    const q = catQuery.trim().toLowerCase()
    const base = q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories
    return base.slice(0, 40)
  }, [categories, catQuery])

  // Создание расхода через мастер-сессию: разовая услуга (one_off, без чека).
  const submit = async () => {
    const cash = num(form.amount_cash)
    const kaspi = num(form.amount_kaspi)
    if (!form.company_id) { setFormError('Выберите точку'); return }
    if (!form.category_id) { setFormError('Выберите категорию'); return }
    if (form.item_name.trim().length < 5) { setFormError('Краткое название — минимум 5 символов'); return }
    if (form.comment.trim().length < 20) { setFormError('Комментарий — минимум 20 символов'); return }
    if (cash + kaspi <= 0) { setFormError('Сумма расхода обязательна'); return }
    if (form.one_off_payee.trim().length < 3) { setFormError('Кому платим — минимум 3 символа'); return }
    if (form.one_off_reason.trim().length < 30) { setFormError('Причина (почему нет чека) — минимум 30 символов'); return }

    setSaving(true)
    setFormError(null)
    try {
      const start = await apiFetch<{ data: { id: string } }>('/api/admin/expenses/wizard', { method: 'POST' })
      const sessionId = start.data.id
      const payload = {
        date: iso(new Date()),
        company_id: form.company_id,
        operator_id: null,
        category_id: form.category_id,
        category_name: form.category_name,
        amount_cash: cash,
        amount_kaspi: kaspi,
        item_name: form.item_name.trim(),
        comment: form.comment.trim(),
        backdated_confirmed: false,
        document_kind: 'one_off' as const,
        document_url: null,
        document_urls: [],
        whitelist_vendor_id: null,
        one_off_payee: form.one_off_payee.trim(),
        one_off_reason: form.one_off_reason.trim(),
      }
      await apiFetch('/api/admin/expenses/wizard', {
        method: 'PATCH',
        body: JSON.stringify({ session_id: sessionId, step: 1, payload }),
      })
      await apiFetch('/api/admin/expenses/wizard', {
        method: 'PATCH',
        body: JSON.stringify({ session_id: sessionId, step: 2, payload }),
      })
      await apiFetch('/api/admin/expenses/wizard/submit', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
      })
      setModalOpen(false)
      setForm(emptyForm)
      await load(cursor)
    } catch (e: any) {
      setFormError(e?.message || 'Не удалось создать расход')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = (e: Expense) => {
    const title = e.one_off_payee || e.category || 'Расход'
    Alert.alert('Удалить расход?', `${title} · ${money(amountOf(e))}`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(e.id)
          try {
            await apiFetch('/api/admin/expenses', {
              method: 'POST',
              body: JSON.stringify({ action: 'deleteExpense', expenseId: e.id }),
            })
            await load(cursor)
          } catch (err: any) {
            Alert.alert('Ошибка', err?.message || 'Не удалось удалить')
          } finally {
            setDeletingId(null)
          }
        },
      },
    ])
  }

  const inputStyle = { backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 } as const

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '800', flex: 1 }}>Расходы</Text>
        {canCreate ? (
          <Pressable
            onPress={() => void openCreate()}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.green, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 7 }}
          >
            <Ionicons name="add" size={16} color="#04130d" />
            <Text style={{ color: '#04130d', fontSize: 13, fontWeight: '900' }}>Добавить</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Переключатель месяца */}
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
        {/* Сводка */}
        <GlowHero glow={T.amber}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО ЗА МЕСЯЦ</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(summary.total)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`одобрено ${money(summary.approved)}`} tone="good" />
            {summary.pending > 0 ? <Pill text={`ожидает ${money(summary.pending)}`} tone="warn" /> : null}
          </View>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>{items.length} записей</Text>
        </GlowHero>

        {error ? <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontSize: 13 }}>{error}</Text></Card> : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : items.length === 0 && !loading ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Ionicons name="receipt-outline" size={36} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14, marginTop: 8 }}>В этом месяце расходов нет</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {items.map((e, i) => {
              const st = e.status ? STATUS[e.status] : null
              const title = e.one_off_payee || e.category || 'Расход'
              const cmp = e.company_id ? companyName[e.company_id] : null
              return (
                <View key={e.id} style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: T.border }}>
                  <View style={{ alignItems: 'center', width: 42 }}>
                    <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }}>{fmtDay(e.date || e.created_at)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{title}</Text>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                      {cmp ? `${cmp}` : ''}{e.comment ? `${cmp ? ' · ' : ''}${e.comment}` : ''}
                    </Text>
                    {st ? <View style={{ marginTop: 6, alignSelf: 'flex-start' }}><Pill text={st.text} tone={st.tone} /></View> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{money(amountOf(e))}</Text>
                    {canDelete ? (
                      deletingId === e.id ? (
                        <ActivityIndicator color={T.red} size="small" />
                      ) : (
                        <Pressable onPress={() => confirmDelete(e)} hitSlop={8} style={{ padding: 2 }}>
                          <Ionicons name="trash-outline" size={17} color={T.red} />
                        </Pressable>
                      )
                    ) : null}
                  </View>
                </View>
              )
            })}
          </Card>
        )}
      </ScrollView>

      {/* Модалка создания расхода (разовая услуга — на одобрение) */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>Новый расход</Text>
              <Pressable onPress={closeModal} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>
            <Text style={{ color: T.textDim, fontSize: 12 }}>
              Разовая услуга без чека. Уйдёт на одобрение владельцу (от владельца — сразу подтверждается).
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
              {/* Точка */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Точка *</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {companies.map((c) => {
                    const active = form.company_id === c.id
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => setForm((f) => ({ ...f, company_id: c.id }))}
                        style={{ borderWidth: 1, borderColor: active ? T.green : T.border, backgroundColor: active ? T.greenSoft : T.bg, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 8 }}
                      >
                        <Text style={{ color: active ? T.green : T.textMut, fontSize: 13, fontWeight: '700' }}>{c.name || c.id}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              {/* Категория */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Категория *</Text>
                <TextInput
                  value={catQuery}
                  onChangeText={setCatQuery}
                  placeholder="Поиск категории (зарплата, хоз, закуп)"
                  placeholderTextColor={T.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={inputStyle}
                />
                {catLoading ? (
                  <ActivityIndicator color={T.green} size="small" style={{ marginVertical: 6 }} />
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {filteredCats.map((c) => {
                      const active = form.category_id === c.id
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => setForm((f) => ({ ...f, category_id: c.id, category_name: c.name }))}
                          style={{ borderWidth: 1, borderColor: active ? T.green : T.border, backgroundColor: active ? T.greenSoft : T.bg, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 7 }}
                        >
                          <Text style={{ color: active ? T.green : T.textMut, fontSize: 12, fontWeight: '700' }}>{c.name}</Text>
                        </Pressable>
                      )
                    })}
                    {!catLoading && filteredCats.length === 0 ? (
                      <Text style={{ color: T.amber, fontSize: 12 }}>Категории не найдены</Text>
                    ) : null}
                  </View>
                )}
              </View>

              {/* Краткое название */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Краткое название * (≥ 5 символов)</Text>
                <TextInput
                  value={form.item_name}
                  onChangeText={(v) => setForm((f) => ({ ...f, item_name: v }))}
                  placeholder="Например: Уборка зала за апрель"
                  placeholderTextColor={T.textDim}
                  style={inputStyle}
                />
              </View>

              {/* Суммы */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Наличные ₸</Text>
                  <TextInput
                    value={form.amount_cash}
                    onChangeText={(v) => setForm((f) => ({ ...f, amount_cash: v }))}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="decimal-pad"
                    style={inputStyle}
                  />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Безнал / карта ₸</Text>
                  <TextInput
                    value={form.amount_kaspi}
                    onChangeText={(v) => setForm((f) => ({ ...f, amount_kaspi: v }))}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="decimal-pad"
                    style={inputStyle}
                  />
                </View>
              </View>

              {/* Комментарий */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Комментарий * (≥ 20 символов)</Text>
                <TextInput
                  value={form.comment}
                  onChangeText={(v) => setForm((f) => ({ ...f, comment: v }))}
                  placeholder="Зачем, для кого, на какую смену"
                  placeholderTextColor={T.textDim}
                  multiline
                  style={{ ...inputStyle, minHeight: 64, textAlignVertical: 'top' }}
                />
              </View>

              {/* Кому платим */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Кому платим * (≥ 3 символа)</Text>
                <TextInput
                  value={form.one_off_payee}
                  onChangeText={(v) => setForm((f) => ({ ...f, one_off_payee: v }))}
                  placeholder="Имя или название"
                  placeholderTextColor={T.textDim}
                  style={inputStyle}
                />
              </View>

              {/* Почему нет чека */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Почему нет чека * (≥ 30 символов)</Text>
                <TextInput
                  value={form.one_off_reason}
                  onChangeText={(v) => setForm((f) => ({ ...f, one_off_reason: v }))}
                  placeholder="Подробно: что, у кого, почему чек не выдали"
                  placeholderTextColor={T.textDim}
                  multiline
                  style={{ ...inputStyle, minHeight: 64, textAlignVertical: 'top' }}
                />
              </View>
            </ScrollView>

            {formError ? <Text style={{ color: T.red, fontSize: 12 }}>{formError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <Pressable onPress={closeModal} disabled={saving} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: T.border, opacity: saving ? 0.6 : 1 }}>
                <Text style={{ color: T.textMut, fontWeight: '700' }}>Отмена</Text>
              </Pressable>
              <Pressable onPress={() => void submit()} disabled={saving} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: T.green, opacity: saving ? 0.6 : 1 }}>
                {saving ? <ActivityIndicator color="#04130d" size="small" /> : <Text style={{ color: '#04130d', fontWeight: '900' }}>Сохранить</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
