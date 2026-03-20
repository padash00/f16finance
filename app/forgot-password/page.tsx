'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Mail, ArrowRight } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getPublicAppUrl } from '@/lib/core/app-url'
import { supabase } from '@/lib/supabaseClient'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const redirectTo = `${getPublicAppUrl(window.location.origin)}/auth/callback?next=${encodeURIComponent('/reset-password?mode=recovery')}`
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (resetError) throw resetError

      setSuccess(`Письмо для смены пароля отправлено на ${email.trim()}.`)
      setEmail('')
    } catch (err: any) {
      setError(err?.message || 'Не удалось отправить письмо для восстановления.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.16),_transparent_32%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1fr_0.95fr]">
          <Card className="hidden border-white/10 bg-slate-950/60 p-8 text-white backdrop-blur-xl lg:block">
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-5 inline-flex rounded-2xl bg-violet-500/10 p-4">
                  <KeyRound className="h-7 w-7 text-violet-400" />
                </div>
                <h1 className="text-3xl font-semibold text-white">Восстановление доступа</h1>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Введите рабочий email. Мы отправим письмо со ссылкой, по которой можно задать новый пароль.
                </p>
              </div>

              <div className="space-y-3">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                  <p className="font-medium text-white">Как это работает</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Укажите email, на который зарегистрирован аккаунт.</li>
                    <li>Откройте письмо и перейдите по ссылке.</li>
                    <li>Задайте новый пароль и вернитесь ко входу.</li>
                  </ol>
                </div>
                <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
                  Для операторов этот экран обычно не нужен: они входят по логину. Для сотрудников и руководителей нужен именно email.
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl sm:p-8">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-violet-500/10 p-3">
                <KeyRound className="h-6 w-6 text-violet-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Сброс пароля</h1>
                <p className="text-sm text-slate-400">Отправим письмо для установки нового пароля.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">Рабочий email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="border-white/10 bg-slate-900/60 pl-10 text-white"
                    placeholder="name@example.com"
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

              {success && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{success}</span>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                    <p className="font-medium text-white">Что делать дальше</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                      <li>Откройте письмо.</li>
                      <li>Перейдите по ссылке.</li>
                      <li>Задайте новый пароль.</li>
                      <li>После этого вернитесь ко входу.</li>
                    </ol>
                  </div>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Отправить письмо
              </Button>
            </form>

            <div className="mt-5 text-center text-sm text-slate-400">
              <Link href="/login" className="text-violet-400 hover:text-violet-300">
                Вернуться ко входу
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
