'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeOperatorUsername, toOperatorAuthEmail } from '@/lib/core/auth'
import { SITE_NAME } from '@/lib/core/site'
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Shield,
  Sparkles,
  User,
} from 'lucide-react'

type LoginMode = 'email' | 'operator'
type HostOrg = { name: string; slug: string } | null

function TenantIdentityPanel({ hostOrg }: { hostOrg: NonNullable<HostOrg> }) {
  const initials = hostOrg.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || '')
    .join('') || hostOrg.name.slice(0, 2).toUpperCase()

  return (
    <div className="rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 text-white shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-amber-200">
        <Sparkles className="h-3.5 w-3.5" />
        Кабинет организации
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 via-orange-400 to-rose-500 text-xl font-bold text-slate-950 shadow-lg shadow-amber-500/25">
          {initials}
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white">{hostOrg.name}</h1>
          <p className="mt-1 text-sm text-slate-300">{hostOrg.slug}.ordaops.kz</p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/10 p-4">
          <div className="text-sm font-medium text-emerald-200">Доступ только для вашей команды</div>
          <p className="mt-2 text-sm leading-6 text-slate-200">
            На этом поддомене открывается только рабочий контур организации. После входа вы попадёте прямо в свой кабинет,
            без общего списка клиентов и без доступа к другим организациям.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Shield className="h-4 w-4 text-violet-300" />
              Руководство и staff
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-300">Вход по приглашённому email и личному паролю.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <User className="h-4 w-4 text-emerald-300" />
              Операторы
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-300">Вход по операторскому логину и выданному паролю.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-300">
          Если вы открыли не свой поддомен, система не пустит вас в чужую организацию даже при правильном логине.
        </div>
      </div>
    </div>
  )
}

function TenantNotFound({ platformUrl }: { platformUrl: string }) {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4 text-white">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center">
        <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/75 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-400/10 text-amber-300">
            <Building2 className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em]">Организация не найдена</h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Этот поддомен не привязан к рабочему контуру клиента или ещё не настроен. Перейдите на основной домен
            платформы или используйте корректный адрес вашей организации.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild className="bg-amber-500 text-slate-950 hover:bg-amber-400">
              <Link href={platformUrl}>Перейти на платформу</Link>
            </Button>
            <Button asChild variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">
              <Link href={`${platformUrl.replace(/\/$/, '')}/login`}>Открыть общий вход</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginForm({
  hostOrg,
  isTenantSubdomain,
  platformUrl,
}: {
  hostOrg: HostOrg
  isTenantSubdomain: boolean
  platformUrl: string
}) {
  const [mode, setMode] = useState<LoginMode>('email')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const helperText = useMemo(() => {
    return mode === 'email'
      ? 'Для владельца, менеджера, маркетолога и других сотрудников организации.'
      : 'Для операторов и сотрудников смены, которые входят по логину.'
  }, [mode])

  const navigateAfterLogin = (path: string) => {
    // Full navigation avoids a race where Supabase SSR cookies are not yet
    // visible to middleware during an immediate RSC transition after sign-in.
    window.location.assign(path)
  }

  const resolvePostLoginPath = async (fallback: string) => {
    const response = await fetch('/api/auth/session-role', { method: 'GET' }).catch(() => null)
    if (!response?.ok) return fallback
    const payload = await response.json().catch(() => null)
    const nextPath = typeof payload?.defaultPath === 'string' ? payload.defaultPath : null
    return nextPath && nextPath.startsWith('/') ? nextPath : fallback
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (mode === 'email') {
        const email = login.trim().toLowerCase()
        const { error } = await supabase.auth.signInWithPassword({ email, password })
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

        const nextPath = await resolvePostLoginPath('/welcome')
        navigateAfterLogin(nextPath)
        return
      }

      const username = normalizeOperatorUsername(login)
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: toOperatorAuthEmail(username),
        password,
      })
      if (signInError) throw new Error('Неверный логин или пароль')

      const {
        data: { user: operatorUser },
      } = await supabase.auth.getUser()

      const operatorUserId = operatorUser?.id || null
      if (!operatorUserId) {
        throw new Error('Не удалось получить сессию')
      }

      const { data: authByUser, error: authByUserError } = await supabase
        .from('operator_auth')
        .select('id, username, operator_id')
        .eq('user_id', operatorUserId)
        .eq('is_active', true)
        .maybeSingle()

      if (authByUserError) throw authByUserError
      if (!authByUser?.id || !authByUser.operator_id) {
        await supabase.auth.signOut().catch(() => null)
        throw new Error('Неверный логин или пароль')
      }

      const { data: operatorRow, error: operatorActiveError } = await supabase
        .from('operators')
        .select('is_active')
        .eq('id', authByUser.operator_id)
        .maybeSingle()

      if (operatorActiveError) throw operatorActiveError
      if (!operatorRow || operatorRow.is_active === false) {
        await supabase.auth.signOut().catch(() => null)
        throw new Error('Учётная запись оператора отключена. Обратитесь к руководителю.')
      }

      await fetch('/api/auth/login-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'operator', target: 'operator', status: 'success', identifier: authByUser.username || username }),
      }).catch(() => null)

      await fetch('/api/auth/login-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'operator', target: 'operator' }),
      }).catch(() => null)

      await fetch('/api/auth/operator-last-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authId: authByUser.id }),
      })

      const nextPath = await resolvePostLoginPath('/operator-dashboard')
      navigateAfterLogin(nextPath)
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
      setError(err?.message || (mode === 'email' ? 'Не удалось войти. Проверьте пароль.' : 'Неверный логин или пароль.'))
    } finally {
      setLoading(false)
    }
  }

  if (isTenantSubdomain && !hostOrg) {
    return <TenantNotFound platformUrl={platformUrl} />
  }

  if (hostOrg) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_24%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4 text-white">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center">
          <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <TenantIdentityPanel hostOrg={hostOrg} />

            <div className="rounded-[2rem] border border-white/10 bg-slate-950/75 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-300">
                  Вход в {hostOrg.name}
                </div>
                <h2 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-white">Откройте рабочий кабинет организации</h2>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Войдите под своей ролью. После авторизации вы попадёте сразу в контур {hostOrg.name}, без общего лендинга и чужих организаций.
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
                    Команда
                  </div>
                  <p className="mt-1 text-xs opacity-80">Владелец, менеджер, staff</p>
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
                    Операторы
                  </div>
                  <p className="mt-1 text-xs opacity-80">Рабочий логин точки</p>
                </button>
              </div>

              <div className="mb-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-sm font-medium text-white">{mode === 'email' ? 'Вход по email' : 'Вход по логину оператора'}</div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{helperText}</p>
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
                      className="border-white/10 bg-slate-900/60 pl-10 text-white placeholder:text-slate-600"
                      placeholder={mode === 'email' ? 'name@example.com' : 'login_operatora'}
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
                      className="border-white/10 bg-slate-900/60 pl-10 pr-10 text-white placeholder:text-slate-600"
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
                  className={`w-full ${
                    mode === 'email'
                      ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600'
                      : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600'
                  } text-white`}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  Войти в {hostOrg.name}
                </Button>
              </form>

              <div className="mt-5 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <Link href="/forgot-password" className="text-violet-400 hover:text-violet-300">
                  Забыли пароль?
                </Link>
                <span className="text-slate-500">Нет доступа? Обратитесь к администратору вашей организации</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.16),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="hidden overflow-hidden rounded-2xl border border-white/10 bg-slate-950/55 p-8 text-white backdrop-blur-xl lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="mb-6 inline-flex rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 p-4 shadow-lg shadow-violet-500/20">
                <Brain className="h-8 w-8 text-white" />
              </div>
              <h1 className="max-w-md text-4xl font-semibold leading-tight text-white">
                {SITE_NAME} для команды, точек и ежедневного ритма работы.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
                Платформа владельца, tenant-контуры клиентов, роли команды, операторский кабинет и рабочие данные в одном SaaS-слое.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">Platform owner</p>
                <p className="mt-1 text-sm text-slate-400">Организации, подписки, лимиты, биллинг и контроль состояния платформы.</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">Tenant access</p>
                <p className="mt-1 text-sm text-slate-400">Каждый клиент работает только в своём поддомене и видит только свой контур.</p>
              </div>
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                Если пользователь открывает tenant-поддомен, он больше не попадает на общий маркетинг платформы.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl sm:p-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-4 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 p-4 shadow-lg shadow-violet-500/20">
                <Brain className="h-7 w-7 text-white" />
              </div>
              <h2 className="text-2xl font-semibold">Вход в {SITE_NAME}</h2>
              <p className="mt-2 max-w-sm text-sm text-slate-400">
                Общий вход платформы для владельца системы и административной команды.
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
                <p className="mt-1 text-xs opacity-80">Staff и руководство</p>
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
                    placeholder={mode === 'email' ? 'name@example.com' : 'login_operatora'}
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
                className={`w-full ${
                  mode === 'email'
                    ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600'
                } text-white`}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Войти
              </Button>
            </form>

            <div className="mt-5 flex items-center justify-between text-sm">
              <Link href="/forgot-password" className="text-violet-400 hover:text-violet-300">
                Забыли пароль?
              </Link>
              <span className="text-slate-500">Нет доступа? Обратитесь к администратору</span>
            </div>
            <p className="mt-6 text-center text-[11px] text-slate-600">{SITE_NAME} · Platform access</p>
          </div>
        </div>
      </div>
    </div>
  )
}
