import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, R, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, SectionTitle } from '@/components/ui'

// ── Типы ответа GET /api/admin/staff-salary ─────────────────────────────────
type Staff = {
  id: string
  full_name: string | null
  short_name: string | null
  role: string | null
  monthly_salary: number | null
  is_active: boolean
}

type AdjKind = 'bonus' | 'fine' | 'advance' | 'debt'

type Adjustment = {
  id: string
  staff_id: string
  kind: AdjKind | string
  amount: number | null
  date: string | null
  status: string | null
  comment: string | null
}

type Payment = {
  id: string
  staff_id: string
  pay_date: string | null
  slot: string | null
  amount: number | null
}

type SalaryResponse = {
  staff?: Staff[]
  adjustments?: Adjustment[]
  payments?: Payment[]
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Собственник',
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  other: 'Сотрудник',
}

// Текущий месяц в формате YYYY-MM (по локальному времени устройства).
function currentMonthKey(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${mm}`
}

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  const idx = Number(m) - 1
  return `${MONTH_NAMES[idx] || ''} ${y}`.trim()
}

// Разбор ЗП по одному сотруднику за текущий месяц.
type Breakdown = {
  staff: Staff
  bonuses: number
  fines: number
  advances: number
  debts: number
  paid: number
  // Чистая к выплате по простой формуле: оклад + бонусы − штрафы − авансы − долги.
  // Это ОРИЕНТИР (без расчёта смен операторов) — помечаем как «расчёт по составляющим».
  toPay: number
}

export default function SalaryScreen() {
  const router = useRouter()
  const monthKey = useMemo(currentMonthKey, [])

  const [staff, setStaff] = useState<Staff[]>([])
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<SalaryResponse>('/api/admin/staff-salary')
      setStaff((res.staff || []).filter((s) => s.is_active !== false))
      setAdjustments(res.adjustments || [])
      setPayments(res.payments || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Сводка по каждому сотруднику.
  const rows = useMemo<Breakdown[]>(() => {
    // Активные корректировки — берём в работу как «открытые» (ещё не закрыты выплатой).
    // Это честный текущий баланс начислений/удержаний на сотруднике.
    const adjByStaff = new Map<string, { bonuses: number; fines: number; advances: number; debts: number }>()
    for (const a of adjustments) {
      const status = String(a.status || 'active')
      if (status !== 'active') continue
      const sid = String(a.staff_id || '')
      if (!sid) continue
      const amount = Math.round(Number(a.amount || 0))
      if (!Number.isFinite(amount) || amount <= 0) continue
      const acc = adjByStaff.get(sid) || { bonuses: 0, fines: 0, advances: 0, debts: 0 }
      if (a.kind === 'bonus') acc.bonuses += amount
      else if (a.kind === 'fine') acc.fines += amount
      else if (a.kind === 'advance') acc.advances += amount
      else if (a.kind === 'debt') acc.debts += amount
      adjByStaff.set(sid, acc)
    }

    // Выплаты текущего месяца — по pay_date YYYY-MM.
    const paidByStaff = new Map<string, number>()
    for (const p of payments) {
      const pd = String(p.pay_date || '')
      if (pd.slice(0, 7) !== monthKey) continue
      const sid = String(p.staff_id || '')
      if (!sid) continue
      paidByStaff.set(sid, (paidByStaff.get(sid) || 0) + Math.round(Number(p.amount || 0)))
    }

    return staff
      .map((s) => {
        const a = adjByStaff.get(String(s.id)) || { bonuses: 0, fines: 0, advances: 0, debts: 0 }
        const salary = Math.round(Number(s.monthly_salary || 0))
        const toPay = salary + a.bonuses - a.fines - a.advances - a.debts
        return {
          staff: s,
          bonuses: a.bonuses,
          fines: a.fines,
          advances: a.advances,
          debts: a.debts,
          paid: paidByStaff.get(String(s.id)) || 0,
          toPay,
        }
      })
      .sort((x, y) => {
        const sd = Number(y.staff.monthly_salary || 0) - Number(x.staff.monthly_salary || 0)
        if (sd !== 0) return sd
        return (x.staff.full_name || '').localeCompare(y.staff.full_name || '')
      })
  }, [staff, adjustments, payments, monthKey])

  // Итоги для героя.
  const totals = useMemo(() => {
    let fot = 0
    let paid = 0
    let bonuses = 0
    let fines = 0
    let advances = 0
    let debts = 0
    for (const r of rows) {
      fot += Math.round(Number(r.staff.monthly_salary || 0))
      paid += r.paid
      bonuses += r.bonuses
      fines += r.fines
      advances += r.advances
      debts += r.debts
    }
    return { fot, paid, bonuses, fines, advances, debts, count: rows.length }
  }, [rows])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Зарплаты</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && staff.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.green}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>
            ФОНД ОПЛАТЫ ТРУДА · {monthLabel(monthKey).toUpperCase()}
          </Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(totals.fot)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`выплачено ${moneyShort(totals.paid)}`} tone={totals.paid > 0 ? 'good' : 'mut'} />
            <Pill text={`${totals.count} сотр.`} tone="brand" />
          </View>
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {/* Сводка начислений/удержаний по всем за месяц */}
        {!loading || rows.length > 0 ? (
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[
                { label: 'Бонусы', value: totals.bonuses, color: T.greenBright, sign: '+' },
                { label: 'Штрафы', value: totals.fines, color: T.red, sign: '−' },
                { label: 'Авансы', value: totals.advances, color: T.amber, sign: '−' },
                { label: 'Долги', value: totals.debts, color: T.red, sign: '−' },
              ].map((it, i) => (
                <View key={it.label} style={{ width: '50%', paddingVertical: 8, paddingRight: i % 2 === 0 ? 8 : 0 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>{it.label}</Text>
                  <Text style={{ color: it.value > 0 ? it.color : T.textMut, fontSize: 18, fontWeight: '900', marginTop: 3 }}>
                    {it.value > 0 ? `${it.sign}${money(it.value)}` : money(0)}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <SectionTitle hint={`${monthLabel(monthKey)}`}>По сотрудникам</SectionTitle>

        {loading && rows.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 30 }} />
        ) : rows.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Ionicons name="cash-outline" size={36} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14, marginTop: 8 }}>Нет данных по зарплатам</Text>
          </Card>
        ) : (
          rows.map((r) => {
            const name = r.staff.full_name || r.staff.short_name || 'Без имени'
            const roleText = ROLE_LABEL[r.staff.role || 'other'] || 'Сотрудник'
            const salary = Math.round(Number(r.staff.monthly_salary || 0))
            const hasAdj = r.bonuses > 0 || r.fines > 0 || r.advances > 0 || r.debts > 0
            return (
              <Card key={r.staff.id} style={{ padding: 0 }}>
                {/* Шапка строки сотрудника */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: T.text, fontSize: 16, fontWeight: '800' }} numberOfLines={1}>{name}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <Pill text={roleText} tone="brand" />
                      {r.paid > 0 ? <Pill text={`выплачено ${moneyShort(r.paid)}`} tone="good" /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: T.text, fontSize: 16, fontWeight: '900' }}>{money(salary)}</Text>
                    <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>оклад / мес</Text>
                  </View>
                </View>

                {/* Разбор по составляющим */}
                {hasAdj ? (
                  <View style={{ borderTopWidth: 1, borderTopColor: T.borderSoft, paddingHorizontal: 14, paddingVertical: 12, gap: 8 }}>
                    {r.bonuses > 0 ? <ComponentRow label="Бонусы" sign="+" value={r.bonuses} color={T.greenBright} /> : null}
                    {r.fines > 0 ? <ComponentRow label="Штрафы" sign="−" value={r.fines} color={T.red} /> : null}
                    {r.advances > 0 ? <ComponentRow label="Авансы" sign="−" value={r.advances} color={T.amber} /> : null}
                    {r.debts > 0 ? <ComponentRow label="Долги" sign="−" value={r.debts} color={T.red} /> : null}
                  </View>
                ) : null}

                {/* Ориентир к выплате */}
                <View style={{ borderTopWidth: 1, borderTopColor: T.borderSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="calculator-outline" size={15} color={T.textMut} />
                    <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700' }}>К выплате (ориентир)</Text>
                  </View>
                  <Text style={{ color: r.toPay >= 0 ? T.greenBright : T.red, fontSize: 17, fontWeight: '900' }}>
                    {money(r.toPay)}
                  </Text>
                </View>
              </Card>
            )
          })
        )}

        {rows.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: 4 }}>
            «К выплате» — упрощённый ориентир: оклад + бонусы − штрафы − авансы − долги за текущий месяц.{'\n'}
            Точный расчёт смен операторов и закрытие периодов выплат — в веб-портале.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

// Строка одной составляющей разбора ЗП.
function ComponentRow({ label, sign, value, color }: { label: string; sign: '+' | '−'; value: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: T.textMut, fontSize: 14 }}>{label}</Text>
      <Text style={{ color, fontSize: 14, fontWeight: '800' }}>{sign}{money(value)}</Text>
    </View>
  )
}
