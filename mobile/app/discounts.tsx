import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented, ErrorState, EmptyState, PrimaryButton, GhostButton, SkeletonList } from '@/components/ui'

type DiscountType = 'percent' | 'fixed' | 'promo_code'

type Discount = {
  id: string
  company_id: string | null
  name: string
  type: DiscountType
  value: number
  promo_code: string | null
  min_order_amount: number
  is_active: boolean
  valid_from: string | null
  valid_to: string | null
  usage_limit: number | null
  usage_count: number
  created_at: string
}

type Filter = 'all' | 'active' | 'promo'

type FormState = {
  name: string
  type: DiscountType
  value: string
  promo_code: string
  min_order_amount: string
  valid_from: string
  valid_to: string
  usage_limit: string
}
const emptyForm: FormState = {
  name: '',
  type: 'percent',
  value: '',
  promo_code: '',
  min_order_amount: '',
  valid_from: '',
  valid_to: '',
  usage_limit: '',
}

const num = (v: string) => Number(String(v).replace(',', '.'))

const typeLabel = (t: DiscountType) =>
  t === 'percent' ? 'Скидка %' : t === 'fixed' ? 'Фиксированная' : 'Промокод'

const valueDisplay = (d: Discount) =>
  d.type === 'fixed' ? `${d.value} ₸` : `${d.value}%`

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '∞'

const todayIso = () => new Date().toISOString().split('T')[0]

function status(d: Discount): { text: string; tone: 'good' | 'bad' | 'warn' | 'mut' } {
  const today = todayIso()
  if (!d.is_active) return { text: 'Неактивна', tone: 'mut' }
  if (d.valid_to && d.valid_to < today) return { text: 'Истекла', tone: 'bad' }
  if (d.valid_from && d.valid_from > today) return { text: 'Запланирована', tone: 'warn' }
  return { text: 'Активна', tone: 'good' }
}

export default function DiscountsScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canCreate = canDo(role, 'discounts.create')
  const canEdit = canDo(role, 'discounts.edit')

  const [items, setItems] = useState<Discount[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // модалка создания
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // переключение активности
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<{ data: Discount[] }>('/api/admin/discounts')
      setItems(res.data || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // company_id для новой скидки: берём из уже существующих (у владельца обычно одна компания)
  const defaultCompanyId = useMemo(() => {
    const withCompany = items.find((d) => d.company_id)
    return withCompany?.company_id ?? null
  }, [items])

  const openCreate = () => {
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setForm(emptyForm)
    setFormError(null)
  }

  const submit = async () => {
    if (!form.name.trim()) { setFormError('Название скидки обязательно'); return }
    const value = num(form.value)
    if (!Number.isFinite(value) || value < 0) { setFormError('Укажите корректное значение'); return }
    if (form.type === 'promo_code' && !form.promo_code.trim()) { setFormError('Введите промокод'); return }

    setSaving(true)
    setFormError(null)
    try {
      await apiFetch('/api/admin/discounts', {
        method: 'POST',
        body: JSON.stringify({
          action: 'createDiscount',
          payload: {
            name: form.name.trim(),
            type: form.type,
            value,
            promo_code: form.type === 'promo_code' ? form.promo_code.trim() : null,
            min_order_amount: form.min_order_amount.trim() ? num(form.min_order_amount) || 0 : 0,
            valid_from: form.valid_from.trim() || null,
            valid_to: form.valid_to.trim() || null,
            usage_limit: form.usage_limit.trim() ? Math.trunc(num(form.usage_limit)) || null : null,
            company_id: defaultCompanyId,
          },
        }),
      })
      haptic.success()
      setModalOpen(false)
      setForm(emptyForm)
      await load()
    } catch (e: any) {
      haptic.error()
      setFormError(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (d: Discount) => {
    setBusyId(d.id)
    setError(null)
    try {
      await apiFetch('/api/admin/discounts', {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateDiscount',
          discountId: d.id,
          payload: { is_active: !d.is_active },
        }),
      })
      haptic.success()
      await load()
    } catch (e: any) {
      haptic.error()
      setError(e?.message || 'Не удалось изменить статус')
    } finally {
      setBusyId(null)
    }
  }

  const summary = useMemo(() => {
    const today = todayIso()
    let active = 0, promo = 0
    for (const d of items) {
      const live = d.is_active && (!d.valid_to || d.valid_to >= today) && (!d.valid_from || d.valid_from <= today)
      if (live) active += 1
      if (d.type === 'promo_code') promo += 1
    }
    return { total: items.length, active, promo }
  }, [items])

  const filtered = useMemo(() => {
    const today = todayIso()
    if (filter === 'promo') return items.filter((d) => d.type === 'promo_code')
    if (filter === 'active') {
      return items.filter(
        (d) => d.is_active && (!d.valid_to || d.valid_to >= today) && (!d.valid_from || d.valid_from <= today),
      )
    }
    return items
  }, [items, filter])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Скидки</Text>
        {canCreate ? (
          <Pressable
            onPress={openCreate}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.green, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 7 }}
          >
            <Ionicons name="add" size={16} color="#04130d" />
            <Text style={{ color: '#04130d', fontSize: 13, fontWeight: '900' }}>Создать</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.blue}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО СКИДОК</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.total}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`активных ${summary.active}`} tone="good" />
            {summary.promo > 0 ? <Pill text={`промокодов ${summary.promo}`} tone="brand" /> : null}
          </View>
        </GlowHero>

        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: 'Все' },
            { key: 'active', label: 'Активные' },
            { key: 'promo', label: 'Промокоды' },
          ]}
        />

        {error ? <ErrorState message={error} onRetry={() => load()} /> : null}

        {loading && items.length === 0 ? (
          <SkeletonList rows={6} />
        ) : filtered.length === 0 && !loading ? (
          <EmptyState icon="pricetags-outline" title="Скидок не найдено" />
        ) : (
          <Card style={{ padding: 0 }}>
            {filtered.map((d, i) => {
              const st = status(d)
              return (
                <View
                  key={d.id}
                  style={{
                    padding: 14,
                    opacity: d.is_active ? 1 : 0.6,
                    borderBottomWidth: i < filtered.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', flex: 1 }} numberOfLines={1}>{d.name}</Text>
                    <Text style={{ color: T.greenBright, fontSize: 16, fontWeight: '900' }}>{valueDisplay(d)}</Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Pill text={typeLabel(d.type)} tone="mut" />
                    <Pill text={st.text} tone={st.tone} />
                    {d.type === 'promo_code' && d.promo_code ? (
                      <View style={{ borderWidth: 1, borderColor: T.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: T.text, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{d.promo_code}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={{ marginTop: 8, gap: 2 }}>
                    {d.min_order_amount > 0 ? (
                      <Text style={{ color: T.textDim, fontSize: 12 }}>Мин. заказ: {money(d.min_order_amount)}</Text>
                    ) : null}
                    {d.valid_from || d.valid_to ? (
                      <Text style={{ color: T.textDim, fontSize: 12 }}>Период: {fmtDate(d.valid_from)} — {fmtDate(d.valid_to)}</Text>
                    ) : null}
                    {d.usage_limit !== null ? (
                      <Text style={{ color: T.textDim, fontSize: 12 }}>Использований: {d.usage_count} / {d.usage_limit}</Text>
                    ) : (
                      <Text style={{ color: T.textDim, fontSize: 12 }}>Использований: {d.usage_count}</Text>
                    )}
                  </View>

                  {canEdit ? (
                    <Pressable
                      onPress={() => void toggleActive(d)}
                      disabled={busyId === d.id}
                      hitSlop={6}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        marginTop: 12,
                        borderRadius: R.md,
                        paddingVertical: 9,
                        borderWidth: 1,
                        borderColor: d.is_active ? T.border : '#10b981',
                        backgroundColor: d.is_active ? 'transparent' : '#0c3a2c',
                        opacity: busyId === d.id ? 0.6 : 1,
                      }}
                    >
                      {busyId === d.id ? (
                        <ActivityIndicator color={d.is_active ? T.textMut : T.green} size="small" />
                      ) : (
                        <>
                          <Ionicons name={d.is_active ? 'pause' : 'play'} size={15} color={d.is_active ? T.textMut : T.green} />
                          <Text style={{ color: d.is_active ? T.textMut : T.green, fontSize: 13, fontWeight: '800' }}>
                            {d.is_active ? 'Выключить' : 'Включить'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              )
            })}
          </Card>
        )}
      </ScrollView>

      {/* Модалка создания скидки */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>Новая скидка</Text>
              <Pressable onPress={closeModal} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Название *</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="Например: Скидка выходного дня"
                  placeholderTextColor={T.textDim}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Тип</Text>
                <Segmented
                  value={form.type}
                  onChange={(v) => setForm((f) => ({ ...f, type: v }))}
                  options={[
                    { key: 'percent', label: 'Процент' },
                    { key: 'fixed', label: 'Фикс. ₸' },
                    { key: 'promo_code', label: 'Промокод' },
                  ]}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>
                  {form.type === 'fixed' ? 'Значение, ₸ *' : 'Значение, % *'}
                </Text>
                <TextInput
                  value={form.value}
                  onChangeText={(v) => setForm((f) => ({ ...f, value: v }))}
                  placeholder={form.type === 'fixed' ? '500' : '10'}
                  placeholderTextColor={T.textDim}
                  keyboardType="decimal-pad"
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              {form.type === 'promo_code' ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Промокод *</Text>
                  <TextInput
                    value={form.promo_code}
                    onChangeText={(v) => setForm((f) => ({ ...f, promo_code: v.toUpperCase() }))}
                    placeholder="SALE2026"
                    placeholderTextColor={T.textDim}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15, fontVariant: ['tabular-nums'] }}
                  />
                </View>
              ) : null}

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Минимальная сумма заказа, ₸</Text>
                <TextInput
                  value={form.min_order_amount}
                  onChangeText={(v) => setForm((f) => ({ ...f, min_order_amount: v }))}
                  placeholder="0"
                  placeholderTextColor={T.textDim}
                  keyboardType="decimal-pad"
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Действует с</Text>
                  <TextInput
                    value={form.valid_from}
                    onChangeText={(v) => setForm((f) => ({ ...f, valid_from: v }))}
                    placeholder="ГГГГ-ММ-ДД"
                    placeholderTextColor={T.textDim}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15, fontVariant: ['tabular-nums'] }}
                  />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Действует до</Text>
                  <TextInput
                    value={form.valid_to}
                    onChangeText={(v) => setForm((f) => ({ ...f, valid_to: v }))}
                    placeholder="ГГГГ-ММ-ДД"
                    placeholderTextColor={T.textDim}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15, fontVariant: ['tabular-nums'] }}
                  />
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Лимит использований</Text>
                <TextInput
                  value={form.usage_limit}
                  onChangeText={(v) => setForm((f) => ({ ...f, usage_limit: v }))}
                  placeholder="без лимита"
                  placeholderTextColor={T.textDim}
                  keyboardType="number-pad"
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>
            </ScrollView>

            {formError ? <Text style={{ color: T.red, fontSize: 12 }}>{formError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <GhostButton label="Отмена" onPress={closeModal} disabled={saving} style={{ flex: 1 }} />
              <PrimaryButton label="Сохранить" loading={saving} disabled={saving} onPress={() => void submit()} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
