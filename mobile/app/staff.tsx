import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, S, R, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, ErrorState, EmptyState, PrimaryButton, GhostButton, SkeletonList } from '@/components/ui'

type Staff = {
  id: string
  full_name: string | null
  role: string | null
  short_name: string | null
  monthly_salary: number | null
  is_active: boolean
  phone?: string | null
  email?: string | null
}

type AccountState = 'no_email' | 'no_account' | 'invited' | 'active'

type AccountInfo = {
  staffId: string
  email: string | null
  phone: string | null
  full_name: string | null
  accountState: AccountState
}

type Company = { id: string; name?: string | null }

type AdjKind = 'bonus' | 'fine' | 'advance'

const ADJ_KINDS: { key: AdjKind; label: string; tone: 'good' | 'bad' | 'warn'; glow: string }[] = [
  { key: 'bonus', label: 'Бонус', tone: 'good', glow: T.green },
  { key: 'fine', label: 'Штраф', tone: 'bad', glow: T.red },
  { key: 'advance', label: 'Аванс', tone: 'warn', glow: '#f59e0b' },
]

const ROLE_LABEL: Record<string, string> = {
  owner: 'Собственник',
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  other: 'Сотрудник',
}

const ACCOUNT_LABEL: Record<AccountState, { text: string; tone: 'good' | 'warn' | 'mut' }> = {
  active: { text: 'Аккаунт активен', tone: 'good' },
  invited: { text: 'Приглашён', tone: 'warn' },
  no_account: { text: 'Нет аккаунта', tone: 'warn' },
  no_email: { text: 'Нет email', tone: 'warn' },
}

const CREATE_ROLES: { key: string; label: string }[] = [
  { key: 'owner', label: 'Собственник' },
  { key: 'manager', label: 'Руководитель' },
  { key: 'marketer', label: 'Маркетолог' },
  { key: 'other', label: 'Сотрудник' },
]

export default function StaffScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canAdjust = canDo(role, 'salary.adjust')
  const canCreate = canDo(role, 'staff.create')

  const [items, setItems] = useState<Staff[]>([])
  const [accounts, setAccounts] = useState<Record<string, AccountInfo>>({})
  const [companies, setCompanies] = useState<Company[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // модалка корректировки ЗП (бонус / штраф / аванс)
  const [adjStaff, setAdjStaff] = useState<Staff | null>(null)
  const [adjKind, setAdjKind] = useState<AdjKind>('bonus')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjComment, setAdjComment] = useState('')
  const [adjCompanyId, setAdjCompanyId] = useState<string | null>(null)
  const [adjSaving, setAdjSaving] = useState(false)
  const [adjError, setAdjError] = useState<string | null>(null)

  // модалка создания сотрудника (+ опц. приглашение аккаунта по email)
  const [createOpen, setCreateOpen] = useState(false)
  const [cFullName, setCFullName] = useState('')
  const [cRole, setCRole] = useState('other')
  const [cSalary, setCSalary] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [cEmail, setCEmail] = useState('')
  const [cInvite, setCInvite] = useState(true)
  const [cSaving, setCSaving] = useState(false)
  const [cError, setCError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ staff?: Staff[] }>('/api/admin/staff')
      const rows = res.staff || []
      setItems(rows)

      if (rows.length > 0) {
        const ids = rows.map((r) => r.id).join(',')
        try {
          const acc = await apiFetch<{ items?: AccountInfo[] }>(
            `/api/admin/staff-accounts?staffIds=${encodeURIComponent(ids)}`,
          )
          const map: Record<string, AccountInfo> = {}
          for (const a of acc.items || []) if (a?.staffId) map[a.staffId] = a
          setAccounts(map)
        } catch {
          setAccounts({})
        }
      } else {
        setAccounts({})
      }

      if (canAdjust) {
        try {
          const comp = await apiFetch<{ data?: Company[] }>('/api/admin/companies')
          setCompanies(comp.data || [])
        } catch {
          setCompanies([])
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [canAdjust])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    let totalBudget = 0
    let active = 0
    let inactive = 0
    for (const s of items) {
      if (s.is_active) {
        active += 1
        totalBudget += Number(s.monthly_salary || 0)
      } else {
        inactive += 1
      }
    }
    const avg = active > 0 ? totalBudget / active : 0
    return { totalBudget, active, inactive, avg }
  }, [items])

  const visible = useMemo(() => {
    const list = items.filter((s) => showInactive || s.is_active)
    return [...list].sort((a, b) => {
      if (Number(b.is_active) - Number(a.is_active) !== 0) return Number(b.is_active) - Number(a.is_active)
      return (a.full_name || '').localeCompare(b.full_name || '')
    })
  }, [items, showInactive])

  const openAdjust = (s: Staff) => {
    setAdjStaff(s)
    setAdjKind('bonus')
    setAdjAmount('')
    setAdjComment('')
    setAdjCompanyId(companies.length === 1 ? String(companies[0].id) : null)
    setAdjError(null)
  }

  const closeAdjust = () => {
    if (adjSaving) return
    setAdjStaff(null)
    setAdjError(null)
  }

  const submitAdjust = async () => {
    if (!adjStaff) return
    const amount = Math.round(Number(String(adjAmount).replace(',', '.')))
    if (!Number.isFinite(amount) || amount <= 0) {
      setAdjError('Сумма должна быть больше 0')
      return
    }
    if (adjKind === 'advance' && !adjCompanyId) {
      setAdjError('Для аванса выберите компанию')
      return
    }
    setAdjSaving(true)
    setAdjError(null)
    try {
      await apiFetch('/api/admin/staff-salary', {
        method: 'POST',
        body: JSON.stringify({
          action: 'addAdjustment',
          staff_id: adjStaff.id,
          kind: adjKind,
          amount,
          comment: adjComment.trim() || null,
          company_id: adjKind === 'advance' ? adjCompanyId : null,
        }),
      })
      haptic.success()
      setAdjStaff(null)
      await load()
    } catch (e: any) {
      haptic.error()
      setAdjError(e?.message || 'Не удалось сохранить')
    } finally {
      setAdjSaving(false)
    }
  }

  const openCreate = () => {
    setCFullName('')
    setCRole('other')
    setCSalary('')
    setCPhone('')
    setCEmail('')
    setCInvite(true)
    setCError(null)
    setCreateOpen(true)
  }

  const closeCreate = () => {
    if (cSaving) return
    setCreateOpen(false)
    setCError(null)
  }

  const submitCreate = async () => {
    const fullName = cFullName.trim()
    if (!fullName) {
      setCError('Укажите ФИО')
      return
    }
    const salary = Math.round(Number(String(cSalary).replace(',', '.')))
    if (!Number.isFinite(salary) || salary <= 0) {
      setCError('Оклад должен быть больше 0')
      return
    }
    const email = cEmail.trim().toLowerCase()
    if (cInvite && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCError('Некорректный email для приглашения')
      return
    }
    setCSaving(true)
    setCError(null)
    try {
      const res = await apiFetch<{ data?: { id?: string } }>('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          action: 'createStaff',
          payload: {
            full_name: fullName,
            role: cRole,
            monthly_salary: salary,
            phone: cPhone.trim() || null,
            email: email || null,
          },
        }),
      })
      const newId = res?.data?.id ? String(res.data.id) : null
      if (cInvite && email && newId) {
        try {
          await apiFetch('/api/admin/staff-accounts', {
            method: 'POST',
            body: JSON.stringify({ action: 'inviteStaffAccount', staffId: newId }),
          })
        } catch {
          // сотрудник создан, но приглашение не ушло — не считаем фатальной ошибкой
        }
      }
      haptic.success()
      setCreateOpen(false)
      await load()
    } catch (e: any) {
      haptic.error()
      setCError(e?.message || 'Не удалось создать сотрудника')
    } finally {
      setCSaving(false)
    }
  }

  const activeKind = ADJ_KINDS.find((k) => k.key === adjKind) || ADJ_KINDS[0]

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Сотрудники</Text>
        {canCreate ? (
          <Pressable
            onPress={openCreate}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${T.green}22`, borderWidth: 1, borderColor: T.green, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 7 }}
          >
            <Ionicons name="add" size={16} color={T.green} />
            <Text style={{ color: T.green, fontSize: 13, fontWeight: '800' }}>Сотрудник</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.green}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ФОНД ОПЛАТЫ ТРУДА</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(stats.totalBudget)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`активных ${stats.active}`} tone="good" />
            {stats.inactive > 0 ? <Pill text={`в архиве ${stats.inactive}`} tone="mut" /> : null}
            {stats.avg > 0 ? <Pill text={`средний ${moneyShort(stats.avg)}`} tone="brand" /> : null}
          </View>
        </GlowHero>

        {error ? <ErrorState message={error} onRetry={() => load()} /> : null}

        {stats.inactive > 0 ? (
          <Pressable
            onPress={() => setShowInactive((v) => !v)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 8,
            }}
          >
            <Ionicons name={showInactive ? 'eye-off-outline' : 'eye-outline'} size={16} color={T.textMut} />
            <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '600' }}>
              {showInactive ? 'Скрыть архивных' : `Показать архивных (${stats.inactive})`}
            </Text>
          </Pressable>
        ) : null}

        {loading && items.length === 0 ? (
          <SkeletonList rows={6} />
        ) : visible.length === 0 && !loading ? (
          <EmptyState icon="people-outline" title="Список сотрудников пуст" />
        ) : (
          <Card style={{ padding: 0 }}>
            {visible.map((s, i) => {
              const role = ROLE_LABEL[s.role || 'other'] || 'Сотрудник'
              const acc = accounts[s.id]
              const accState = acc?.accountState
              return (
                <View
                  key={s.id}
                  style={{
                    flexDirection: 'row',
                    gap: 12,
                    padding: 14,
                    opacity: s.is_active ? 1 : 0.55,
                    borderBottomWidth: i < visible.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                      {s.full_name || s.short_name || 'Без имени'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
                      <Pill text={role} tone="brand" />
                      {!s.is_active ? <Pill text="Архив" tone="bad" /> : null}
                      {accState ? <Pill text={ACCOUNT_LABEL[accState].text} tone={ACCOUNT_LABEL[accState].tone} /> : null}
                    </View>
                    {acc?.email || s.email ? (
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 6 }} numberOfLines={1}>
                        {acc?.email || s.email}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 8 }}>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: T.text, fontSize: 15, fontWeight: '800' }}>{money(Number(s.monthly_salary || 0))}</Text>
                      <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>оклад / мес</Text>
                    </View>
                    {canAdjust ? (
                      <Pressable
                        onPress={() => openAdjust(s)}
                        hitSlop={8}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: T.border, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 5 }}
                      >
                        <Ionicons name="swap-vertical" size={14} color={T.textMut} />
                        <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700' }}>Корректировка</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )
            })}
          </Card>
        )}

        {visible.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center' }}>
            Показано {visible.length} из {items.length}
          </Text>
        ) : null}
      </ScrollView>

      {/* Модалка корректировки ЗП: бонус / штраф / аванс */}
      <Modal visible={!!adjStaff} transparent animationType="slide" onRequestClose={closeAdjust}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>Корректировка ЗП</Text>
                {adjStaff ? (
                  <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {adjStaff.full_name || adjStaff.short_name || 'Сотрудник'}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={closeAdjust} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            {/* Тип корректировки */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {ADJ_KINDS.map((k) => {
                const on = adjKind === k.key
                return (
                  <Pressable
                    key={k.key}
                    onPress={() => { setAdjKind(k.key); setAdjError(null) }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: 11,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: on ? k.glow : T.border,
                      backgroundColor: on ? `${k.glow}22` : 'transparent',
                    }}
                  >
                    <Text style={{ color: on ? k.glow : T.textMut, fontWeight: '800', fontSize: 14 }}>{k.label}</Text>
                  </Pressable>
                )
              })}
            </View>

            {/* Сумма */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Сумма (₸) *</Text>
              <TextInput
                value={adjAmount}
                onChangeText={setAdjAmount}
                placeholder="0"
                placeholderTextColor={T.textDim}
                keyboardType="numeric"
                style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
              />
            </View>

            {/* Компания (только для аванса) */}
            {adjKind === 'advance' ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Компания (касса) *</Text>
                {companies.length === 0 ? (
                  <Text style={{ color: T.textDim, fontSize: 12 }}>Нет доступных компаний</Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {companies.map((c) => {
                      const on = adjCompanyId === String(c.id)
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => setAdjCompanyId(String(c.id))}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: on ? T.green : T.border,
                            backgroundColor: on ? `${T.green}22` : 'transparent',
                          }}
                        >
                          <Text style={{ color: on ? T.green : T.textMut, fontSize: 13, fontWeight: '700' }}>{c.name || 'Без названия'}</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                )}
              </View>
            ) : null}

            {/* Комментарий */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Комментарий</Text>
              <TextInput
                value={adjComment}
                onChangeText={setAdjComment}
                placeholder="Например: премия за выручку"
                placeholderTextColor={T.textDim}
                multiline
                style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15, minHeight: 70, textAlignVertical: 'top' }}
              />
            </View>

            {adjError ? <Text style={{ color: T.red, fontSize: 12 }}>{adjError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <GhostButton label="Отмена" onPress={closeAdjust} disabled={adjSaving} style={{ flex: 1 }} />
              <PrimaryButton label="Сохранить" loading={adjSaving} disabled={adjSaving} onPress={() => void submitAdjust()} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Модалка создания сотрудника */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={closeCreate}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>Новый сотрудник</Text>
              <Pressable onPress={closeCreate} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 14 }}>
              {/* ФИО */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>ФИО *</Text>
                <TextInput
                  value={cFullName}
                  onChangeText={setCFullName}
                  placeholder="Иванов Иван"
                  placeholderTextColor={T.textDim}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              {/* Роль */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Роль</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {CREATE_ROLES.map((r) => {
                    const on = cRole === r.key
                    return (
                      <Pressable
                        key={r.key}
                        onPress={() => setCRole(r.key)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: on ? T.green : T.border,
                          backgroundColor: on ? `${T.green}22` : 'transparent',
                        }}
                      >
                        <Text style={{ color: on ? T.green : T.textMut, fontSize: 13, fontWeight: '700' }}>{r.label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              {/* Оклад */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Оклад / мес (₸) *</Text>
                <TextInput
                  value={cSalary}
                  onChangeText={setCSalary}
                  placeholder="0"
                  placeholderTextColor={T.textDim}
                  keyboardType="numeric"
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              {/* Телефон */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Телефон</Text>
                <TextInput
                  value={cPhone}
                  onChangeText={setCPhone}
                  placeholder="+7 700 000 00 00"
                  placeholderTextColor={T.textDim}
                  keyboardType="phone-pad"
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              {/* Email */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Email</Text>
                <TextInput
                  value={cEmail}
                  onChangeText={setCEmail}
                  placeholder="name@example.com"
                  placeholderTextColor={T.textDim}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              {/* Приглашение аккаунта */}
              <Pressable
                onPress={() => setCInvite((v) => !v)}
                disabled={!cEmail.trim()}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: cEmail.trim() ? 1 : 0.5 }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 1.5,
                    borderColor: cInvite && cEmail.trim() ? T.green : T.border,
                    backgroundColor: cInvite && cEmail.trim() ? T.green : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {cInvite && cEmail.trim() ? <Ionicons name="checkmark" size={15} color="#04130d" /> : null}
                </View>
                <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '600', flex: 1 }}>
                  Отправить приглашение на email (сотрудник сам задаст пароль)
                </Text>
              </Pressable>
            </ScrollView>

            {cError ? <Text style={{ color: T.red, fontSize: 12 }}>{cError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <GhostButton label="Отмена" onPress={closeCreate} disabled={cSaving} style={{ flex: 1 }} />
              <PrimaryButton label="Создать" loading={cSaving} disabled={cSaving} onPress={() => void submitCreate()} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
