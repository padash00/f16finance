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
  ArrowLeft,
  ArrowRight,
  Brain,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Shield,
  User,
} from 'lucide-react'

// Кнопка «Назад» на сайт + ссылка на главную (общая для всех экранов входа).
function BackToSite({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="absolute left-5 top-5 z-10 inline-flex items-center gap-2 rounded-full border border-[#e3e8f0] bg-white/80 px-4 py-2 text-sm font-medium text-[#475569] shadow-sm backdrop-blur transition hover:border-emerald-300 hover:text-emerald-700"
    >
      <ArrowLeft className="h-4 w-4" />
      На сайт
    </Link>
  )
}

type LoginMode = 'email' | 'operator'
type HostOrg = { name: string; slug: string } | null

/** Перевод сообщений об ошибках Supabase Auth на русский. */
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

// ─── Левый брендовый блок (общий вид сплита) ────────────────────────────────
function BrandPanel({
  badge,
  title,
  subtitle,
  points,
  footer,
}: {
  badge: string
  title: React.ReactNode
  subtitle: string
  points: { title: string; text: string }[]
  footer?: string
}) {
  return (
    <div className="relative hidden overflow-hidden rounded-[2rem] bg-[linear-gradient(150deg,#0a7d4a_0%,#0f6b40_45%,#0a5733_100%)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
      {/* декоративное свечение/паттерн */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }}
      />

      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] backdrop-blur-sm">
          {badge}
        </div>
        <div className="mt-10 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 shadow-lg backdrop-blur-sm">
          <Brain className="h-7 w-7 text-white" />
        </div>
        <h1 className="mt-6 max-w-md text-4xl font-semibold leading-[1.12] tracking-[-0.03em]">{title}</h1>
        <p className="mt-4 max-w-md text-sm leading-7 text-emerald-50/80">{subtitle}</p>
      </div>

      <div className="relative mt-10 space-y-4">
        {points.map((p) => (
          <div key={p.title} className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />
            <div>
              <div className="text-sm font-medium text-white">{p.title}</div>
              <div className="text-sm leading-6 text-emerald-50/70">{p.text}</div>
            </div>
          </div>
        ))}
        {footer ? <p className="pt-3 text-xs leading-6 text-emerald-50/60">{footer}</p> : null}
      </div>
    </div>
  )
}

function TenantNotFound({ platformUrl }: { platformUrl: string }) {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#ffffff_0%,#eef2f8_48%,#ffffff_100%)] p-4 text-[#0f2038]">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center">
        <div className="w-full max-w-xl rounded-[2rem] border border-[#d6dde8] bg-white p-8 text-center shadow-[0_24px_60px_-28px_rgba(15,32,56,0.3)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/10 text-emerald-600">
            <Building2 className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em]">Организация не найдена</h1>
          <p className="mt-3 text-sm leading-7 text-[#475569]">
            Этот поддомен не привязан к рабочему контуру клиента или ещё не настроен. Перейдите на основной домен
            платформы или используйте корректный адрес вашей организации.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
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

  // ─── Правая карточка с формой (общая для платформы и tenant) ──────────────
  const renderForm = ({ title, subtitle, submitLabel }: { title: string; subtitle: string; submitLabel: string }) => (
    <div className="rounded-[2rem] border border-[#e3e8f0] bg-white p-7 shadow-[0_24px_60px_-28px_rgba(15,32,56,0.3)] sm:p-9">
      <div className="mb-7 flex flex-col items-center text-center lg:items-start lg:text-left">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#10b981,#0a7d4a)] shadow-lg shadow-emerald-600/25 lg:hidden">
          <Brain className="h-6 w-6 text-white" />
        </div>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-[#0f2038]">{title}</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-[#5b6b82]">{subtitle}</p>
      </div>

      {/* Переключатель режима */}
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-[#e7ebf2] bg-[#f3f6fb] p-1">
        <button
          type="button"
          onClick={() => { setMode('email'); setError(null) }}
          className={`rounded-xl px-4 py-3 text-left transition ${mode === 'email' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25' : 'text-[#475569] hover:bg-white'}`}
        >
          <div className="flex items-center gap-2 text-sm font-medium"><Shield className="h-4 w-4" />Команда</div>
          <p className="mt-1 text-xs opacity-80">Владелец, менеджер, staff</p>
        </button>
        <button
          type="button"
          onClick={() => { setMode('operator'); setError(null) }}
          className={`rounded-xl px-4 py-3 text-left transition ${mode === 'operator' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25' : 'text-[#475569] hover:bg-white'}`}
        >
          <div className="flex items-center gap-2 text-sm font-medium"><User className="h-4 w-4" />Операторы</div>
          <p className="mt-1 text-xs opacity-80">Рабочий логин точки</p>
        </button>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-[#5b6b82]">{mode === 'email' ? 'Email' : 'Логин оператора'}</label>
          <div className="relative">
            {mode === 'email'
              ? <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
              : <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />}
            <Input
              type={mode === 'email' ? 'email' : 'text'}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="h-12 rounded-xl border-[#d4dbe6] bg-[#fafbfd] pl-10 text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30"
              placeholder={mode === 'email' ? 'name@example.com' : 'login_operatora'}
              required
              autoComplete="username"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[#5b6b82]">Пароль</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 rounded-xl border-[#d4dbe6] bg-[#fafbfd] pl-10 pr-10 text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30"
              placeholder="Введите пароль"
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#475569]"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#dc2626]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          type="submit"
          disabled={loading}
          className="h-12 w-full rounded-xl bg-[linear-gradient(135deg,#10b981,#0a7d4a)] text-base font-medium text-white shadow-lg shadow-emerald-600/25 transition hover:brightness-105 disabled:opacity-60"
        >
          {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ArrowRight className="mr-2 h-5 w-5" />}
          {submitLabel}
        </Button>
      </form>

      <div className="mt-6 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <Link href="/forgot-password" className="font-medium text-emerald-600 hover:text-emerald-700">Забыли пароль?</Link>
        <span className="text-[#94a3b8]">Нет доступа? Обратитесь к администратору</span>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-[#94a3b8] lg:justify-start">
        <span>{SITE_NAME} · Безопасный вход</span>
        <span className="text-[#cbd5e1]">·</span>
        <Link href="/privacy" className="hover:text-emerald-600">Конфиденциальность</Link>
        <span className="text-[#cbd5e1]">·</span>
        <Link href="/terms" className="hover:text-emerald-600">Условия</Link>
      </div>
    </div>
  )

  if (isTenantSubdomain && !hostOrg) {
    return <TenantNotFound platformUrl={platformUrl} />
  }

  // ─── Tenant-поддомен организации ──────────────────────────────────────────
  if (hostOrg) {
    return (
      <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.06),transparent_28%),linear-gradient(135deg,#ffffff_0%,#eef2f8_50%,#ffffff_100%)] p-4">
        <BackToSite href={platformUrl} />
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center">
          <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <BrandPanel
              badge="Кабинет организации"
              title={<>Рабочий кабинет<br />{hostOrg.name}</>}
              subtitle={`Войдите под своей ролью — и сразу попадёте в контур ${hostOrg.name}, без общего лендинга и чужих организаций.`}
              points={[
                { title: 'Руководство и staff', text: 'Вход по приглашённому email и личному паролю.' },
                { title: 'Операторы', text: 'Вход по операторскому логину и выданному паролю.' },
                { title: 'Изоляция данных', text: 'Этот поддомен открывает только ваш контур — чужие организации недоступны.' },
              ]}
              footer={`${hostOrg.slug}.ordaops.kz`}
            />
            {renderForm({
              title: `Вход в ${hostOrg.name}`,
              subtitle: 'Откройте рабочий кабинет вашей организации.',
              submitLabel: `Войти в ${hostOrg.name}`,
            })}
          </div>
        </div>
      </div>
    )
  }

  // ─── Общий вход платформы ─────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.07),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.05),transparent_26%),linear-gradient(135deg,#ffffff_0%,#eef2f8_50%,#ffffff_100%)] p-4">
      <BackToSite href="/" />
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <BrandPanel
            badge={`${SITE_NAME} · вход`}
            title={<>{SITE_NAME} — команда, точки и ритм работы в одном месте.</>}
            subtitle="Финансы, склад, смены, зарплата, операторы и AI-аналитика — единый рабочий слой для управления игровым клубом."
            points={[
              { title: 'Для команды', text: 'Владелец, менеджер, маркетолог и сотрудники — каждый со своей ролью.' },
              { title: 'Для операторов', text: 'Отдельный вход по рабочему логину точки.' },
              { title: 'Всё под контролем', text: 'Доходы, расходы, склад, смены и долги — в реальном времени.' },
            ]}
            footer={helperText}
          />
          {renderForm({
            title: `Вход в ${SITE_NAME}`,
            subtitle: 'Введите данные, чтобы открыть рабочий кабинет.',
            submitLabel: 'Войти',
          })}
        </div>
      </div>
    </div>
  )
}
