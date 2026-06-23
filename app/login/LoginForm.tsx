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

/**
 * Перевод сообщений об ошибках Supabase Auth на русский.
 */
function translateSupabaseError(msg: string | null | undefined): string {
  if (!msg) return 'Не удалось войти'
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) return 'Неверный email или пароль'
  if (m.includes('email not confirmed')) return 'Email не подтверждён — проверьте почту'
  if (m.includes('user not found')) return 'Пользователь не найден'
  if (m.includes('email rate limit') || m.includes('rate limit')) return 'Слишком много попыток — подождите минуту'
  if (m.includes('too many requests')) return 'Слишком много запросов — попробуйте позже'
  if (m.includes('user already registered')) return 'Этот email уже зарегистрирован'
  if (m.includes('password should be at least')) return 'Пароль должен быть минимум 6 символов'
  if (m.includes('signup is disabled')) return 'Регистрация отключена'
  if (m.includes('email link is invalid') || m.includes('expired')) return 'Ссылка устарела или недействительна'
  if (m.includes('network') || m.includes('fetch')) return 'Нет соединения с сервером'
  return msg
}

function TenantIdentityPanel({ hostOrg }: { hostOrg: NonNullable<HostOrg> }) {
  const initials = hostOrg.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || '')
    .join('') || hostOrg.name.slice(0, 2).toUpperCase()

  return (
    <div className="rounded-[2rem] border border-[#d6dde8] bg-[radial-gradient(circle_at_top,rgba(22,163,74,0.08),transparent_35%),linear-gradient(180deg,#ffffff,#eef2f8)] p-6 text-[#0f2038] shadow-[0_20px_50px_-24px_rgba(15,32,56,0.25)] sm:p-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/25 bg-[#16a34a]/[0.07] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#15803d]">
        <Sparkles className="h-3.5 w-3.5" />
        Кабинет организации
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-[#1db955] to-[#15803d] text-xl font-bold text-white shadow-lg shadow-[#16a34a]/25">
          {initials}
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[#0f2038]">{hostOrg.name}</h1>
          <p className="mt-1 text-sm text-[#5b6b82]">{hostOrg.slug}.ordaops.kz</p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <div className="rounded-2xl border border-[#16a34a]/20 bg-[#16a34a]/[0.07] p-4">
          <div className="text-sm font-medium text-[#15803d]">Доступ только для вашей команды</div>
          <p className="mt-2 text-sm leading-6 text-[#475569]">
            На этом поддомене открывается только рабочий контур организации. После входа вы попадёте прямо в свой кабинет,
            без общего списка клиентов и без доступа к другим организациям.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#0f2038]">
              <Shield className="h-4 w-4 text-[#16a34a]" />
              Руководство и staff
            </div>
            <p className="mt-2 text-sm leading-6 text-[#475569]">Вход по приглашённому email и личному паролю.</p>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#0f2038]">
              <User className="h-4 w-4 text-[#16a34a]" />
              Операторы
            </div>
            <p className="mt-2 text-sm leading-6 text-[#475569]">Вход по операторскому логину и выданному паролю.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 text-sm leading-6 text-[#475569]">
          Если вы открыли не свой поддомен, система не пустит вас в чужую организацию даже при правильном логине.
        </div>
      </div>
    </div>
  )
}

function TenantNotFound({ platformUrl }: { platformUrl: string }) {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#ffffff_0%,#eef2f8_48%,#ffffff_100%)] p-4 text-[#0f2038]">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center">
        <div className="w-full max-w-xl rounded-[2rem] border border-[#d6dde8] bg-white p-8 text-center shadow-[0_20px_50px_-24px_rgba(15,32,56,0.25)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-[#16a34a]/[0.1] text-[#16a34a]">
            <Building2 className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em]">Организация не найдена</h1>
          <p className="mt-3 text-sm leading-7 text-[#475569]">
            Этот поддомен не привязан к рабочему контуру клиента или ещё не настроен. Перейдите на основной домен
            платформы или используйте корректный адрес вашей организации.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild className="bg-none bg-[#16a34a] text-white hover:bg-[#15803d]">
              <Link href={platformUrl}>Перейти на платформу</Link>
            </Button>
            <Button asChild variant="outline" className="border-[#c8d1de] bg-white text-[#0f2038] hover:bg-[#eef2f8]">
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
        if (error) throw new Error(translateSupabaseError(error.message))

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
      setError(translateSupabaseError(err?.message) || (mode === 'email' ? 'Не удалось войти. Проверьте пароль.' : 'Неверный логин или пароль.'))
    } finally {
      setLoading(false)
    }
  }

  if (isTenantSubdomain && !hostOrg) {
    return <TenantNotFound platformUrl={platformUrl} />
  }

  if (hostOrg) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(22,163,74,0.06),transparent_24%),linear-gradient(135deg,#ffffff_0%,#eef2f8_48%,#ffffff_100%)] p-4 text-[#0f2038]">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center">
          <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <TenantIdentityPanel hostOrg={hostOrg} />

            <div className="rounded-[2rem] border border-[#d6dde8] bg-white p-6 shadow-[0_20px_50px_-24px_rgba(15,32,56,0.25)] sm:p-8">
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-[#eef2f8] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[#5b6b82]">
                  Вход в {hostOrg.name}
                </div>
                <h2 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-[#0f2038]">Откройте рабочий кабинет организации</h2>
                <p className="mt-3 text-sm leading-7 text-[#475569]">
                  Войдите под своей ролью. После авторизации вы попадёте сразу в контур {hostOrg.name}, без общего лендинга и чужих организаций.
                </p>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-[#e2e8f0] bg-[#eef2f8] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('email')
                    setError(null)
                  }}
                  className={`rounded-xl px-4 py-3 text-left transition ${
                    mode === 'email' ? 'bg-[#16a34a] text-white shadow-lg shadow-[#16a34a]/20' : 'text-[#475569] hover:bg-white'
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
                    mode === 'operator' ? 'bg-[#16a34a] text-white shadow-lg shadow-[#16a34a]/20' : 'text-[#475569] hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4" />
                    Операторы
                  </div>
                  <p className="mt-1 text-xs opacity-80">Рабочий логин точки</p>
                </button>
              </div>

              <div className="mb-5 rounded-2xl border border-[#e2e8f0] bg-[#eef2f8] p-4">
                <div className="text-sm font-medium text-[#0f2038]">{mode === 'email' ? 'Вход по email' : 'Вход по логину оператора'}</div>
                <p className="mt-2 text-sm leading-6 text-[#5b6b82]">{helperText}</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[#5b6b82]">{mode === 'email' ? 'Email' : 'Логин оператора'}</label>
                  <div className="relative">
                    {mode === 'email' ? (
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                    ) : (
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                    )}
                    <Input
                      type={mode === 'email' ? 'email' : 'text'}
                      value={login}
                      onChange={(e) => setLogin(e.target.value)}
                      className="border-[#c8d1de] bg-white pl-10 text-[#0f2038] placeholder:text-[#64748b] focus-visible:ring-[#16a34a]"
                      placeholder={mode === 'email' ? 'name@example.com' : 'login_operatora'}
                      required
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-[#5b6b82]">Пароль</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="border-[#c8d1de] bg-white pl-10 pr-10 text-[#0f2038] placeholder:text-[#64748b] focus-visible:ring-[#16a34a]"
                      placeholder="Введите пароль"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#475569]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#dc2626]">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#1db955] to-[#15803d] text-white hover:from-[#15803d] hover:to-[#15803d]"
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  Войти в {hostOrg.name}
                </Button>
              </form>

              <div className="mt-5 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <Link href="/forgot-password" className="text-[#16a34a] hover:text-[#15803d]">
                  Забыли пароль?
                </Link>
                <span className="text-[#64748b]">Нет доступа? Обратитесь к администратору вашей организации</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(22,163,74,0.08),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(22,163,74,0.05),_transparent_28%),linear-gradient(135deg,#ffffff_0%,#eef2f8_48%,#ffffff_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="hidden overflow-hidden rounded-2xl border border-[#d6dde8] bg-white p-8 text-[#0f2038] shadow-[0_20px_50px_-24px_rgba(15,32,56,0.25)] lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="mb-6 inline-flex rounded-2xl bg-gradient-to-br from-[#1db955] to-[#15803d] p-4 shadow-lg shadow-[#16a34a]/20">
                <Brain className="h-8 w-8 text-white" />
              </div>
              <h1 className="max-w-md text-4xl font-semibold leading-tight text-[#0f2038]">
                {SITE_NAME} для команды, точек и ежедневного ритма работы.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#475569]">
                Платформа владельца, tenant-контуры клиентов, роли команды, операторский кабинет и рабочие данные в одном SaaS-слое.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="rounded-3xl border border-[#e2e8f0] bg-[#eef2f8] p-4">
                <p className="text-sm font-medium text-[#0f2038]">Platform owner</p>
                <p className="mt-1 text-sm text-[#5b6b82]">Организации, подписки, лимиты, биллинг и контроль состояния платформы.</p>
              </div>
              <div className="rounded-3xl border border-[#e2e8f0] bg-[#eef2f8] p-4">
                <p className="text-sm font-medium text-[#0f2038]">Tenant access</p>
                <p className="mt-1 text-sm text-[#5b6b82]">Каждый клиент работает только в своём поддомене и видит только свой контур.</p>
              </div>
              <div className="rounded-3xl border border-[#16a34a]/20 bg-[#16a34a]/[0.07] p-4 text-sm text-[#15803d]">
                Если пользователь открывает tenant-поддомен, он больше не попадает на общий маркетинг платформы.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#d6dde8] bg-white p-6 text-[#0f2038] shadow-[0_20px_50px_-24px_rgba(15,32,56,0.25)] sm:p-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-4 rounded-2xl bg-gradient-to-br from-[#1db955] to-[#15803d] p-4 shadow-lg shadow-[#16a34a]/20">
                <Brain className="h-7 w-7 text-white" />
              </div>
              <h2 className="text-2xl font-semibold">Вход в {SITE_NAME}</h2>
              <p className="mt-2 max-w-sm text-sm text-[#5b6b82]">
                Общий вход платформы для владельца системы и административной команды.
              </p>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-[#e2e8f0] bg-[#eef2f8] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('email')
                  setError(null)
                }}
                className={`rounded-xl px-4 py-3 text-left transition ${
                  mode === 'email' ? 'bg-[#16a34a] text-white shadow-lg shadow-[#16a34a]/20' : 'text-[#475569] hover:bg-white'
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
                  mode === 'operator' ? 'bg-[#16a34a] text-white shadow-lg shadow-[#16a34a]/20' : 'text-[#475569] hover:bg-white'
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
                <label className="text-xs font-medium text-[#5b6b82]">{mode === 'email' ? 'Email' : 'Логин оператора'}</label>
                <div className="relative">
                  {mode === 'email' ? (
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                  ) : (
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                  )}
                  <Input
                    type={mode === 'email' ? 'email' : 'text'}
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    className="border-[#c8d1de] bg-white pl-10 text-[#0f2038] placeholder:text-[#64748b] focus-visible:ring-[#16a34a]"
                    placeholder={mode === 'email' ? 'name@example.com' : 'login_operatora'}
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-[#5b6b82]">Пароль</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-[#c8d1de] bg-white pl-10 pr-10 text-[#0f2038] placeholder:text-[#64748b] focus-visible:ring-[#16a34a]"
                    placeholder="Введите пароль"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#475569]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#dc2626]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#1db955] to-[#15803d] text-white hover:from-[#15803d] hover:to-[#15803d]"
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Войти
              </Button>
            </form>

            <div className="mt-5 flex items-center justify-between text-sm">
              <Link href="/forgot-password" className="text-[#16a34a] hover:text-[#15803d]">
                Забыли пароль?
              </Link>
              <span className="text-[#64748b]">Нет доступа? Обратитесь к администратору</span>
            </div>
            <p className="mt-6 text-center text-[11px] text-[#64748b]">{SITE_NAME} · Platform access</p>
          </div>
        </div>
      </div>
    </div>
  )
}
