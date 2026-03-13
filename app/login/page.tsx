'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeOperatorUsername, toOperatorAuthEmail } from '@/lib/core/auth'
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Shield,
  User,
} from 'lucide-react'

type LoginMode = 'email' | 'operator'

const MODE_META: Record<LoginMode, { title: string; hint: string; icon: any }> = {
  email: {
    title: 'Вход по email',
    hint: 'Для руководителя, маркетолога, владельца и остальных сотрудников админ-команды.',
    icon: Shield,
  },
  operator: {
    title: 'Вход оператора',
    hint: 'Для операторского кабинета по логину, который выдал администратор.',
    icon: User,
  },
}

export default function UnifiedLoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<LoginMode>('email')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const modeMeta = MODE_META[mode]
  const ModeIcon = modeMeta.icon
  const loginPlaceholder = mode === 'email' ? 'name@example.com' : 'login_operatora'

  const helperText = useMemo(() => {
    if (mode === 'email') {
      return 'Если вас пригласили по почте, сначала откройте письмо, задайте пароль, затем вернитесь сюда.'
    }

    return 'Оператор входит по логину и паролю. Почта здесь не нужна.'
  }, [mode])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (mode === 'email') {
        const email = login.trim().toLowerCase()
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) throw error

        await fetch('/api/auth/login-attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'email', target: 'staff', status: 'success', identifier: email }),
        }).catch(() => null)

        await fetch('/api/auth/login-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'email', target: 'staff' }),
        }).catch(() => null)

        const response = await fetch('/api/auth/session-role').catch(() => null)
        const json = await response?.json().catch(() => null)
        const defaultPath = response?.ok && json?.defaultPath ? String(json.defaultPath) : '/'

        router.push(defaultPath)
        router.refresh()
        return
      }

      const username = normalizeOperatorUsername(login)

      const { data: authData, error: authError } = await supabase
        .from('operator_auth')
        .select('id')
        .eq('username', username)
        .eq('is_active', true)
        .maybeSingle()

      if (authError) throw authError
      if (!authData) throw new Error('Неверный логин или пароль')

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: toOperatorAuthEmail(username),
        password,
      })

      if (signInError) throw new Error('Неверный логин или пароль')

      await fetch('/api/auth/login-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'operator', target: 'operator', status: 'success', identifier: username }),
      }).catch(() => null)

      await fetch('/api/auth/login-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'operator', target: 'operator' }),
      }).catch(() => null)

      await fetch('/api/auth/operator-last-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authId: authData.id }),
      })

      router.push('/operator-dashboard')
      router.refresh()
    } catch (err: any) {
      console.error('Login error:', err)
      await fetch('/api/auth/login-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: mode === 'email' ? 'email' : 'operator',
          target: mode === 'email' ? 'staff' : 'operator',
          status: 'failed',
          identifier: mode === 'email' ? login.trim().toLowerCase() : normalizeOperatorUsername(login),
          reason: err?.message || null,
        }),
      }).catch(() => null)
      setError(
        err?.message ||
          (mode === 'email'
            ? 'Не удалось войти по email. Проверьте пароль или запросите письмо заново.'
            : 'Не удалось войти по логину оператора.'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.16),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="hidden overflow-hidden border-white/10 bg-slate-950/55 p-8 text-white backdrop-blur-xl lg:block">
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-6 inline-flex rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 p-4 shadow-lg shadow-violet-500/20">
                  <Brain className="h-8 w-8 text-white" />
                </div>

                <h1 className="max-w-md text-4xl font-semibold leading-tight text-white">
                  Один вход для команды и отдельный вход для операторов.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
                  Если сотрудник получил письмо, ему нужно открыть ссылку, задать пароль и после этого войти по email.
                  Операторы продолжают входить по своему логину.
                </p>
              </div>

              <div className="grid gap-3">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-medium text-white">Сотрудники админ-команды</p>
                  <p className="mt-1 text-sm text-slate-400">Email из письма, новый пароль, затем доступ по своей роли.</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-medium text-white">Операторы</p>
                  <p className="mt-1 text-sm text-slate-400">Логин оператора и пароль от операторского аккаунта.</p>
                </div>
                <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  Если письмо просрочилось, администратор может отправить его заново или сделать сброс пароля.
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl sm:p-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-4 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 p-4 shadow-lg shadow-violet-500/20">
                <Brain className="h-7 w-7 text-white" />
              </div>
              <h2 className="text-2xl font-semibold">Вход в F16 Finance</h2>
              <p className="mt-2 max-w-sm text-sm text-slate-400">
                Выберите свой тип входа и используйте тот способ, который вам выдал администратор.
              </p>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('email')
                  setError(null)
                }}
                className={`rounded-xl px-4 py-3 text-left transition ${
                  mode === 'email' ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/20' : 'text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4" />
                  По email
                </div>
                <p className="mt-1 text-xs opacity-80">Сотрудники и руководство</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('operator')
                  setError(null)
                }}
                className={`rounded-xl px-4 py-3 text-left transition ${
                  mode === 'operator' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <User className="h-4 w-4" />
                  По логину
                </div>
                <p className="mt-1 text-xs opacity-80">Операторский кабинет</p>
              </button>
            </div>

            <div className="mb-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ModeIcon className="h-4 w-4 text-violet-300" />
                {modeMeta.title}
              </div>
              <p className="mt-2 text-sm text-slate-400">{modeMeta.hint}</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">{mode === 'email' ? 'Email' : 'Логин оператора'}</label>
                <div className="relative">
                  {mode === 'email' ? (
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  ) : (
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  )}
                  <Input
                    type={mode === 'email' ? 'email' : 'text'}
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    className="border-white/10 bg-slate-900/60 pl-10 text-white"
                    placeholder={loginPlaceholder}
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">Пароль</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-white/10 bg-slate-900/60 pl-10 pr-10 text-white"
                    placeholder="Введите пароль"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500">{helperText}</p>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className={`w-full ${mode === 'email' ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600' : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600'} text-white`}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Войти
              </Button>
            </form>

            <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
              <p className="font-medium text-white">Если письмо уже пришло</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Откройте письмо от системы.</li>
                <li>Перейдите по ссылке и задайте пароль.</li>
                <li>Вернитесь сюда и войдите по email и новому паролю.</li>
              </ol>
            </div>

            <div className="mt-5 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <Link href="/forgot-password" className="text-violet-400 hover:text-violet-300">
                Забыли пароль?
              </Link>
              <span className="text-slate-500">Нет доступа? Обратитесь к администратору</span>
            </div>

            <p className="mt-6 text-center text-[11px] text-slate-600">F16 Finance • Единый вход для сотрудников и операторов</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
