'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2, Mail, Save, ShieldCheck, User } from 'lucide-react'

import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

type SessionInfo = {
  email: string | null
  displayName: string | null
  isSuperAdmin: boolean
  isStaff: boolean
  staffRole: string | null
  roleLabel: string | null
  activeOrganization: { id: string; name: string; slug: string } | null
}

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null

export default function ProfilePage() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // ── Имя ───────────────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameNotice, setNameNotice] = useState<Notice>(null)

  // ── Email ─────────────────────────────────────────────────────────────────
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailNotice, setEmailNotice] = useState<Notice>(null)

  // ── Пароль ────────────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch('/api/auth/session-role')
        const json = await response.json().catch(() => null)
        if (!active) return
        if (response.ok && json?.ok) {
          setSession({
            email: json.email || null,
            displayName: json.displayName || null,
            isSuperAdmin: !!json.isSuperAdmin,
            isStaff: !!json.isStaff,
            staffRole: json.staffRole || null,
            roleLabel: json.roleLabel || null,
            activeOrganization: json.activeOrganization || null,
          })
          setFullName(json.displayName || '')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const handleSaveName = async () => {
    if (!fullName.trim()) {
      setNameNotice({ tone: 'error', text: 'Имя не может быть пустым' })
      return
    }
    setSavingName(true)
    setNameNotice(null)
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim() }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${response.status}`)
      }
      setNameNotice({ tone: 'success', text: 'Имя обновлено' })
      setSession((prev) => (prev ? { ...prev, displayName: fullName.trim() } : prev))
    } catch (e: any) {
      setNameNotice({ tone: 'error', text: e?.message || 'Не удалось сохранить' })
    } finally {
      setSavingName(false)
    }
  }

  const handleChangeEmail = async () => {
    const trimmed = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailNotice({ tone: 'error', text: 'Некорректный email' })
      return
    }
    if (trimmed === session?.email?.toLowerCase()) {
      setEmailNotice({ tone: 'error', text: 'Это уже ваш текущий email' })
      return
    }
    // Супер-админ — двойное подтверждение, потому что права привязаны к email.
    if (session?.isSuperAdmin) {
      const ok = window.confirm(
        `ВНИМАНИЕ: Вы супер-администратор.\n\nВаши права привязаны к email "${session.email}" через переменную окружения ADMIN_EMAILS на Vercel.\n\nПЕРЕД сменой email нужно ОБЯЗАТЕЛЬНО:\n1. Открыть Vercel → Project → Settings → Environment Variables\n2. Добавить новый email "${trimmed}" в ADMIN_EMAILS (через запятую, рядом со старым)\n3. Передеплоить проект (или подождать следующий деплой)\n\nИначе после клика по ссылке подтверждения вы ПОТЕРЯЕТЕ права супер-админа.\n\nПродолжить отправку подтверждения?`,
      )
      if (!ok) return
    }
    setSavingEmail(true)
    setEmailNotice(null)
    try {
      const { error } = await supabase.auth.updateUser({ email: trimmed })
      if (error) throw error
      setEmailNotice({
        tone: 'success',
        text: 'Письмо подтверждения отправлено на новый адрес. Email сменится после клика по ссылке.',
      })
      setNewEmail('')
    } catch (e: any) {
      setEmailNotice({ tone: 'error', text: e?.message || 'Не удалось сменить email' })
    } finally {
      setSavingEmail(false)
    }
  }

  const handleChangePassword = async () => {
    if (!session?.email) {
      setPasswordNotice({ tone: 'error', text: 'Email не определён' })
      return
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordNotice({
        tone: 'error',
        text: 'Минимум 8 символов, должны быть буквы и цифры',
      })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordNotice({ tone: 'error', text: 'Новые пароли не совпадают' })
      return
    }
    if (newPassword === currentPassword) {
      setPasswordNotice({ tone: 'error', text: 'Новый пароль должен отличаться от текущего' })
      return
    }

    setSavingPassword(true)
    setPasswordNotice(null)
    try {
      // Шаг 1: re-authenticate через текущий пароль
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: session.email,
        password: currentPassword,
      })
      if (signInError) {
        throw new Error('Текущий пароль неверный')
      }

      // Шаг 2: обновить пароль
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError

      setPasswordNotice({ tone: 'success', text: 'Пароль успешно обновлён' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      setPasswordNotice({ tone: 'error', text: e?.message || 'Не удалось сменить пароль' })
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="app-page flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-xl border-white/10 bg-slate-950/70 p-6 text-white">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
            Загружаем профиль…
          </div>
        </Card>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app-page">
        <Card className="border-white/10 bg-slate-950/70 p-6 text-white">
          <p>Не удалось загрузить данные сессии. Перезайдите.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="app-page-tight space-y-6">
      {/* Шапка */}
      <AdminPageHeader
        title={session.displayName || session.email || 'Профиль'}
        description="Личные данные, email и пароль"
        icon={<User className="h-5 w-5" />}
        accent="blue"
        backHref="/"
        actions={
          <>
            {session.roleLabel ? (
              <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-0.5 text-xs font-medium text-violet-200">
                {session.roleLabel}
              </span>
            ) : null}
            {session.activeOrganization ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-0.5 text-xs text-slate-300">
                {session.activeOrganization.name}
              </span>
            ) : null}
            {session.isSuperAdmin ? (
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-0.5 text-xs font-medium text-amber-200">
                Супер-админ
              </span>
            ) : null}
          </>
        }
      />

      {/* Имя */}
      <Card className="border-white/10 bg-slate-950/70 p-6 text-white">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
            <User className="h-5 w-5 text-blue-300" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Имя</h2>
            <p className="text-xs text-slate-500">Будет видно везде в системе</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor="fullName" className="text-xs text-slate-400">
              Полное имя
            </Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Иван Петров"
              className="mt-1 bg-slate-900/80 border-white/10"
              maxLength={200}
            />
          </div>
          {nameNotice ? (
            <div className={noticeClass(nameNotice.tone)}>{nameNotice.text}</div>
          ) : null}
          <Button
            onClick={handleSaveName}
            disabled={savingName || !fullName.trim() || fullName.trim() === (session.displayName || '')}
            className="bg-blue-600 hover:bg-blue-500"
          >
            {savingName ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Сохранить
          </Button>
        </div>
      </Card>

      {/* Email */}
      <Card className="border-white/10 bg-slate-950/70 p-6 text-white">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
            <Mail className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Email и логин</h2>
            <p className="text-xs text-slate-500">
              Текущий: <span className="text-slate-300">{session.email || '—'}</span>
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {session.isSuperAdmin ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Внимание — вы супер-администратор
              </div>
              <p className="text-xs leading-5 text-amber-100/90">
                Ваши права привязаны к email через переменную <code className="rounded bg-black/30 px-1">ADMIN_EMAILS</code> на Vercel.
                Перед сменой email <strong>обязательно</strong> добавьте новый адрес в эту переменную и передеплойте проект — иначе после подтверждения вы потеряете супер-админ права.
              </p>
            </div>
          ) : null}
          <div>
            <Label htmlFor="newEmail" className="text-xs text-slate-400">
              Новый email
            </Label>
            <Input
              id="newEmail"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="new@example.com"
              className="mt-1 bg-slate-900/80 border-white/10"
              autoComplete="email"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              На новый адрес придёт письмо с подтверждением. Email сменится только после клика по ссылке.
            </p>
          </div>
          {emailNotice ? (
            <div className={noticeClass(emailNotice.tone)}>{emailNotice.text}</div>
          ) : null}
          <Button
            onClick={handleChangeEmail}
            disabled={savingEmail || !newEmail.trim()}
            className="bg-emerald-600 hover:bg-emerald-500"
          >
            {savingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Отправить подтверждение
          </Button>
        </div>
      </Card>

      {/* Пароль */}
      <Card className="border-white/10 bg-slate-950/70 p-6 text-white">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10">
            <KeyRound className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Сменить пароль</h2>
            <p className="text-xs text-slate-500">Для подтверждения нужен текущий пароль</p>
          </div>
        </div>
        <div className="space-y-3">
          <PasswordInput
            id="currentPassword"
            label="Текущий пароль"
            value={currentPassword}
            onChange={setCurrentPassword}
            show={showCurrent}
            onToggleShow={() => setShowCurrent((v) => !v)}
            autoComplete="current-password"
          />
          <PasswordInput
            id="newPassword"
            label="Новый пароль"
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            onToggleShow={() => setShowNew((v) => !v)}
            autoComplete="new-password"
            hint="Минимум 8 символов, обязательно буквы и цифры"
          />
          <PasswordInput
            id="confirmPassword"
            label="Повторите новый пароль"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showNew}
            onToggleShow={() => setShowNew((v) => !v)}
            autoComplete="new-password"
          />
          {passwordNotice ? (
            <div className={noticeClass(passwordNotice.tone)}>{passwordNotice.text}</div>
          ) : null}
          <Button
            onClick={handleChangePassword}
            disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="bg-amber-600 hover:bg-amber-500"
          >
            {savingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Сменить пароль
          </Button>
        </div>
      </Card>
    </div>
  )
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  show: boolean
  onToggleShow: () => void
  autoComplete?: string
  hint?: string
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs text-slate-400">
        {label}
      </Label>
      <div className="relative mt-1">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="bg-slate-900/80 border-white/10 pr-10"
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  )
}

function noticeClass(tone: 'success' | 'error' | 'info'): string {
  if (tone === 'success') {
    return 'rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300'
  }
  if (tone === 'error') {
    return 'rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300'
  }
  return 'rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-300'
}
