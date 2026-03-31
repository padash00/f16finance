'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Brain, Building2, Loader2, LogOut, Settings2, ShieldAlert, Store, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'
import type { SessionRoleInfo } from '@/lib/core/types'

type OrganizationItem = NonNullable<SessionRoleInfo['organizations']>[number]
type QuickAction = {
  id: string
  label: string
  href: string
  description: string
  icon: any
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'dashboard',
    label: 'Открыть панель',
    href: '/dashboard',
    description: 'Зайти в рабочую панель и открыть метрики этой организации.',
    icon: ArrowRight,
  },
  {
    id: 'settings',
    label: 'Настройки',
    href: '/settings',
    description: 'Перейти в системные настройки, справочники и параметры клиента.',
    icon: Settings2,
  },
  {
    id: 'points',
    label: 'Точки и устройства',
    href: '/point-devices',
    description: 'Управлять точками, устройствами и рабочими подключениями.',
    icon: Store,
  },
  {
    id: 'team',
    label: 'Команда',
    href: '/staff',
    description: 'Открыть сотрудников, роли и внутреннюю административную команду.',
    icon: Users,
  },
]

function isSafeInternalPath(value: string | null) {
  return !!value && value.startsWith('/') && !value.startsWith('//') && value !== '/select-organization'
}

function SelectOrganizationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([])
  const [activeOrganization, setActiveOrganization] = useState<SessionRoleInfo['activeOrganization']>(null)
  const [organizationHubRequired, setOrganizationHubRequired] = useState(false)
  const [defaultPath, setDefaultPath] = useState('/')
  const [error, setError] = useState<string | null>(null)

  const nextPath = useMemo(() => {
    const next = searchParams.get('next')
    return isSafeInternalPath(next) ? next : null
  }, [searchParams])

  useEffect(() => {
    let active = true

    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/session-role', { cache: 'no-store' })
        const json = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(json?.error || 'Не удалось загрузить доступные организации.')
        }

        if (!active) return

        const sessionOrganizations = Array.isArray(json?.organizations) ? json.organizations : []
        setOrganizations(sessionOrganizations)
        setActiveOrganization(json?.activeOrganization || null)
        setOrganizationHubRequired(Boolean(json?.organizationHubRequired))
        const resolvedDefaultPath =
          json?.defaultPath && String(json.defaultPath).startsWith('/') && !String(json.defaultPath).startsWith('//')
            ? String(json.defaultPath)
            : '/'
        setDefaultPath(resolvedDefaultPath)
      } catch (err: any) {
        if (!active) return
        setError(err?.message || 'Не удалось загрузить организации.')
      } finally {
        if (active) {
          setLoading(false)
          setSwitchingId(null)
        }
      }
    }

    loadSession()
    return () => {
      active = false
    }
  }, [nextPath, router])

  const handleSelectOrganization = async (organizationId: string, navigateTo?: string | null) => {
    if (!organizationId) return

    try {
      setError(null)
      setSwitchingId(organizationId)

      const response = await fetch('/api/auth/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error || 'Не удалось переключить организацию.')
      }

      setActiveOrganization(body?.activeOrganization || null)
      if (navigateTo && isSafeInternalPath(navigateTo)) {
        router.replace(navigateTo)
        router.refresh()
        return
      }

      if (nextPath) {
        router.replace(nextPath)
        router.refresh()
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось выбрать организацию.')
    } finally {
      setSwitchingId(null)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut().catch(() => null)
    router.replace('/login')
    router.refresh()
  }

  const activeOrganizationId = activeOrganization?.id || null
  const activeOrganizationLabel = activeOrganization?.name || 'Организация пока не выбрана'

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1fr_0.95fr]">
          <Card className="hidden border-white/10 bg-slate-950/60 p-8 text-white backdrop-blur-xl lg:block">
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-6 inline-flex rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-500 p-4 shadow-lg shadow-sky-500/20">
                  <Brain className="h-8 w-8 text-white" />
                </div>
                <h1 className="max-w-md text-4xl font-semibold leading-tight text-white">
                  Выберите проект, клиента или организацию, в которой хотите работать сейчас.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
                  После выбора система зафиксирует tenant-контекст и откроет только данные, точки, отчёты и людей этой организации.
                </p>
              </div>

              <div className="space-y-3">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                  Теперь вход идёт сначала сюда, даже если у вас пока только один клиент.
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                  Здесь можно выбрать, какой проект открыть: панель, настройки, точки или команду.
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl sm:p-8">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-sky-500/10 p-3">
                <Building2 className="h-6 w-6 text-sky-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Выбор проекта</h1>
                <p className="text-sm text-slate-400">Сначала выберите организацию, затем откройте нужный раздел.</p>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                Загружаем организации...
              </div>
            ) : organizations.length === 0 ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <ShieldAlert className="h-4 w-4" />
                    Нет доступных организаций
                  </div>
                  Для этого аккаунта ещё не назначена организация. Нужна привязка со стороны администратора.
                </div>
                <Button variant="outline" className="w-full" onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Выйти
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                  <span className="font-medium text-white">Текущий контекст:</span>{' '}
                  {activeOrganizationLabel}
                  {organizationHubRequired ? (
                    <span className="ml-2 text-slate-500">Вы сами решаете, куда зайти дальше.</span>
                  ) : null}
                </div>

                {organizations.map((organization) => {
                  const isActive = activeOrganization?.id === organization.id
                  const isBusy = switchingId === organization.id

                  return (
                    <div
                      key={organization.id}
                      className={`rounded-3xl border px-4 py-4 transition ${
                        isActive
                          ? 'border-sky-500/30 bg-sky-500/10'
                          : 'border-white/10 bg-white/[0.03]'
                      } ${switchingId ? 'opacity-80' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-base font-semibold text-white">{organization.name}</p>
                            {isActive ? (
                              <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-sky-300">
                                Активна
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs uppercase tracking-[0.18em] text-slate-500">
                            {organization.slug} • {organization.accessRole}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectOrganization(organization.id)}
                          disabled={!!switchingId}
                          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white transition hover:border-sky-500/30 hover:bg-slate-950"
                        >
                          {isBusy ? <Loader2 className="h-4 w-4 animate-spin text-sky-400" /> : <ArrowRight className="h-4 w-4" />}
                          {isActive ? 'Оставить активной' : 'Выбрать'}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {QUICK_ACTIONS.map((action) => {
                          const ActionIcon = action.icon
                          const disabled = !!switchingId && switchingId !== organization.id
                          const highlighted = isActive && activeOrganizationId === organization.id

                          return (
                            <button
                              key={`${organization.id}-${action.id}`}
                              type="button"
                              disabled={disabled}
                              onClick={() => handleSelectOrganization(organization.id, action.href)}
                              className={`rounded-2xl border px-3 py-3 text-left transition ${
                                highlighted
                                  ? 'border-sky-500/20 bg-slate-950/70'
                                  : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30'
                              } disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              <div className="flex items-center gap-2 text-sm font-medium text-white">
                                <ActionIcon className="h-4 w-4 text-sky-300" />
                                {action.label}
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-400">{action.description}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}

                {!nextPath ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-400">
                    Если просто хочешь войти в нужный проект, сначала нажми <span className="font-medium text-white">Выбрать</span>, а потом открой панель или настройки.
                  </div>
                ) : null}

                <Button variant="outline" className="mt-2 w-full" onClick={handleSignOut} disabled={!!switchingId}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Выйти
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function SelectOrganizationPage() {
  return (
    <Suspense fallback={null}>
      <SelectOrganizationContent />
    </Suspense>
  )
}
