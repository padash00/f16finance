'use client'

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  Users2,
  Plus,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  CalendarDays,
  DollarSign,
  Trash2,
} from 'lucide-react'

type StaffRole = 'manager' | 'marketer' | 'owner' | 'other'
type PaySlot = 'first' | 'second' | 'other'

type Staff = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  role: StaffRole | null
  short_name: string | null
  monthly_salary: number | null
  is_active: boolean
}

type StaffPayment = {
  id: number
  staff_id: string
  pay_date: string
  slot: PaySlot
  amount: number
  comment: string | null
}

const money = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

// --- Даты без UTC-сдвигов ---
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const monthStartISO = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return toISODateLocal(new Date(y, (m || 1) - 1, 1))
}

const monthEndISO = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  // 0-й день следующего месяца = последний день текущего
  return toISODateLocal(new Date(y, (m || 1), 0))
}

const parseAmount = (raw: string) => {
  const n = Number(String(raw).replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) ? n : NaN
}

const ROLE_LABEL: Record<StaffRole, string> = {
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  owner: 'Собственник',
  other: 'Другое',
}

const SLOT_LABEL: Record<PaySlot, string> = {
  first: '1-е число',
  second: '15-е число',
  other: 'Другое',
}

export default function StaffPage() {
  const today = new Date()
  const initialYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [staff, setStaff] = useState<Staff[]>([])
  const [payments, setPayments] = useState<StaffPayment[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- Выбор месяца ---
  const [monthYM, setMonthYM] = useState(initialYM)
  const monthFrom = useMemo(() => monthStartISO(monthYM), [monthYM])
  const monthTo = useMemo(() => monthEndISO(monthYM), [monthYM])

  // --- Форма добавления сотрудника ---
  const [fullName, setFullName] = useState('')
  const [shortName, setShortName] = useState('')
  const [role, setRole] = useState<StaffRole>('manager')
  const [monthlySalary, setMonthlySalary] = useState('')

  // --- Форма выплаты ---
  const [payStaffId, setPayStaffId] = useState('')
  const [payDate, setPayDate] = useState(toISODateLocal(today))
  const [paySlot, setPaySlot] = useState<PaySlot>('other')
  const [payAmount, setPayAmount] = useState('')
  const [payComment, setPayComment] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [staffRes, payRes] = await Promise.all([
      supabase
        .from('staff')
        .select('id,full_name,phone,email,role,short_name,monthly_salary,is_active')
        .order('full_name'),
      supabase
        .from('staff_salary_payments')
        .select('id,staff_id,pay_date,slot,amount,comment')
        .gte('pay_date', monthFrom)
        .lte('pay_date', monthTo)
        .order('pay_date', { ascending: true }),
    ])

    if (staffRes.error || payRes.error) {
      console.error(staffRes.error, payRes.error)
      setError('Не удалось загрузить сотрудников/выплаты (проверь RLS policies)')
      setStaff([])
      setPayments([])
      setLoading(false)
      return
    }

    const staffData = (staffRes.data || []) as Staff[]
    const payData = (payRes.data || []) as StaffPayment[]

    setStaff(staffData)
    setPayments(payData)

    // дефолт для формы выплаты
    if (!payStaffId && staffData.length > 0) setPayStaffId(staffData[0].id)

    setLoading(false)
  }, [monthFrom, monthTo, payStaffId])

  useEffect(() => {
    load()
  }, [load])

  // --- Быстрые подсчёты по выплатам ---
  const paymentsByStaff = useMemo(() => {
    const map = new Map<string, StaffPayment[]>()
    for (const p of payments) {
      const arr = map.get(p.staff_id) || []
      arr.push(p)
      map.set(p.staff_id, arr)
    }
    return map
  }, [payments])

  const paidSumByStaff = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of payments) {
      map.set(p.staff_id, (map.get(p.staff_id) || 0) + Number(p.amount || 0))
    }
    return map
  }, [payments])

  const activeStaffOptions = useMemo(
    () =>
      staff
        .filter((s) => s.is_active)
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ru')),
    [staff],
  )

  const handleAddStaff = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      const name = fullName.trim()
      if (!name) throw new Error('Введите ФИО')

      const ms = parseAmount(monthlySalary)
      if (!Number.isFinite(ms) || ms < 0) throw new Error('Введите оклад в месяц (0 или больше)')

      setSaving(true)

      const payload = {
        full_name: name,
        short_name: shortName.trim() || null,
        role,
        monthly_salary: Math.round(ms),
        is_active: true,
      }

      const { data, error } = await supabase
        .from('staff')
        .insert([payload])
        .select('id,full_name,phone,email,role,short_name,monthly_salary,is_active')
        .single()

      if (error) throw error

      setStaff((prev) => [...prev, data as Staff])
      setFullName('')
      setShortName('')
      setMonthlySalary('')
      setRole('manager')
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Ошибка при добавлении сотрудника')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (row: Staff) => {
    setError(null)
    try {
      const { data, error } = await supabase
        .from('staff')
        .update({ is_active: !row.is_active })
        .eq('id', row.id)
        .select('id,full_name,phone,email,role,short_name,monthly_salary,is_active')
        .single()

      if (error) throw error
      setStaff((prev) => prev.map((x) => (x.id === row.id ? (data as Staff) : x)))
    } catch (err) {
      console.error(err)
      setError('Не удалось изменить статус')
    }
  }

  const handleAddPayment = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      if (!payStaffId) throw new Error('Выберите сотрудника')
      if (!payDate) throw new Error('Выберите дату')

      const amount = parseAmount(payAmount)
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Введите сумму выплаты')

      setSaving(true)

      const payload = {
        staff_id: payStaffId,
        pay_date: payDate,
        slot: paySlot,
        amount: Math.round(amount),
        comment: payComment.trim() || null,
      }

      const { data, error } = await supabase
        .from('staff_salary_payments')
        .insert([payload])
        .select('id,staff_id,pay_date,slot,amount,comment')
        .single()

      if (error) throw error

      setPayments((prev) => [...prev, data as StaffPayment])
      setPayAmount('')
      setPayComment('')
      setPaySlot('other')
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Ошибка при добавлении выплаты')
    } finally {
      setSaving(false)
    }
  }

  const deletePayment = async (id: number) => {
    setError(null)
    try {
      const { error } = await supabase.from('staff_salary_payments').delete().eq('id', id)
      if (error) throw error
      setPayments((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      console.error(err)
      setError('Не удалось удалить выплату')
    }
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Users2 className="w-7 h-7 text-emerald-400" />
              <div>
                <h1 className="text-2xl font-bold">Сотрудники (месячный оклад)</h1>
                <p className="text-xs text-muted-foreground">
                  Здесь фиксируем ФАКТ выплат (частями / 1-го / 15-го). Никакой магии “оклад/2 вслепую”.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-lg px-2 py-1">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <input
                type="month"
                value={monthYM}
                onChange={(e) => setMonthYM(e.target.value)}
                className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
              />
            </div>
          </div>

          {error && (
            <Card className="p-3 border border-red-500/40 bg-red-950/40 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </Card>
          )}

          {/* Добавить сотрудника */}
          <Card className="p-4 border-border bg-card/80">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" /> Добавить сотрудника
            </h3>

            <form onSubmit={handleAddStaff} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="text-[11px] text-muted-foreground mb-1 block">ФИО</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="Напр.: Акбота"
                />
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Кратко</label>
                <input
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="Напр.: Акбота (рук.)"
                />
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Роль</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as StaffRole)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="manager">Руководитель</option>
                  <option value="marketer">Маркетолог</option>
                  <option value="owner">Собственник</option>
                  <option value="other">Другое</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Оклад в месяц</label>
                <input
                  type="number"
                  min="0"
                  value={monthlySalary}
                  onChange={(e) => setMonthlySalary(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="0"
                />
              </div>

              <div className="flex justify-end md:col-span-5">
                <Button
                  type="submit"
                  disabled={saving || !fullName.trim()}
                  className="h-10 px-4 text-sm flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {saving ? 'Сохранение...' : 'Добавить'}
                </Button>
              </div>
            </form>
          </Card>

          {/* Добавить выплату */}
          <Card className="p-4 border-border bg-card/80">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" /> Добавить выплату (факт)
            </h3>

            <form onSubmit={handleAddPayment} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="text-[11px] text-muted-foreground mb-1 block">Сотрудник</label>
                <select
                  value={payStaffId}
                  onChange={(e) => setPayStaffId(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                >
                  {activeStaffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.short_name || s.full_name || 'Без имени'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Дата</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Период</label>
                <select
                  value={paySlot}
                  onChange={(e) => setPaySlot(e.target.value as PaySlot)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="first">1-е число</option>
                  <option value="second">15-е число</option>
                  <option value="other">Другое</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Сумма</label>
                <input
                  type="number"
                  min="0"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="0"
                />
              </div>

              <div className="md:col-span-6">
                <label className="text-[11px] text-muted-foreground mb-1 block">Комментарий</label>
                <div className="flex gap-2">
                  <input
                    value={payComment}
                    onChange={(e) => setPayComment(e.target.value)}
                    className="flex-1 bg-input border border-border rounded-md px-3 py-2 text-sm"
                    placeholder="Напр.: часть зарплаты / аванс / доплата..."
                  />
                  <Button type="submit" disabled={saving} className="h-10 px-4 text-sm">
                    {saving ? 'Сохранение...' : 'Добавить'}
                  </Button>
                </div>
              </div>
            </form>
          </Card>

          {/* Таблица сотрудников + факт выплат */}
          <Card className="p-4 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 px-2 text-left">ФИО</th>
                  <th className="py-2 px-2 text-left">Роль</th>
                  <th className="py-2 px-2 text-right">Оклад/мес</th>
                  <th className="py-2 px-2 text-right">Выплачено ({monthYM})</th>
                  <th className="py-2 px-2 text-right">Осталось</th>
                  <th className="py-2 px-2 text-center">Статус</th>
                  <th className="py-2 px-2 text-right">Действие</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-muted-foreground text-xs">
                      Загрузка...
                    </td>
                  </tr>
                )}

                {!loading && staff.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-muted-foreground text-xs">
                      Сотрудников пока нет.
                    </td>
                  </tr>
                )}

                {!loading &&
                  staff
                    .slice()
                    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ru'))
                    .map((s) => {
                      const ms = Number(s.monthly_salary || 0)
                      const paid = paidSumByStaff.get(s.id) || 0
                      const left = Math.max(0, ms - paid)

                      const history = paymentsByStaff.get(s.id) || []

                      return (
                        <>
                          <tr key={s.id} className="border-t border-border/40 hover:bg-white/5">
                            <td className="py-2 px-2 font-medium">
                              {s.full_name || '—'}
                              {s.short_name ? (
                                <div className="text-[11px] text-muted-foreground">{s.short_name}</div>
                              ) : null}
                            </td>
                            <td className="py-2 px-2">
                              {s.role ? ROLE_LABEL[s.role] : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2 px-2 text-right">{money(ms)}</td>
                            <td className="py-2 px-2 text-right text-emerald-300">{money(paid)}</td>
                            <td className="py-2 px-2 text-right text-amber-300">{money(left)}</td>
                            <td className="py-2 px-2 text-center">
                              {s.is_active ? (
                                <span className="text-emerald-400 text-[11px]">Активен</span>
                              ) : (
                                <span className="text-muted-foreground text-[11px]">Выключен</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleActive(s)}
                                className="h-8 w-8"
                                title={s.is_active ? 'Выключить' : 'Включить'}
                              >
                                {s.is_active ? (
                                  <ToggleRight className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                                )}
                              </Button>
                            </td>
                          </tr>

                          {history.length > 0 && (
                            <tr className="border-t border-border/30">
                              <td colSpan={7} className="px-2 pb-2">
                                <div className="mt-2 rounded-lg border border-border/60 bg-card/40 p-3">
                                  <div className="text-[11px] text-muted-foreground mb-2">
                                    История выплат за {monthYM}:
                                  </div>
                                  <div className="space-y-2">
                                    {history.map((p) => (
                                      <div
                                        key={p.id}
                                        className="flex items-center justify-between gap-3 text-xs border border-border/40 rounded-md px-3 py-2"
                                      >
                                        <div className="min-w-0">
                                          <div className="font-medium">
                                            {p.pay_date} • {SLOT_LABEL[p.slot]}
                                          </div>
                                          {p.comment ? (
                                            <div className="text-[11px] text-muted-foreground truncate">
                                              {p.comment}
                                            </div>
                                          ) : null}
                                        </div>

                                        <div className="flex items-center gap-2">
                                          <div className="font-semibold text-emerald-300">
                                            {money(Number(p.amount || 0))}
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            title="Удалить выплату"
                                            onClick={() => deletePayment(p.id)}
                                          >
                                            <Trash2 className="w-4 h-4 text-red-300" />
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </div>
  )
}
