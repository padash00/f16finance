'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Building2, CalendarDays, Loader2, Phone, Settings, ShieldCheck, UserRound, Wallet } from 'lucide-react'

import { OperatorEmptyState, OperatorPanel, OperatorPill, OperatorSectionHeading } from '@/components/operator/operator-mobile-ui'
import { Button } from '@/components/ui/button'
import { formatPhone } from '@/lib/core/format'

type ProfileData = {
  operator: {
    id: string
    name: string
    short_name: string | null
    telegram_chat_id: string | null
    username: string | null
    auth_role: string | null
    auth_created_at: string | null
    profile: {
      full_name: string | null
      photo_url: string | null
      position: string | null
      phone: string | null
      email: string | null
      hire_date: string | null
      birth_date: string | null
      city: string | null
      about: string | null
    }
  }
  assignments: Array<{
    id: string
    companyId: string
    companyName: string | null
    companyCode: string | null
    role: string
    isPrimary: boolean
    notes: string | null
  }>
  leadAssignments: Array<{
    id: string
    companyId: string
    companyName: string | null
    companyCode: string | null
    role: string
  }>
}

export default function OperatorProfileMobilePage() {
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        if (!cancelled) setError(err?.message || 'Не удалось загрузить профиль')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <OperatorPanel>
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Загружаю профиль...
        </div>
      </OperatorPanel>
    )
  }

  if (error || !data) {
    return <OperatorPanel className="border-red-500/25 bg-red-500/10 text-sm text-red-200">{error || 'Профиль недоступен'}</OperatorPanel>
  }

  return (
    <div className="space-y-4">
      <OperatorPanel accent="blue">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-white/10 bg-white/[0.06] text-white">
            <UserRound className="h-8 w-8" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-semibold text-white">{data.operator.name}</div>
            <div className="mt-1 text-sm text-slate-300">{data.operator.profile.position || 'Оператор'}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {data.operator.username ? <OperatorPill>Логин: {data.operator.username}</OperatorPill> : null}
              {data.operator.auth_role ? <OperatorPill tone="blue">Роль: {data.operator.auth_role}</OperatorPill> : null}
              {data.operator.telegram_chat_id ? <OperatorPill tone="emerald">Telegram подключён</OperatorPill> : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Phone className="h-4 w-4 text-amber-300" />
              Контакты
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div>{formatPhone(data.operator.profile.phone) || 'Телефон не указан'}</div>
              <div>{data.operator.profile.email || 'Email не указан'}</div>
              <div>{data.operator.profile.city || 'Город не указан'}</div>
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <CalendarDays className="h-4 w-4 text-blue-300" />
              Даты
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div>Принят: {data.operator.profile.hire_date ? new Date(`${data.operator.profile.hire_date}T12:00:00`).toLocaleDateString('ru-RU') : 'не указано'}</div>
              <div>Дата рождения: {data.operator.profile.birth_date ? new Date(`${data.operator.profile.birth_date}T12:00:00`).toLocaleDateString('ru-RU') : 'не указано'}</div>
            </div>
          </div>
        </div>
      </OperatorPanel>

      <OperatorPanel>
        <OperatorSectionHeading title="Закреплённые точки" description="Где вы сейчас активны и какая точка считается основной." />
        <div className="mt-4 space-y-3">
          {data.assignments.length === 0 ? (
            <OperatorEmptyState title="Точек пока нет" description="Активных привязок к точкам пока нет." />
          ) : (
            data.assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <Building2 className="h-4 w-4 text-emerald-300" />
                      {assignment.companyName || 'Точка'}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {assignment.companyCode ? `Код: ${assignment.companyCode}` : 'Код не указан'} · {assignment.role}
                    </div>
                  </div>
                  {assignment.isPrimary ? <OperatorPill tone="amber">Основная</OperatorPill> : null}
                </div>
                {assignment.notes ? <div className="mt-2 text-xs text-slate-400">{assignment.notes}</div> : null}
              </div>
            ))
          )}
        </div>
      </OperatorPanel>

      {data.leadAssignments.length > 0 ? (
        <OperatorPanel accent="violet">
          <OperatorSectionHeading title="Старший по точке" description="Точки, за которые вы отвечаете как старший." />
          <div className="mt-4 space-y-3">
            {data.leadAssignments.map((assignment) => (
              <div key={assignment.id} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <ShieldCheck className="h-4 w-4 text-violet-300" />
                  {assignment.companyName || 'Точка'}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {assignment.companyCode ? `Код: ${assignment.companyCode}` : 'Код не указан'} · {assignment.role}
                </div>
              </div>
            ))}
          </div>
        </OperatorPanel>
      ) : null}

      <OperatorPanel>
        <OperatorSectionHeading title="Быстрые действия" description="Если нужно поправить данные или открыть рабочие каналы связи." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Button asChild className="w-full">
            <Link href="/operator/settings">
              <Settings className="h-4 w-4" />
              Открыть настройки
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]">
            <Link href="/operator/salary">
              <Wallet className="h-4 w-4" />
              Открыть зарплату
            </Link>
          </Button>
        </div>
      </OperatorPanel>
    </div>
  )
}
