'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabaseClient'

function parseHashParams() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  return new URLSearchParams(hash)
}

type OtpFlowType = 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email_change' | 'email'

const OTP_TYPES = new Set<OtpFlowType>(['signup', 'magiclink', 'recovery', 'invite', 'email_change', 'email'])

function ResetPasswordContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const mode = searchParams.get('mode')
  const isInviteFlow = mode === 'invite' || pathname === '/set-password'
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [sessionReady, setSessionReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [defaultPath, setDefaultPath] = useState('/')

  const copy = useMemo(() => {
    if (isInviteFlow) {
      return {
        title: 'Установите пароль',
        description: 'Это первый вход в систему. Придумайте свой пароль для рабочего аккаунта. Временный пароль не нужен.',
        success: 'Пароль установлен. Этот пароль стал вашим основным паролем для входа в систему.',
      }
    }

    return {
      title: 'Новый пароль',
      description: 'Придумайте новый пароль для входа в систему.',
      success: 'Пароль успешно обновлён. Теперь можно войти с новым паролем.',
    }
  }, [isInviteFlow])

  useEffect(() => {
    let active = true

    const prepareSession = async () => {
      try {
        const queryParams = new URLSearchParams(window.location.search)
        const hashParams = parseHashParams()
        const code = queryParams.get('code')
        const tokenHash = queryParams.get('token_hash')
        const queryType = queryParams.get('type')
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        const hashType = hashParams.get('type')

        if (tokenHash && queryType && OTP_TYPES.has(queryType as OtpFlowType)) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: queryType as OtpFlowType,
          })
          if (otpError) throw otpError
        } else if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (sessionError) throw sessionError
        } else if (tokenHash && hashType && OTP_TYPES.has(hashType as OtpFlowType)) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: hashType as OtpFlowType,
          })
          if (otpError) throw otpError
        }

        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session) {
          throw new Error('Сессия для смены пароля не найдена. Откройте ссылку из письма заново.')
        }

        const response = await fetch('/api/auth/session-role').catch(() => null)
        const json = await response?.json().catch(() => null)

        if (!active) return

        setDefaultPath(
          response?.ok
            ? json?.organizationHubRequired || json?.organizationSelectionRequired
              ? '/select-organization'
              : json?.defaultPath
                ? String(json.defaultPath)
                : '/'
            : '/',
        )
        setSessionReady(true)
      } catch (err: any) {
        if (!active) return
        setError(err?.message || 'Не удалось подготовить смену пароля.')
      } finally {
        if (active) setChecking(false)
      }
    }

    prepareSession()
    return () => {
      active = false
    }
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('Пароль должен быть не короче 6 символов.')
      return
    }

    if (password !== confirmPassword) {
      setError('Пароли не совпадают.')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setSuccess(copy.success)
    } catch (err: any) {
      const message = String(err?.message || '')
      setError(
        message.toLowerCase().includes('auth session missing')
          ? 'Сессия для смены пароля потерялась. Откройте ссылку из письма заново и не закрывайте страницу до сохранения.'
          : err?.message || 'Не удалось обновить пароль.',
      )
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.16),_transparent_32%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
          <Card className="w-full border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
              Готовим безопасную смену пароля...
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.16),_transparent_32%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1fr_0.95fr]">
          <Card className="hidden border-white/10 bg-slate-950/60 p-8 text-white backdrop-blur-xl lg:block">
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-5 inline-flex rounded-2xl bg-violet-500/10 p-4">
                  {isInviteFlow ? <ShieldCheck className="h-7 w-7 text-violet-400" /> : <KeyRound className="h-7 w-7 text-violet-400" />}
                </div>
                <h1 className="text-3xl font-semibold text-white">{copy.title}</h1>
                <p className="mt-3 text-sm leading-6 text-slate-400">{copy.description}</p>
              </div>

              <div className="space-y-3">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                  <p className="font-medium text-white">Что будет дальше</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Сохраните новый пароль.</li>
                    <li>Откройте свой рабочий кабинет или экран входа.</li>
                    <li>В будущем входите по email и этому паролю.</li>
                  </ol>
                </div>
                <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  Если вы попали сюда из письма-приглашения, этот шаг завершает активацию аккаунта. После сохранения этот пароль станет постоянным.
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl sm:p-8">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-violet-500/10 p-3">
                  {isInviteFlow ? <ShieldCheck className="h-6 w-6 text-violet-400" /> : <KeyRound className="h-6 w-6 text-violet-400" />}
              </div>
              <div>
                <h1 className="text-lg font-semibold">{copy.title}</h1>
                <p className="text-sm text-slate-400">{copy.description}</p>
              </div>
            </div>

            {!sessionReady ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
                {error || 'Ссылка недействительна.'}
                <div className="mt-4">
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/forgot-password">Запросить новую ссылку</Link>
                  </Button>
                </div>
              </div>
            ) : success ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{success}</span>
                </div>

                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                  <p className="font-medium text-white">Что делать сейчас</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>Запомните новый пароль.</li>
                    <li>Нажмите кнопку ниже, чтобы открыть свой раздел.</li>
                    <li>Если хотите, можно также вернуться ко входу и войти вручную.</li>
                  </ol>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Button className="w-full" onClick={() => router.replace(defaultPath)}>
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Открыть кабинет
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/login">Ко входу</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Новый пароль</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="border-white/10 bg-slate-900/60 pl-10 text-white"
                      placeholder="Не короче 6 символов"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Повторите пароль</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="border-white/10 bg-slate-900/60 pl-10 text-white"
                      placeholder="Повторите новый пароль"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    <AlertCircle className="h-4 w-4" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                  Сохранить пароль
                </Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  )
}
