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
            <div className="text-sm text-zinc-500">Настройки</div>
            <div className="mt-1 text-xl font-semibold text-zinc-100">Управление личным кабинетом</div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Здесь собраны действия, которые оператору реально нужны с телефона: сменить пароль, открыть профиль, перейти в задачи или выйти из системы.
            </p>
          </div>
          <div className="rounded-none bg-amber-500/15 p-3 text-amber-300">
            <UserCog className="h-6 w-6" />
          </div>
        </div>
      </OperatorPanel>

      {loading ? (
        <OperatorPanel>
          <div className="flex items-center gap-3 text-sm text-zinc-400">
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
            <div className="mt-4 space-y-3 text-sm text-zinc-400">
              <div className="rounded-none border border-[#23262b] bg-[#0b0c0d] p-4">
                <div className="font-medium text-zinc-100">{data.operator.name}</div>
                <div className="mt-1 text-xs text-zinc-500">
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
            <div className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
              <ShieldCheck className="h-5 w-5 text-amber-400" />
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
            <div className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
              <Bell className="h-5 w-5 text-amber-400" />
              Рабочие действия
            </div>
            <div className="mt-4 grid gap-3">
              <Button asChild variant="outline" className="w-full justify-start border-[#23262b] bg-[#0b0c0d] text-zinc-100 hover:bg-[#0e0f10]">
                <Link href="/operator/profile">Открыть профиль</Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start border-[#23262b] bg-[#0b0c0d] text-zinc-100 hover:bg-[#0e0f10]">
                <Link href="/operator/tasks">
                  <Briefcase className="h-4 w-4" />
                  Открыть мои задачи
                </Link>
              </Button>
            </div>
          </OperatorPanel>

          <OperatorPanel>
            <div className="text-lg font-semibold text-zinc-100">Выход</div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
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
