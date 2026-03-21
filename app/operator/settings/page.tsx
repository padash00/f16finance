'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Bell, Briefcase, KeyRound, Loader2, LogOut, ShieldCheck, UserCog } from 'lucide-react'

import { OperatorPanel, OperatorPill, OperatorSectionHeading } from '@/components/operator/operator-mobile-ui'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

type ProfileData = {
  operator: {
    name: string
    short_name: string | null
    username: string | null
    telegram_chat_id: string | null
    profile: {
      position: string | null
      phone: string | null
      email: string | null
    }
  }
}

export default function OperatorSettingsMobilePage() {
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/operator/profile', { cache: 'no-store' })
        const json = await response.json().catch(() => null)
        if (!response.ok) throw new Error(json?.error || `Ошибка загрузки (${response.status})`)
        if (!cancelled) {
          setData(json)
          setError(null)
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Не удалось открыть настройки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogout = async () => {
    try {
      setLoggingOut(true)
      await supabase.auth.signOut()
      window.location.href = '/login'
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="space-y-4">
      <OperatorPanel accent="amber">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">Настройки</div>
            <div className="mt-1 text-xl font-semibold text-white">Управление личным кабинетом</div>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Здесь собраны действия, которые оператору реально нужны с телефона: сменить пароль, открыть профиль, перейти в задачи или выйти из системы.
            </p>
          </div>
          <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300">
            <UserCog className="h-6 w-6" />
          </div>
        </div>
      </OperatorPanel>

      {loading ? (
        <OperatorPanel>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <Loader2 className="h-5 w-5 animate-spin" />
            Загружаю настройки...
          </div>
        </OperatorPanel>
      ) : null}

      {error ? <OperatorPanel className="border-red-500/25 bg-red-500/10 text-sm text-red-200">{error}</OperatorPanel> : null}

      {!loading && data ? (
        <>
          <OperatorPanel>
            <OperatorSectionHeading title="Ваш аккаунт" description="Короткая сводка по аккаунту, чтобы быстро проверить, всё ли подключено." />
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                <div className="font-medium text-white">{data.operator.name}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {data.operator.profile.position || 'Оператор'}
                  {data.operator.username ? ` · ${data.operator.username}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.operator.profile.phone ? <OperatorPill>{data.operator.profile.phone}</OperatorPill> : null}
                {data.operator.profile.email ? <OperatorPill tone="blue">{data.operator.profile.email}</OperatorPill> : null}
                <OperatorPill tone={data.operator.telegram_chat_id ? 'emerald' : 'default'}>
                  Telegram {data.operator.telegram_chat_id ? 'подключён' : 'не подключён'}
                </OperatorPill>
              </div>
            </div>
          </OperatorPanel>

          <OperatorPanel>
            <div className="flex items-center gap-2 text-lg font-semibold text-white">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              Безопасность
            </div>
            <div className="mt-4 grid gap-3">
              <Button asChild className="w-full justify-start">
                <Link href="/forgot-password">
                  <KeyRound className="h-4 w-4" />
                  Сменить пароль
                </Link>
              </Button>
            </div>
          </OperatorPanel>

          <OperatorPanel>
            <div className="flex items-center gap-2 text-lg font-semibold text-white">
              <Bell className="h-5 w-5 text-blue-300" />
              Рабочие действия
            </div>
            <div className="mt-4 grid gap-3">
              <Button asChild variant="outline" className="w-full justify-start border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]">
                <Link href="/operator/profile">Открыть профиль</Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]">
                <Link href="/operator/tasks">
                  <Briefcase className="h-4 w-4" />
                  Открыть мои задачи
                </Link>
              </Button>
            </div>
          </OperatorPanel>

          <OperatorPanel>
            <div className="text-lg font-semibold text-white">Выход</div>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Если вы закончили работу на этом устройстве, безопасно выйдите из кабинета.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4 w-full justify-start border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
            >
              {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Выйти из аккаунта
            </Button>
          </OperatorPanel>
        </>
      ) : null}
    </div>
  )
}
