'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, BellRing, CircleAlert, Download, Filter, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type LogItem = {
  id: string
  kind: 'audit' | 'notification'
  createdAt: string
  title: string
  subtitle: string | null
  entityType: string | null
  action: string | null
  actorUserId: string | null
  actorEmail: string | null
  channel: string | null
  status: string | null
  recipient: string | null
  payload: Record<string, unknown> | null
}

type LogResponse = {
  ok: boolean
  total: number
  page: number
  limit: number
  items: LogItem[]
  filters: {
    kinds: string[]
    entityTypes: string[]
    actions: string[]
    actors: string[]
    channels: string[]
    statuses: string[]
  }
}

export default function LogsPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<LogResponse | null>(null)
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('')
  const [kind, setKind] = useState('')
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [page, setPage] = useState(1)

  const applyPreset = (preset: 'all' | 'auth' | 'finance' | 'errors') => {
    setPage(1)
    if (preset === 'all') {
      setDomain('')
      setKind('')
      setEntityType('')
      setAction('')
      setActor('')
      setChannel('')
      setStatus('')
      setOnlyErrors(false)
      return
    }

    if (preset === 'auth') {
      setDomain('auth')
      setKind('audit')
      setEntityType('')
      setAction('')
      setActor('')
      setChannel('')
      setStatus('')
      setOnlyErrors(false)
      setSearch('')
      return
    }

    if (preset === 'finance') {
      setDomain('finance')
      setKind('audit')
      setEntityType('')
      setAction('')
      setActor('')
      setChannel('')
      setStatus('')
      setOnlyErrors(false)
      setSearch('')
      return
    }

    setDomain('')
    setKind('')
    setEntityType('system-error')
    setAction('')
    setActor('')
    setChannel('')
    setStatus('failed')
    setOnlyErrors(true)
    setSearch('')
  }

  const loadLogs = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '80')
      if (search.trim()) params.set('q', search.trim())
      if (domain) params.set('domain', domain)
      if (kind) params.set('kind', kind)
      if (entityType) params.set('entityType', entityType)
      if (action) params.set('action', action)
      if (actor) params.set('actor', actor)
      if (channel) params.set('channel', channel)
      if (status) params.set('status', status)
      if (onlyErrors) params.set('onlyErrors', 'true')

      const response = await fetch(`/api/admin/logs?${params.toString()}`)
      const json = (await response.json().catch(() => null)) as LogResponse | { error?: string } | null

      if (!response.ok || !json || !('ok' in json)) {
        throw new Error((json as { error?: string } | null)?.error || 'Не удалось загрузить логи')
      }

      setData(json)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить логи')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const exportLogs = () => {
    const params = new URLSearchParams()
    params.set('format', 'csv')
    if (search.trim()) params.set('q', search.trim())
    if (domain) params.set('domain', domain)
    if (kind) params.set('kind', kind)
    if (entityType) params.set('entityType', entityType)
    if (action) params.set('action', action)
    if (actor) params.set('actor', actor)
    if (channel) params.set('channel', channel)
    if (status) params.set('status', status)
    if (onlyErrors) params.set('onlyErrors', 'true')
    window.open(`/api/admin/logs?${params.toString()}`, '_blank')
  }

  useEffect(() => {
    loadLogs()
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const items = data?.items || []
    return {
      total: data?.total || 0,
      audit: items.filter((item) => item.kind === 'audit').length,
      notifications: items.filter((item) => item.kind === 'notification').length,
      failed: items.filter((item) => item.status === 'failed').length,
      systemErrors: items.filter((item) => item.entityType === 'system-error').length,
    }
  }, [data])

  return (
    <div className="app-shell-layout">
      <Sidebar />
      <main className="app-main">
        <div className="app-page space-y-6">
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.16),transparent_34%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))] p-6 text-white sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex rounded-2xl bg-sky-500/12 p-4">
                  <ShieldCheck className="h-7 w-7 text-sky-300" />
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">Логирование системы</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  Единый журнал действий по системе: аудит пользователей, изменения сущностей, email и Telegram-уведомления.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={exportLogs} className="min-w-[180px]">
                  <Download className="mr-2 h-4 w-4" />
                  Экспорт CSV
                </Button>
                <Button onClick={() => loadLogs(true)} disabled={refreshing} className="min-w-[180px]">
                  {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Обновить логи
                </Button>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'Всего событий', value: stats.total, icon: Activity },
              { label: 'Аудит', value: stats.audit, icon: ShieldCheck },
              { label: 'Уведомления', value: stats.notifications, icon: BellRing },
              { label: 'Ошибки отправки', value: stats.failed, icon: Filter },
              { label: 'System errors', value: stats.systemErrors, icon: CircleAlert },
            ].map((stat) => {
              const Icon = stat.icon
              return (
                <Card key={stat.label} className="border-white/10 bg-slate-950/65 p-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">{stat.label}</p>
                      <p className="mt-2 text-3xl font-semibold">{stat.value}</p>
                    </div>
                    <div className="rounded-2xl bg-white/6 p-3">
                      <Icon className="h-5 w-5 text-sky-300" />
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>

          <Card className="border-white/10 bg-slate-950/65 p-6 text-white">
            <div className="mb-5 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => applyPreset('all')}>Все</Button>
              <Button variant="outline" onClick={() => applyPreset('auth')}>Авторизация</Button>
              <Button variant="outline" onClick={() => applyPreset('finance')}>Финансы</Button>
              <Button variant="outline" onClick={() => applyPreset('errors')}>Только ошибки</Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-6">
              <div className="lg:col-span-2">
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Поиск</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="entity, action, email, recipient..."
                    className="border-white/10 bg-slate-900/60 pl-10 text-white"
                  />
                </div>
              </div>

              {[
                { label: 'Тип', value: kind, setter: setKind, options: data?.filters.kinds || [] },
                { label: 'Сущность', value: entityType, setter: setEntityType, options: data?.filters.entityTypes || [] },
                { label: 'Действие', value: action, setter: setAction, options: data?.filters.actions || [] },
                { label: 'Кто', value: actor, setter: setActor, options: data?.filters.actors || [] },
              ].map((filter) => (
                <div key={filter.label}>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{filter.label}</label>
                  <select
                    value={filter.value}
                    onChange={(e) => filter.setter(e.target.value)}
                    className="h-10 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white"
                  >
                    <option value="">Все</option>
                    {filter.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              <div className="lg:col-span-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-3">
                <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Канал</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="h-10 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white"
                >
                  <option value="">Все</option>
                  {(data?.filters.channels || []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Статус</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="h-10 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white"
                  >
                    <option value="">Все</option>
                    {(data?.filters.statuses || []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex h-10 items-center gap-3 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={onlyErrors}
                    onChange={(e) => setOnlyErrors(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent"
                  />
                  Только ошибки
                </label>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={() => { setPage(1); loadLogs(true) }}>Применить фильтры</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setDomain('')
                  setKind('')
                  setEntityType('')
                  setAction('')
                  setActor('')
                  setChannel('')
                  setStatus('')
                  setOnlyErrors(false)
                  setPage(1)
                }}
              >
                Сбросить
              </Button>
            </div>
          </Card>

          {loading ? (
            <Card className="border-white/10 bg-slate-950/65 p-6 text-white">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
                Загружаем журнал событий...
              </div>
            </Card>
          ) : error ? (
            <Card className="border-red-500/20 bg-red-500/10 p-6 text-red-200">{error}</Card>
          ) : (
            <div className="space-y-4">
              {(data?.items || []).map((item) => (
                <Card key={item.id} className="border-white/10 bg-slate-950/65 p-5 text-white">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${item.kind === 'audit' ? 'bg-sky-500/10 text-sky-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                          {item.kind === 'audit' ? 'audit' : 'notification'}
                        </span>
                        {item.channel ? (
                          <span className="rounded-full bg-white/6 px-2.5 py-1 text-[11px] font-medium text-slate-300">{item.channel}</span>
                        ) : null}
                        {item.status ? (
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${item.status === 'failed' ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                            {item.status}
                          </span>
                        ) : null}
                        {item.entityType === 'system-error' ? (
                          <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300">
                            error
                          </span>
                        ) : null}
                      </div>

                      <h2 className="mt-3 text-lg font-semibold">{item.title}</h2>
                      {item.subtitle ? <p className="mt-1 text-sm text-slate-400">{item.subtitle}</p> : null}

                      <div className="mt-3 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
                        <div>Время: {new Date(item.createdAt).toLocaleString('ru-RU')}</div>
                        {item.actorEmail ? <div>Кто: {item.actorEmail}</div> : null}
                        {item.entityType ? <div>Сущность: {item.entityType}</div> : null}
                        {item.action ? <div>Действие: {item.action}</div> : null}
                        {item.recipient ? <div>Получатель: {item.recipient}</div> : null}
                      </div>
                    </div>
                  </div>

                  {item.payload ? (
                    <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/8 bg-black/25 p-4 text-xs leading-6 text-slate-300">
                      {JSON.stringify(item.payload, null, 2)}
                    </pre>
                  ) : null}
                </Card>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-400">
                  Страница {data?.page || 1} • всего {data?.total || 0} событий
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={(data?.page || 1) <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                    Назад
                  </Button>
                  <Button
                    variant="outline"
                    disabled={((data?.page || 1) * (data?.limit || 80)) >= (data?.total || 0)}
                    onClick={() => setPage((prev) => prev + 1)}
                  >
                    Вперёд
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
