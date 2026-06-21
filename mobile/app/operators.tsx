import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented } from '@/components/ui'

type Profile = {
  full_name?: string | null
  phone?: string | null
  email?: string | null
  hire_date?: string | null
  position?: string | null
  photo_url?: string | null
}

type Stats = {
  totalShifts: number
  totalTurnover: number
  avgPerShift: number
  totalDebts: number
  totalBonuses: number
}

type Operator = {
  id: string
  name: string
  short_name?: string | null
  is_active?: boolean | null
  role?: string | null
  telegram_chat_id?: string | null
  created_at?: string | null
  operator_profiles?: Profile[] | Profile | null
  auth?: { username?: string | null; role?: string | null; is_active?: boolean | null } | null
  stats?: Stats | null
}

const profileOf = (op: Operator): Profile => {
  const p = op.operator_profiles
  if (Array.isArray(p)) return p[0] || {}
  return p || {}
}

const statsOf = (op: Operator): Stats => ({
  totalShifts: Number(op.stats?.totalShifts || 0),
  totalTurnover: Number(op.stats?.totalTurnover || 0),
  avgPerShift: Number(op.stats?.avgPerShift || 0),
  totalDebts: Number(op.stats?.totalDebts || 0),
  totalBonuses: Number(op.stats?.totalBonuses || 0),
})

const displayName = (op: Operator) => {
  const p = profileOf(op)
  return p.full_name?.trim() || op.name || 'Без имени'
}

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

type CreateForm = {
  name: string
  fullName: string
  shortName: string
  position: string
  phone: string
  email: string
  withLogin: boolean
  username: string
}

const emptyCreate: CreateForm = {
  name: '',
  fullName: '',
  shortName: '',
  position: '',
  phone: '',
  email: '',
  withLogin: false,
  username: '',
}

type CreatedAccount = { name: string; username: string; password: string }

export default function OperatorsScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canCreate = canDo(role, 'operators.create')
  const canEdit = canDo(role, 'operators.edit')

  const [filter, setFilter] = useState<'all' | 'active'>('active')
  const [items, setItems] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Модалка создания/редактирования оператора
  const [modalOpen, setModalOpen] = useState(false)
  // editingId = null → режим создания, иначе — правка существующего
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateForm>(emptyCreate)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Сгенерированные сервером логин/пароль (показываем после успеха)
  const [created, setCreated] = useState<CreatedAccount | null>(null)
  // id оператора, у которого сейчас переключается активность
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ data: Operator[] }>('/api/admin/operators')
      setItems(res.data || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyCreate)
    setFormError(null)
    setCreated(null)
    setModalOpen(true)
  }

  const openEdit = (op: Operator) => {
    const p = profileOf(op)
    setEditingId(op.id)
    setForm({
      name: op.name || '',
      fullName: p.full_name || '',
      shortName: op.short_name || '',
      position: p.position || '',
      phone: p.phone || '',
      email: p.email || '',
      withLogin: false,
      username: '',
    })
    setFormError(null)
    setCreated(null)
    setModalOpen(true)
  }

  const submitEdit = async () => {
    if (!editingId) return
    const name = form.name.trim()
    if (!name) {
      setFormError('Имя оператора обязательно')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await apiFetch('/api/admin/operators', {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateOperator',
          operatorId: editingId,
          payload: {
            name,
            full_name: form.fullName.trim() || null,
            short_name: form.shortName.trim() || null,
            position: form.position.trim() || null,
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
          },
        }),
      })
      haptic.success()
      await load()
      closeModalForce()
    } catch (e: any) {
      haptic.error()
      setFormError(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (op: Operator) => {
    const next = op.is_active === false
    setTogglingId(op.id)
    try {
      await apiFetch('/api/admin/operators', {
        method: 'POST',
        body: JSON.stringify({
          action: 'toggleOperatorActive',
          operatorId: op.id,
          is_active: next,
        }),
      })
      haptic.success()
      await load()
    } catch (e: any) {
      haptic.error()
      setError(e?.message || 'Не удалось изменить статус')
    } finally {
      setTogglingId(null)
    }
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyCreate)
    setFormError(null)
    setCreated(null)
  }

  const submitCreate = async () => {
    const name = form.name.trim()
    if (!name) {
      setFormError('Имя оператора обязательно')
      return
    }
    const username = form.username.trim()
    const email = form.email.trim()
    if (form.withLogin) {
      if (username.length < 3) {
        setFormError('Логин — минимум 3 символа')
        return
      }
      if (!email) {
        setFormError('Для создания логина нужен Email')
        return
      }
    }

    setSaving(true)
    setFormError(null)
    try {
      // 1) Создаём оператора (организация подставляется сервером из сессии).
      const res = await apiFetch<{ ok?: boolean; data?: { id: string; name?: string } }>(
        '/api/admin/operators',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'createOperator',
            payload: {
              name,
              full_name: form.fullName.trim() || null,
              short_name: form.shortName.trim() || null,
              position: form.position.trim() || null,
              phone: form.phone.trim() || null,
              email: email || null,
            },
          }),
        },
      )

      const operatorId = res?.data?.id
      // 2) Опционально — заводим логин. Пароль генерирует сервер и возвращает его.
      if (form.withLogin && operatorId) {
        const acc = await apiFetch<{ username?: string; password?: string }>(
          '/api/admin/create-operator-account',
          {
            method: 'POST',
            body: JSON.stringify({ operatorId, username, email, name }),
          },
        )
        haptic.success()
        await load()
        setCreated({ name, username: acc?.username || username, password: acc?.password || '' })
        return // оставляем модалку открытой, чтобы показать пароль
      }

      haptic.success()
      await load()
      closeModalForce()
    } catch (e: any) {
      haptic.error()
      setFormError(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const closeModalForce = () => {
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyCreate)
    setFormError(null)
    setCreated(null)
  }

  const visible = useMemo(() => {
    if (filter === 'active') return items.filter((o) => o.is_active !== false)
    return items
  }, [items, filter])

  const summary = useMemo(() => {
    const total = items.length
    const active = items.filter((o) => o.is_active !== false).length
    let turnover = 0
    for (const o of items) turnover += Number(o.stats?.totalTurnover || 0)
    return { total, active, inactive: total - active, turnover }
  }, [items])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Операторы</Text>
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

      <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as 'all' | 'active')}
          options={[
            { key: 'active', label: 'Активные' },
            { key: 'all', label: 'Все' },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.amber}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ВСЕГО ОПЕРАТОРОВ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.total}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`активных ${summary.active}`} tone="good" />
            {summary.inactive > 0 ? <Pill text={`неактивных ${summary.inactive}`} tone="mut" /> : null}
          </View>
          {summary.turnover > 0 ? (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Оборот за 30 дней: {moneyShort(summary.turnover)}</Text>
          ) : null}
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && visible.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="people-circle-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Операторы не найдены</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {visible.map((op, i) => {
              const p = profileOf(op)
              const st = statsOf(op)
              const name = displayName(op)
              const sub = [op.short_name || null, p.position || null].filter(Boolean).join(' • ')
              const contact = p.phone || p.email || null
              const active = op.is_active !== false
              return (
                <View
                  key={op.id}
                  style={{
                    flexDirection: 'row',
                    gap: 12,
                    padding: 14,
                    borderBottomWidth: i < visible.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: active ? T.amber + '22' : T.card2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: active ? T.amber : T.textDim, fontSize: 14, fontWeight: '900' }}>{initials(name)}</Text>
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{name}</Text>
                      {!active ? <Pill text="неактивен" tone="mut" /> : null}
                    </View>
                    {sub ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{sub}</Text>
                    ) : null}
                    {contact ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{contact}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: T.textMut, fontSize: 11 }}>Смен: {st.totalShifts}</Text>
                      {st.totalBonuses > 0 ? (
                        <Text style={{ color: T.green, fontSize: 11 }}>Премии +{moneyShort(st.totalBonuses)}</Text>
                      ) : null}
                      {st.totalDebts > 0 ? (
                        <Text style={{ color: T.red, fontSize: 11 }}>Долг {moneyShort(st.totalDebts)}</Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 8 }}>
                    <Text style={{ color: T.greenBright, fontSize: 14.5, fontWeight: '800' }}>{money(st.totalTurnover)}</Text>
                    <Text style={{ color: T.textDim, fontSize: 11 }}>30 дней</Text>
                    {canEdit ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
                        {togglingId === op.id ? (
                          <ActivityIndicator color={T.green} size="small" />
                        ) : (
                          <Switch
                            value={active}
                            onValueChange={() => void toggleActive(op)}
                            trackColor={{ false: T.card2, true: T.green }}
                            thumbColor="#04130d"
                          />
                        )}
                        <Pressable onPress={() => openEdit(op)} hitSlop={8}>
                          <Ionicons name="create-outline" size={20} color={T.textMut} />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </View>
              )
            })}
          </Card>
        )}

        {!loading && items.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Показано {visible.length} из {items.length}
          </Text>
        ) : null}
      </ScrollView>

      {/* Модалка создания оператора */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}
        >
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>
                {created ? 'Оператор создан' : editingId ? 'Редактировать оператора' : 'Новый оператор'}
              </Text>
              <Pressable onPress={created ? closeModalForce : closeModal} hitSlop={10}>
                <Ionicons name="close" size={22} color={T.textMut} />
              </Pressable>
            </View>

            {created ? (
              // Экран успеха: показываем сгенерированные сервером логин и пароль
              <View style={{ gap: 12 }}>
                <Text style={{ color: T.textMut, fontSize: 13 }}>
                  Логин создан для «{created.name}». Сохраните пароль — он показывается один раз.
                </Text>
                <View style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, gap: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: T.textDim, fontSize: 13 }}>Логин</Text>
                    <Text style={{ color: T.text, fontSize: 14, fontWeight: '800' }} selectable>{created.username}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <Text style={{ color: T.textDim, fontSize: 13 }}>Пароль</Text>
                    <Text style={{ color: T.greenBright, fontSize: 14, fontWeight: '800', flexShrink: 1, textAlign: 'right' }} selectable>
                      {created.password || '—'}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={closeModalForce}
                  style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: T.green }}
                >
                  <Text style={{ color: '#04130d', fontWeight: '900' }}>Готово</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Имя *</Text>
                    <TextInput
                      value={form.name}
                      onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                      placeholder="Например: Маржан"
                      placeholderTextColor={T.textDim}
                      style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                    />
                  </View>

                  <View style={{ gap: 6 }}>
                    <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Полное ФИО</Text>
                    <TextInput
                      value={form.fullName}
                      onChangeText={(v) => setForm((f) => ({ ...f, fullName: v }))}
                      placeholder="Жумабекова Маржан Нурлановна"
                      placeholderTextColor={T.textDim}
                      style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                    />
                  </View>

                  <View style={{ gap: 6 }}>
                    <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Краткое имя</Text>
                    <TextInput
                      value={form.shortName}
                      onChangeText={(v) => setForm((f) => ({ ...f, shortName: v }))}
                      placeholder="Маржан (день)"
                      placeholderTextColor={T.textDim}
                      style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                    />
                  </View>

                  <View style={{ gap: 6 }}>
                    <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Должность</Text>
                    <TextInput
                      value={form.position}
                      onChangeText={(v) => setForm((f) => ({ ...f, position: v }))}
                      placeholder="Старший оператор"
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
                    <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>
                      Email{form.withLogin ? ' *' : ''}
                    </Text>
                    <TextInput
                      value={form.email}
                      onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                      placeholder="operator@example.com"
                      placeholderTextColor={T.textDim}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                    />
                  </View>

                  {!editingId ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 2 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }}>Создать логин</Text>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }}>Пароль сгенерируется автоматически</Text>
                      </View>
                      <Switch
                        value={form.withLogin}
                        onValueChange={(v) => setForm((f) => ({ ...f, withLogin: v }))}
                        trackColor={{ false: T.card2, true: T.green }}
                        thumbColor="#04130d"
                      />
                    </View>
                  ) : null}

                  {!editingId && form.withLogin ? (
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Логин *</Text>
                      <TextInput
                        value={form.username}
                        onChangeText={(v) => setForm((f) => ({ ...f, username: v }))}
                        placeholder="например marzhan"
                        placeholderTextColor={T.textDim}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                      />
                    </View>
                  ) : null}
                </ScrollView>

                {formError ? <Text style={{ color: T.red, fontSize: 12 }}>{formError}</Text> : null}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
                  <Pressable
                    onPress={closeModal}
                    disabled={saving}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: T.border, opacity: saving ? 0.6 : 1 }}
                  >
                    <Text style={{ color: T.textMut, fontWeight: '700' }}>Отмена</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void (editingId ? submitEdit() : submitCreate())}
                    disabled={saving}
                    style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: T.green, opacity: saving ? 0.6 : 1 }}
                  >
                    {saving ? (
                      <ActivityIndicator color="#04130d" size="small" />
                    ) : (
                      <Text style={{ color: '#04130d', fontWeight: '900' }}>{editingId ? 'Сохранить' : 'Создать'}</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
