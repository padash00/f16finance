'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  Activity,
  AlertCircle,
  ArrowUpCircle,
  ArrowDownCircle,
  Briefcase,
  Building2,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  Phone,
  Save,
  Send,
  ShieldCheck,
  User,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useModalEscape } from '@/lib/client/use-modal-escape'

type Position = { id: string; name: string; description: string | null; label?: string | null }
type Company = { id: string; name: string; code: string | null }

export type HrEmployee = {
  kind: 'operator' | 'staff'
  id: string
  full_name: string
  short_name: string | null
  position: string | null
  role: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  dismissed_at: string | null
  monthly_salary: number | null
  is_admin_staff?: boolean | null
  telegram_chat_id?: string | null
  hire_date?: string | null
  company_ids?: string[]
}

type Props = {
  employee: HrEmployee | null
  onClose: () => void
  onUpdated: () => void
}

const inputClass =
  'h-10 w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors'

export default function EmployeePanel({ employee, onClose, onUpdated }: Props) {
  const open = !!employee
  useModalEscape(open, onClose)

  const [positions, setPositions] = useState<Position[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // Form state
  const [fullName, setFullName] = useState('')
  const [shortName, setShortName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [telegramId, setTelegramId] = useState('')
  const [hireDate, setHireDate] = useState('')
  const [monthlySalary, setMonthlySalary] = useState('')
  const [companyIds, setCompanyIds] = useState<string[]>([])

  const [showPromote, setShowPromote] = useState(false)
  const [activeTab, setActiveTab] = useState<'edit' | 'activity'>('edit')
  const [activity, setActivity] = useState<{ events: any[]; shifts: any[]; debts: any[]; payments: any[] } | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)

  useEffect(() => {
    if (!employee) return
    setFullName(employee.full_name || '')
    setShortName(employee.short_name || '')
    setRole(employee.role || employee.position || '')
    setPhone(employee.phone || '')
    setEmail(employee.email || '')
    setTelegramId(employee.telegram_chat_id || '')
    setHireDate(employee.hire_date || '')
    setMonthlySalary(employee.monthly_salary != null ? String(employee.monthly_salary) : '')
    setCompanyIds(employee.company_ids || [])
    setError(null)
    setOkMsg(null)
    setShowPromote(false)
  }, [employee])

  // Загрузка справочников
  useEffect(() => {
    if (!open) return
    fetch('/api/admin/positions').then((r) => r.json()).then((d) => setPositions((d.data || []) as Position[])).catch(() => {})
    fetch('/api/admin/companies').then((r) => r.json()).then((d) => setCompanies((d.data || []) as Company[])).catch(() => {})
  }, [open])

  // Загрузка активности когда переключились на таб
  useEffect(() => {
    if (!employee || activeTab !== 'activity') return
    setActivityLoading(true)
    fetch(`/api/admin/hr/activity?kind=${employee.kind}&id=${employee.id}`)
      .then((r) => r.json())
      .then((d) => setActivity({ events: d.events || [], shifts: d.shifts || [], debts: d.debts || [], payments: d.payments || [] }))
      .catch(() => setActivity({ events: [], shifts: [], debts: [], payments: [] }))
      .finally(() => setActivityLoading(false))
  }, [employee, activeTab])

  if (!employee) return null

  const isOperator = employee.kind === 'operator'
  const isHybrid = isOperator && employee.is_admin_staff === true

  const typeLabel = isHybrid ? 'Hybrid' : isOperator ? 'Оператор' : 'Админ'
  const typeColor = isHybrid
    ? 'from-purple-500/20 to-fuchsia-500/10 text-purple-300 border-purple-500/30'
    : isOperator
      ? 'from-emerald-500/20 to-green-500/10 text-emerald-300 border-emerald-500/30'
      : 'from-blue-500/20 to-cyan-500/10 text-blue-300 border-blue-500/30'

  const save = async () => {
    setError(null)
    setOkMsg(null)
    setSaving(true)

    const body: any = {
      kind: employee.kind,
      id: employee.id,
      action: 'updateProfile',
      payload: {
        full_name: fullName.trim() || undefined,
        short_name: shortName.trim() || undefined,
        role: role.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        telegram_chat_id: telegramId.trim() || undefined,
        hire_date: hireDate || undefined,
      },
    }
    if (isOperator) {
      body.payload.company_ids = companyIds
    } else {
      const sal = Number(monthlySalary)
      if (Number.isFinite(sal) && sal >= 0) body.payload.monthly_salary = sal
    }

    try {
      const res = await fetch('/api/admin/hr/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Не удалось сохранить')
      setOkMsg('Сохранено')
      onUpdated()
      setTimeout(() => setOkMsg(null), 2000)
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  const promote = async () => {
    if (!confirm(`Повысить ${employee.full_name} до администратора?\nУ него появится оклад ${monthlySalary || 0} ₸ и доступ к админ-разделам.`)) return
    setActing('promote')
    setError(null)
    try {
      const sal = Number(monthlySalary) || 0
      const res = await fetch('/api/admin/hr/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'operator',
          id: employee.id,
          action: 'promote',
          payload: { role, monthly_salary: sal },
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Не удалось повысить')
      setOkMsg('Повышен до админа')
      onUpdated()
      setTimeout(() => setOkMsg(null), 2000)
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setActing(null)
    }
  }

  const demote = async () => {
    if (!confirm(`Понизить ${employee.full_name} до обычного оператора?\nОклад/админ-доступ снимутся.`)) return
    setActing('demote')
    setError(null)
    try {
      const res = await fetch('/api/admin/hr/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'operator',
          id: employee.id,
          action: 'demote',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Не удалось понизить')
      setOkMsg('Понижен до оператора')
      onUpdated()
      setTimeout(() => setOkMsg(null), 2000)
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setActing(null)
    }
  }

  const profileLink = isOperator ? `/operators/${employee.id}/profile` : `/staff?staffId=${employee.id}`

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-2xl my-8 bg-gray-900/95 border-gray-800 backdrop-blur shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 bg-gradient-to-r from-gray-900 to-gray-900/95 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/10 ring-1 ring-indigo-500/20 flex items-center justify-center shrink-0">
                <User className="w-6 h-6 text-indigo-300" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-white truncate">{employee.full_name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wider border bg-gradient-to-r ${typeColor}`}>
                    {typeLabel}
                  </span>
                  {employee.role && (
                    <span className="text-xs text-gray-400">{employee.role}</span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors text-gray-400 hover:text-white shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            <button
              onClick={() => setActiveTab('edit')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                activeTab === 'edit'
                  ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5 inline mr-1.5" />Редактировать
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                activeTab === 'activity'
                  ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5 inline mr-1.5" />Активность
            </button>
          </div>
        </div>

        {activeTab === 'activity' ? (
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            {activityLoading && !activity ? (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загружаем…
              </div>
            ) : !activity || (activity.events.length === 0 && activity.shifts.length === 0 && activity.payments.length === 0 && activity.debts.length === 0) ? (
              <div className="text-center py-12 text-sm text-gray-500">
                <Clock className="w-6 h-6 mx-auto mb-2 text-gray-600" />
                Событий пока нет
              </div>
            ) : (
              <>
                {/* Events / Audit log */}
                {activity.events.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">События HR</div>
                    <div className="space-y-1.5">
                      {activity.events.slice(0, 10).map((e: any) => (
                        <div key={e.id} className="px-3 py-2 rounded-md border border-gray-800 bg-gray-900/40 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-white capitalize">{actionRu(e.action)}</span>
                            <span className="text-gray-500">{new Date(e.created_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          {e.actor_name && <div className="text-gray-500 mt-0.5">от {e.actor_name}</div>}
                          {e.payload?.reason && <div className="text-gray-400 italic mt-0.5">«{e.payload.reason}»</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Shifts (operator) */}
                {activity.shifts.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Последние смены</div>
                    <div className="space-y-1">
                      {activity.shifts.slice(0, 10).map((s: any) => (
                        <div key={s.id} className="px-3 py-1.5 rounded-md bg-gray-900/40 border border-gray-800 text-xs flex items-center justify-between">
                          <span className="text-white">{new Date(s.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</span>
                          <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${s.shift_type === 'night' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-amber-500/15 text-amber-300'}`}>
                            {s.shift_type === 'night' ? 'Ночь' : 'День'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Debts (operator) */}
                {activity.debts.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Долги</div>
                    <div className="space-y-1">
                      {activity.debts.slice(0, 10).map((d: any) => (
                        <div key={d.id} className="px-3 py-1.5 rounded-md bg-red-500/5 border border-red-500/20 text-xs flex items-center justify-between">
                          <span className="text-red-300">{Math.round(d.amount).toLocaleString('ru-RU')} ₸</span>
                          <span className="text-gray-500">{d.week_start || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payments (staff) */}
                {activity.payments.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Выплаты</div>
                    <div className="space-y-1">
                      {activity.payments.slice(0, 10).map((p: any) => (
                        <div key={p.id} className="px-3 py-1.5 rounded-md bg-emerald-500/5 border border-emerald-500/20 text-xs flex items-center justify-between">
                          <span className="text-emerald-300">{Math.round(p.amount || 0).toLocaleString('ru-RU')} ₸</span>
                          <span className="text-gray-500">{p.pay_date}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {okMsg && (
            <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm flex items-center gap-2">
              <Check className="w-4 h-4" /> {okMsg}
            </div>
          )}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          {/* Базовое */}
          <Section icon={<Briefcase className="w-3.5 h-3.5" />} label="Основное">
            <div className="grid grid-cols-1 gap-2">
              <Field label="ФИО">
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Краткое имя">
                <input value={shortName} onChange={(e) => setShortName(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Должность">
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                  {positions.length === 0 && <option>{role || 'Загрузка…'}</option>}
                  {positions.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.label || p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Дата найма">
                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="date"
                    value={hireDate}
                    onChange={(e) => setHireDate(e.target.value)}
                    className={inputClass + ' pl-9'}
                  />
                </div>
              </Field>
            </div>
          </Section>

          {/* Контакты */}
          <Section icon={<Phone className="w-3.5 h-3.5" />} label="Контакты">
            <div className="grid grid-cols-1 gap-2">
              <Field label="Телефон">
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass + ' pl-9'} />
                </div>
              </Field>
              <Field label="Email">
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass + ' pl-9'} />
                </div>
              </Field>
              <Field label="Telegram chat ID">
                <div className="relative">
                  <Send className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={telegramId}
                    onChange={(e) => setTelegramId(e.target.value)}
                    className={inputClass + ' pl-9 font-mono text-sm'}
                    placeholder="напр. 1357970983"
                  />
                </div>
              </Field>
            </div>
          </Section>

          {/* Точки (только operator) */}
          {isOperator && (
            <Section icon={<Building2 className="w-3.5 h-3.5" />} label="Точки">
              <div className="grid grid-cols-1 gap-1.5">
                {companies.length === 0 && <div className="text-sm text-gray-500">Загрузка…</div>}
                {companies.map((c) => {
                  const checked = companyIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setCompanyIds((prev) =>
                          prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                        )
                      }
                      className={`px-3 py-2 rounded-lg border text-left text-sm transition flex items-center gap-2 ${
                        checked
                          ? 'border-indigo-500/50 bg-indigo-500/10 text-white'
                          : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          checked ? 'border-indigo-400 bg-indigo-500/30' : 'border-gray-600'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-indigo-300" />}
                      </div>
                      <span>{c.name}</span>
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Зарплата (только staff или hybrid) */}
          {(!isOperator || isHybrid) && (
            <Section icon={<Wallet className="w-3.5 h-3.5" />} label="Зарплата">
              <Field label="Месячный оклад (₸)">
                <input
                  type="number"
                  value={monthlySalary}
                  onChange={(e) => setMonthlySalary(e.target.value)}
                  placeholder="0"
                  className={inputClass}
                />
              </Field>
            </Section>
          )}

          {/* Действия — повышение/понижение для оператора */}
          {isOperator && (
            <Section icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Карьера">
              {!isHybrid ? (
                <>
                  <p className="text-xs text-gray-500 mb-2">
                    Повышение даст оклад и доступ к админ-разделам в дополнение к работе на сменах.
                  </p>
                  <Button
                    onClick={promote}
                    disabled={acting === 'promote'}
                    className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white"
                  >
                    {acting === 'promote' ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ArrowUpCircle className="w-4 h-4 mr-2" />
                    )}
                    Повысить до админ-сотрудника
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-2">
                    Понижение снимет статус админ-сотрудника. Оклад и админ-доступ исчезнут.
                  </p>
                  <Button
                    onClick={demote}
                    disabled={acting === 'demote'}
                    variant="outline"
                    className="w-full border-orange-500/30 text-orange-300 hover:bg-orange-500/10"
                  >
                    {acting === 'demote' ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ArrowDownCircle className="w-4 h-4 mr-2" />
                    )}
                    Понизить до обычного оператора
                  </Button>
                </>
              )}
            </Section>
          )}

          {/* Deep-link на полный профиль */}
          <Link
            href={profileLink}
            className="block px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/60 transition group"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-300 flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-white" />
                Открыть полный профиль
              </span>
              <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white" />
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Документы, зарплата, карьерная история</div>
          </Link>
        </div>
        )}

        {/* Footer with Save (только для edit таба) */}
        {activeTab === 'edit' && (
        <div className="px-5 py-4 border-t border-gray-800 bg-gray-900/95 shrink-0">
          <Button
            onClick={save}
            disabled={saving}
            className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-lg shadow-indigo-500/20"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Сохраняем…
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Сохранить изменения
              </>
            )}
          </Button>
        </div>
        )}
      </Card>
    </div>,
    document.body,
  )
}

function actionRu(action: string): string {
  const map: Record<string, string> = {
    create: 'Найм',
    update: 'Редактирование',
    dismiss: 'Увольнение',
    restore: 'Восстановление',
    promote: 'Повышение',
    demote: 'Понижение',
    change_role: 'Смена должности',
  }
  return map[action] || action
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
        {icon} {label}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}
