import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, R, S, money } from '@/lib/theme'
import { Card, Pill, GlowHero } from '@/components/ui'

type Customer = {
  id: string
  company_id: string | null
  name: string
  phone: string | null
  card_number: string | null
  email: string | null
  notes: string | null
  loyalty_points: number
  total_spent: number
  visits_count: number
  is_active: boolean
  created_at: string
  updated_at: string
  company: { id: string; name: string; code: string | null } | null
}

type FormState = { name: string; phone: string; card_number: string; email: string; notes: string }
const emptyForm: FormState = { name: '', phone: '', card_number: '', email: '', notes: '' }

export default function CustomersScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canCreate = canDo(role, 'customers.create')
  const canEdit = canDo(role, 'customers.edit')

  const [items, setItems] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // модалка создания/редактирования
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ data: Customer[] }>('/api/admin/customers')
      setItems(res.data || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openCreate = () => {
    setEditId(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (c: Customer) => {
    setEditId(c.id)
    setForm({
      name: c.name || '',
      phone: c.phone || '',
      card_number: c.card_number || '',
      email: c.email || '',
      notes: c.notes || '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditId(null)
    setForm(emptyForm)
    setFormError(null)
  }

  const submit = async () => {
    if (!form.name.trim()) { setFormError('Имя клиента обязательно'); return }
    setSaving(true)
    setFormError(null)
    try {
      if (editId) {
        await apiFetch('/api/admin/customers', {
          method: 'POST',
          body: JSON.stringify({
            action: 'updateCustomer',
            customerId: editId,
            payload: {
              name: form.name.trim(),
              phone: form.phone.trim(),
              card_number: form.card_number.trim(),
              email: form.email.trim(),
              notes: form.notes.trim(),
            },
          }),
        })
      } else {
        await apiFetch('/api/admin/customers', {
          method: 'POST',
          body: JSON.stringify({
            action: 'createCustomer',
            payload: {
              name: form.name.trim(),
              phone: form.phone.trim() || null,
              card_number: form.card_number.trim() || null,
              email: form.email.trim() || null,
              notes: form.notes.trim() || null,
            },
          }),
        })
      }
      setModalOpen(false)
      setEditId(null)
      setForm(emptyForm)
      await load()
    } catch (e: any) {
      setFormError(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.card_number?.toLowerCase().includes(q),
    )
  }, [items, search])

  const totalPoints = useMemo(
    () => items.reduce((sum, c) => sum + (Number(c.loyalty_points) || 0), 0),
    [items],
  )
  const topCustomer = items.length > 0 ? items[0] : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Клиенты</Text>
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

      {/* Поиск */}
      <View style={{ paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.card2, borderRadius: R.md, borderWidth: 1, borderColor: T.border, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Ionicons name="search" size={16} color={T.textDim} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск по имени, телефону, карте"
            placeholderTextColor={T.textDim}
            style={{ flex: 1, color: T.text, fontSize: 14, padding: 0 }}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={T.textDim} /></Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* Сводка */}
        <GlowHero glow={T.teal}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО КЛИЕНТОВ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{items.length}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`${totalPoints.toLocaleString('ru-RU')} баллов`} tone="warn" />
            {topCustomer ? <Pill text={`топ: ${topCustomer.name}`} tone="brand" /> : null}
          </View>
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && items.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="people-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Клиентов пока нет</Text>
          </Card>
        ) : filtered.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
            <Ionicons name="search-outline" size={34} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Ничего не найдено</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {filtered.map((c, i) => {
              const points = Number(c.loyalty_points) || 0
              return (
                <View key={c.id} style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < filtered.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>{c.name}</Text>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {c.phone || 'без телефона'}
                      {c.card_number ? ` · карта ${c.card_number}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {points > 0 ? <Pill text={`${points.toLocaleString('ru-RU')} баллов`} tone="warn" /> : null}
                      {c.visits_count > 0 ? <Pill text={`${c.visits_count} визитов`} tone="mut" /> : null}
                      {c.company?.name ? <Pill text={c.company.name} tone="brand" /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 8 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{money(c.total_spent || 0)}</Text>
                    <Text style={{ color: T.textDim, fontSize: 11 }}>потрачено</Text>
                    {canEdit ? (
                      <Pressable
                        onPress={() => openEdit(c)}
                        hitSlop={8}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: T.border, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 5, marginTop: 2 }}
                      >
                        <Ionicons name="create-outline" size={14} color={T.textMut} />
                        <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700' }}>Изменить</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )
            })}
          </Card>
        )}
      </ScrollView>

      {/* Модалка создания/редактирования */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>{editId ? 'Изменить клиента' : 'Новый клиент'}</Text>
              <Pressable onPress={closeModal} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 12 }}>
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Имя *</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="Имя клиента"
                  placeholderTextColor={T.textDim}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Телефон</Text>
                <TextInput
                  value={form.phone}
                  onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                  placeholder="+7 700 000 00 00"
                  placeholderTextColor={T.textDim}
                  keyboardType="phone-pad"
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Номер карты</Text>
                <TextInput
                  value={form.card_number}
                  onChangeText={(v) => setForm((f) => ({ ...f, card_number: v }))}
                  placeholder="Например 1024"
                  placeholderTextColor={T.textDim}
                  autoCapitalize="none"
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Email</Text>
                <TextInput
                  value={form.email}
                  onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                  placeholder="client@example.com"
                  placeholderTextColor={T.textDim}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Заметки</Text>
                <TextInput
                  value={form.notes}
                  onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
                  placeholder="Дополнительно"
                  placeholderTextColor={T.textDim}
                  multiline
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15, minHeight: 70, textAlignVertical: 'top' }}
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
