'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Phone,
  Send,
  Shuffle,
  User,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useModalEscape } from '@/lib/client/use-modal-escape'

type HireType = 'operator' | 'staff'

type Position = { id: string; name: string; description: string | null; label?: string | null }
type Company = { id: string; name: string; code: string | null }

type HireSuccess = {
  id: string
  type: HireType
  username?: string
  password?: string
  full_name: string
}

type Props = {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const PASSWORD_HINT_LEN = 10

function genPassword(len = PASSWORD_HINT_LEN): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const all = upper + lower + digits
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  let pwd = ''
  pwd += upper[arr[0] % upper.length]
  pwd += lower[arr[1] % lower.length]
  pwd += digits[arr[2] % digits.length]
  for (let i = 3; i < len; i++) pwd += all[arr[i] % all.length]
  return pwd
}

export default function HireModal({ open, onClose, onCreated }: Props) {
  useModalEscape(open, onClose)

  const [type, setType] = useState<HireType>('operator')
  const [positions, setPositions] = useState<Position[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<HireSuccess | null>(null)

  // Form fields
  const [fullName, setFullName] = useState('')
  const [shortName, setShortName] = useState('')
  const [role, setRole] = useState('')
  const [hireDate, setHireDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [telegramId, setTelegramId] = useState('')
  // operator-only
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [companyIds, setCompanyIds] = useState<string[]>([])
  // staff-only
  const [monthlySalary, setMonthlySalary] = useState('')

  // Reset на открытии
  useEffect(() => {
    if (!open) return
    setType('operator')
    setFullName('')
    setShortName('')
    setRole('')
    setHireDate(new Date().toISOString().slice(0, 10))
    setPhone('')
    setEmail('')
    setTelegramId('')
    setUsername('')
    setPassword(genPassword())
    setShowPassword(false)
    setCompanyIds([])
    setMonthlySalary('')
    setError(null)
    setSuccess(null)
  }, [open])

  // Загрузка справочников
  useEffect(() => {
    if (!open) return
    fetch('/api/admin/positions')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.data || []) as Position[]
        setPositions(list)
        if (list.length > 0 && !role) {
          // Дефолт: operator → первая роль с "operator"/"кассир" в имени, иначе первая
          const op = list.find((p) =>
            /operator|cashier|кассир|оператор/i.test(p.name + ' ' + (p.label || '')),
          )
          setRole(op?.name || list[0].name)
        }
      })
      .catch(() => {})

    fetch('/api/admin/companies')
      .then((r) => r.json())
      .then((d) => setCompanies((d.data || []) as Company[]))
      .catch(() => {})
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const submit = async () => {
    setError(null)
    if (fullName.trim().length < 2) {
      setError('Введите ФИО')
      return
    }
    if (!role) {
      setError('Выберите должность')
      return
    }
    if (type === 'operator' && companyIds.length === 0) {
      setError('Выберите хотя бы одну точку для оператора')
      return
    }
    setSubmitting(true)

    const body: Record<string, unknown> = {
      type,
      full_name: fullName.trim(),
      short_name: shortName.trim() || undefined,
      role,
      hire_date: hireDate,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      telegram_chat_id: telegramId.trim() || undefined,
    }
    if (type === 'operator') {
      body.username = username.trim() || undefined
      body.company_ids = companyIds
    } else {
      const sal = Number(monthlySalary)
      if (Number.isFinite(sal) && sal > 0) body.monthly_salary = sal
    }

    try {
      const res = await fetch('/api/admin/hr/hire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || 'Не удалось создать')
        setSubmitting(false)
        return
      }
      setSuccess({
        id: data.id,
        type: data.type,
        username: data.username,
        password: data.password,
        full_name: fullName.trim(),
      })
      onCreated()
    } catch (e: any) {
      setError(e?.message || 'Ошибка сети')
    } finally {
      setSubmitting(false)
    }
  }

  if (typeof document === 'undefined') return null

  // Success view
  if (success) {
    return createPortal(
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={() => {
          setSuccess(null)
          onClose()
        }}
      >
        <Card
          className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto p-6 bg-gradient-to-br from-emerald-50 via-white to-white dark:from-emerald-950/80 dark:via-gray-900 dark:to-gray-900 border-emerald-500/30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4 ring-4 ring-emerald-500/10">
              <CheckCircle2 className="w-9 h-9 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Сотрудник создан</h2>
            <p className="text-sm text-gray-400 mb-5">{success.full_name}</p>

            {success.username && success.password && (
              <div className="w-full space-y-2 mb-5">
                <CredField label="Логин" value={success.username} />
                <CredField label="Пароль" value={success.password} mono />
                <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-2 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Передайте пароль оператору. После закрытия он не сохранится в системе.</span>
                </p>
              </div>
            )}

            <Button
              onClick={() => {
                setSuccess(null)
                onClose()
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Готово
            </Button>
          </div>
        </Card>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-2xl my-8 bg-white dark:bg-gray-900/95 border-slate-200 dark:border-gray-800 backdrop-blur shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 py-5 border-b border-slate-200 dark:border-gray-800 bg-gradient-to-r from-indigo-50 via-white to-white dark:from-indigo-900/30 dark:via-gray-900 dark:to-gray-900">
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center ring-1 ring-indigo-500/30">
                <UserPlus className="w-5 h-5 text-indigo-300" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Нанять сотрудника</h2>
                <p className="text-xs text-gray-400">Один экран — профиль, логин, должность</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-gray-400 hover:text-slate-900 dark:hover:text-white"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Type toggle */}
          <div>
            <SectionLabel icon={<User className="w-3.5 h-3.5" />}>Тип сотрудника</SectionLabel>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <TypeCard
                active={type === 'operator'}
                title="Оператор"
                desc="На сменах, ЗП по сменам"
                icon="🧑‍💼"
                onClick={() => setType('operator')}
              />
              <TypeCard
                active={type === 'staff'}
                title="Админ-сотрудник"
                desc="Оклад, не на смене"
                icon="👔"
                onClick={() => setType('staff')}
              />
            </div>
          </div>

          {/* Базовое */}
          <div>
            <SectionLabel icon={<Briefcase className="w-3.5 h-3.5" />}>Основное</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              <Field label="ФИО *" wide>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Например: Сарсенгазинова Алима"
                  className={inputClass}
                />
              </Field>
              <Field label="Краткое имя">
                <input
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  placeholder="Алима"
                  className={inputClass}
                />
              </Field>
              <Field label="Должность *">
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                  {positions.length === 0 && <option>Загрузка…</option>}
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
          </div>

          {/* Контакты */}
          <div>
            <SectionLabel icon={<Phone className="w-3.5 h-3.5" />}>Контакты</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              <Field label="Телефон">
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 707 123 4567"
                    className={inputClass + ' pl-9'}
                  />
                </div>
              </Field>
              <Field label="Email">
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alima@example.com"
                    className={inputClass + ' pl-9'}
                  />
                </div>
              </Field>
              <Field label="Telegram chat ID" wide>
                <div className="relative">
                  <Send className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={telegramId}
                    onChange={(e) => setTelegramId(e.target.value)}
                    placeholder="1357970983 (узнать через @userinfobot)"
                    className={inputClass + ' pl-9 font-mono text-sm'}
                  />
                </div>
              </Field>
            </div>
          </div>

          {/* Operator: Доступ */}
          {type === 'operator' && (
            <div>
              <SectionLabel icon={<Lock className="w-3.5 h-3.5" />}>
                Доступ в приложение оператора
              </SectionLabel>
              <p className="text-xs text-gray-500 mb-2 mt-1">
                Если поля пустые — мы сгенерируем логин и пароль автоматически.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Логин (опционально)">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="будет сгенерирован"
                    className={inputClass + ' font-mono'}
                  />
                </Field>
                <Field label="Пароль">
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="auto"
                      className={inputClass + ' pr-20 font-mono'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-9 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-slate-900 dark:hover:text-white"
                      title={showPassword ? 'Скрыть' : 'Показать'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPassword(genPassword())}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-slate-900 dark:hover:text-white"
                      title="Сгенерировать новый"
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                  </div>
                </Field>
              </div>
            </div>
          )}

          {/* Operator: Точки */}
          {type === 'operator' && (
            <div>
              <SectionLabel icon={<Building2 className="w-3.5 h-3.5" />}>
                Точки * (на каких работает)
              </SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                {companies.length === 0 && (
                  <div className="col-span-full text-sm text-gray-500">Загрузка…</div>
                )}
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
                      className={`px-3 py-2.5 rounded-lg border text-left text-sm transition ${
                        checked
                          ? 'border-indigo-500/50 bg-indigo-500/10 text-slate-900 dark:text-white'
                          : 'border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 text-slate-500 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center ${
                            checked ? 'border-indigo-400 bg-indigo-500/30' : 'border-slate-300 dark:border-gray-600'
                          }`}
                        >
                          {checked && <Check className="w-3 h-3 text-indigo-300" />}
                        </div>
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Staff: Зарплата */}
          {type === 'staff' && (
            <div>
              <SectionLabel icon={<Wallet className="w-3.5 h-3.5" />}>Зарплата</SectionLabel>
              <Field label="Месячный оклад (₸)">
                <input
                  type="number"
                  inputMode="numeric"
                  value={monthlySalary}
                  onChange={(e) => setMonthlySalary(e.target.value)}
                  placeholder="350000"
                  className={inputClass}
                />
              </Field>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-gray-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-gray-900/50">
          <Button variant="outline" onClick={onClose} disabled={submitting} className="border-slate-200 dark:border-gray-700">
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-lg shadow-indigo-500/20"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Создаём…
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Создать
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>,
    document.body,
  )
}

// ============ Helpers UI ============

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-3 text-sm text-slate-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors'

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
      {icon}
      {children}
    </div>
  )
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="block text-xs text-slate-500 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function TypeCard({
  active,
  title,
  desc,
  icon,
  onClick,
}: {
  active: boolean
  title: string
  desc: string
  icon: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-4 rounded-xl border text-left transition-all ${
        active
          ? 'border-indigo-500/60 bg-gradient-to-br from-indigo-500/15 to-blue-500/10 ring-1 ring-indigo-500/30 shadow-lg shadow-indigo-500/10'
          : 'border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 hover:border-slate-300 dark:hover:border-gray-600'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl">{icon}</div>
        <div className="flex-1">
          <div className={`font-semibold text-sm ${active ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-gray-300'}`}>{title}</div>
          <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
        </div>
        {active && (
          <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center shrink-0">
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
      </div>
    </button>
  )
}

function CredField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800">
      <div className="flex-1 min-w-0 text-left">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
        <div className={`text-sm text-slate-900 dark:text-white truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
      </div>
      <button
        onClick={copy}
        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0"
        title="Скопировать"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  )
}
