'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, MailCheck, ShieldCheck, ArrowRight } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

function getCompleteConfig(mode: string | null) {
  if (mode === 'signup') {
    return {
      title: 'Email подтверждён',
      description: 'Регистрация завершена. Теперь можно войти и продолжить работу в системе.',
      steps: ['Email подтверждён.', 'Аккаунт активирован.', 'Можно перейти в свой раздел или на экран входа.'],
    }
  }

  if (mode === 'email_change') {
    return {
      title: 'Email обновлён',
      description: 'Новый адрес подтверждён и уже действует в системе.',
      steps: ['Новый email подтверждён.', 'Аккаунт продолжает работать с новым адресом.', 'При следующем входе используйте новый email.'],
    }
  }

  if (mode === 'magiclink') {
    return {
      title: 'Вход подтверждён',
      description: 'Безопасная ссылка сработала, доступ открыт.',
      steps: ['Ссылка из письма обработана.', 'Сессия создана.', 'Можно перейти в рабочий кабинет.'],
    }
  }

  return {
    title: 'Операция завершена',
    description: 'Проверка по ссылке из письма прошла успешно.',
    steps: ['Ссылка обработана.', 'Доступ подтверждён.', 'Можно продолжить работу.'],
  }
}

function CompleteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [defaultPath, setDefaultPath] = useState('/')

  const mode = searchParams.get('mode')
  const config = useMemo(() => getCompleteConfig(mode), [mode])

  useEffect(() => {
    let active = true

    const loadDefaultPath = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch('/api/auth/session-role').catch(() => null)
      const json = await response?.json().catch(() => null)

      if (active && response?.ok && json?.defaultPath) {
        setDefaultPath(String(json.defaultPath))
      }
    }

    loadDefaultPath()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_30%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1fr_0.95fr]">
          <Card className="hidden border-white/10 bg-slate-950/60 p-8 text-white backdrop-blur-xl lg:block">
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-5 inline-flex rounded-2xl bg-emerald-500/10 p-4">
                  <CheckCircle2 className="h-7 w-7 text-emerald-400" />
                </div>
                <h1 className="text-3xl font-semibold text-white">{config.title}</h1>
                <p className="mt-3 text-sm leading-6 text-slate-400">{config.description}</p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                <p className="font-medium text-white">Дальше обычно так</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Если пароль уже задан, откройте свой рабочий раздел.</li>
                  <li>Если это был просто шаг подтверждения, можно вернуться ко входу.</li>
                  <li>Если что-то пошло не так, администратор может отправить новое письмо.</li>
                </ol>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl sm:p-8">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-500/10 p-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">{config.title}</h1>
                <p className="text-sm text-slate-400">{config.description}</p>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <MailCheck className="h-4 w-4 text-emerald-400" />
                {config.steps[0]}
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-violet-400" />
                {config.steps[1]}
              </div>
              <div className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-sky-400" />
                {config.steps[2]}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Button className="w-full" onClick={() => router.push(defaultPath)}>
                <ArrowRight className="mr-2 h-4 w-4" />
                Открыть раздел
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Ко входу</Link>
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function AuthCompletePage() {
  return (
    <Suspense fallback={null}>
      <CompleteContent />
    </Suspense>
  )
}
