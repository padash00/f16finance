'use client'

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { Users2, Plus, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react'

type StaffRole = 'manager' | 'marketer' | 'owner' | 'other'

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

const money = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

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

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fullName, setFullName] = useState('')
  const [shortName, setShortName] = useState('')
  const [role, setRole] = useState<StaffRole>('manager')
  const [monthlySalary, setMonthlySalary] = useState('')

  const roleOptions = useMemo(
    () =>
      (Object.keys(ROLE_LABEL) as StaffRole[]).map((key) => ({
        value: key,
        label: ROLE_LABEL[key],
      })),
    [],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('staff')
      .select('id,full_name,phone,email,role,short_name,monthly_salary,is_active')
      .order('full_name')

    if (error) {
      console.error(error)
      setError('Не удалось загрузить сотрудников (проверь RLS policies)')
      setStaff([])
    } else {
      setStaff((data || []) as Staff[])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleAdd = async (e: FormEvent) => {
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
        role, // В БД уйдёт строго manager/marketer/owner/other
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

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <Users2 className="w-7 h-7 text-emerald-400" />
            <div>
              <h1 className="text-2xl font-bold">Сотрудники (месячный оклад)</h1>
              <p className="text-xs text-muted-foreground">
                Выплата: 1-го и 15-го числа (месячный оклад делится на 2)
              </p>
            </div>
          </div>

          {error && (
            <Card className="p-3 border border-red-500/40 bg-red-950/40 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </Card>
          )}

          <Card className="p-4 border-border bg-card/80">
            <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="text-[11px] text-muted-foreground mb-1 block">ФИО</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="Напр.: Сергей"
                />
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Кратко</label>
                <input
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="Напр.: Сергей (маркет)"
                />
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Роль</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as StaffRole)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                >
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
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

          <Card className="p-4 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 px-2 text-left">ФИО</th>
                  <th className="py-2 px-2 text-left">Кратко</th>
                  <th className="py-2 px-2 text-left">Роль</th>
                  <th className="py-2 px-2 text-right">Оклад/мес</th>
                  <th className="py-2 px-2 text-right">К выплате 1/15</th>
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
                  staff.map((s) => {
                    const ms = Number(s.monthly_salary || 0)
                    const half = Math.round(ms / 2)

                    return (
                      <tr key={s.id} className="border-t border-border/40 hover:bg-white/5">
                        <td className="py-1.5 px-2 font-medium">{s.full_name || '—'}</td>
                        <td className="py-1.5 px-2">
                          {s.short_name || <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-1.5 px-2">
                          {s.role ? ROLE_LABEL[s.role] : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right">{money(ms)}</td>
                        <td className="py-1.5 px-2 text-right text-emerald-300">{money(half)}</td>
                        <td className="py-1.5 px-2 text-center">
                          {s.is_active ? (
                            <span className="text-emerald-400 text-[11px]">Активен</span>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">Выключен</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right">
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
