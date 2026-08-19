'use client'

/**
 * Мониторинг зала — первый вертикальный срез.
 *
 * Экран отвечает на один вопрос: что мы на самом деле знаем о каждом
 * компьютере прямо сейчас. Не «сколько заработали» и не «сколько сессий», а
 * что происходит с железом.
 *
 * Главное правило интерфейса: **станция, о которой мы ничего не знаем, не
 * показывается свободной**. Зелёный цвет обязан означать «проверено, что
 * никого нет», а не «данных нет». Ошибиться здесь опаснее всего, потому что
 * ошибка выглядит достоверно.
 *
 * Экран автономен: он получает данные своим запросом и ничего не берёт из
 * состояния существующей страницы. Если мониторинг упадёт, карта, киоск,
 * тарифы и управление продолжат работать.
 */

import { useCallback, useEffect, useState } from 'react'
import { Activity, CheckCircle2, Loader2, MonitorSmartphone, RefreshCw, ShieldQuestion } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type StationRow = {
  id: string
  name: string
  zone: string | null
  state: string
  freshness: 'fresh' | 'stale' | 'never'
  lastSeenSecondsAgo: number | null
  process: { name: string; classification: string } | null
  lastKnown: { userKind: string | null; process: string | null } | null
  agent: { version: string | null; lastSeenAt: string | null } | null
}

type PendingDevice = {
  id: string
  hostname: string | null
  mac: string | null
  senetWsNum: number | null
  deviceInstanceId: string | null
  requestedAt: string | null
}

type LiveData = {
  serverTime: string
  stateVersion: string
  offlineAfterSec: number
  summary: {
    total: number
    observed: number
    unprovisioned: number
    pendingDevices: number
    offline: number
    available: number
    client: number
    support: number
    unknown: number
    occupancy: number | null
    occupancyDenominator: number
    coverage: number | null
  }
  stations: StationRow[]
  pendingDevices: PendingDevice[]
}

/**
 * Как называется состояние по-человечески.
 *
 * «UNPROVISIONED» на экране не место: владельцу нужно понимать разницу между
 * «наблюдателя нет» и «компьютер выключен», а не читать коды.
 */
const STATE_LABELS: Record<string, { label: string; className: string; hint: string }> = {
  UNPROVISIONED: {
    label: 'нет наблюдателя',
    className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30',
    hint: 'Программа наблюдения на этот компьютер не ставилась. Что там происходит — неизвестно.',
  },
  PENDING: {
    label: 'ждёт подтверждения',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    hint: 'Заявка подана, но вы её ещё не подтвердили. Данные не принимаются.',
  },
  REVOKED: {
    label: 'отозван',
    className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30',
    hint: 'Доступ устройства отозван.',
  },
  OFFLINE: {
    label: 'не отвечает',
    className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
    hint: 'Сигнала нет дольше допустимого. Компьютер выключен, потерял сеть или программа остановлена.',
  },
  AVAILABLE: {
    label: 'свободен',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    hint: 'Компьютер отвечает, в системе никого нет.',
  },
  CLIENT: {
    label: 'клиент',
    className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
    hint: 'За компьютером учётная запись клиента.',
  },
  SUPPORT: {
    label: 'обслуживание',
    className: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
    hint: 'За компьютером техническая учётная запись. Это не проданное время.',
  },
  UNKNOWN: {
    label: 'непонятно',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    hint: 'Сигнал свежий, но кто за компьютером — определить не удалось.',
  },
}

function ago(seconds: number | null): string {
  if (seconds === null) return 'сигнала не было'
  if (seconds < 60) return `${seconds} сек назад`
  if (seconds < 3600) return `${Math.round(seconds / 60)} мин назад`
  return `${Math.round(seconds / 3600)} ч назад`
}

export function ArenaLiveTab(props: {
  projectId: string
  companyId?: string | null
  stations: Array<{ id: string; name: string }>
  canManageDevices: boolean
}) {
  const [data, setData] = useState<LiveData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyDevice, setBusyDevice] = useState<string | null>(null)
  const [pickedStation, setPickedStation] = useState<Record<string, string>>({})
  const [issued, setIssued] = useState<{ deviceToken: string; clientSecret: string; station: string } | null>(null)

  const load = useCallback(
    async (soft = false) => {
      if (!soft) setLoading(true)
      try {
        const params = new URLSearchParams({ project_id: props.projectId })
        if (props.companyId) params.set('company_id', props.companyId)
        const res = await fetch(`/api/admin/arena/live?${params}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        setData(json.data)
        setError(null)
      } catch (e) {
        // Ошибка запроса НЕ означает, что все компьютеры офлайн. Показываем
        // предупреждение и оставляем последние известные данные.
        setError(e instanceof Error ? e.message : 'Не удалось получить данные')
      } finally {
        setLoading(false)
      }
    },
    [props.projectId, props.companyId],
  )

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(true), 10_000)
    return () => clearInterval(timer)
  }, [load])

  async function decide(deviceId: string, action: 'approve' | 'revoke') {
    setBusyDevice(deviceId)
    try {
      const body: Record<string, unknown> = { action, deviceId }
      if (action === 'approve') {
        const stationId = pickedStation[deviceId]
        if (!stationId) {
          setError('Выберите станцию, к которой относится устройство')
          return
        }
        body.stationId = stationId
      }
      const res = await fetch('/api/admin/arena/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`)

      if (action === 'approve' && json?.credentials) {
        setIssued({
          deviceToken: json.credentials.deviceToken,
          clientSecret: json.credentials.clientSecret,
          station: json.stationName,
        })
      }
      setError(null)
      await load(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить действие')
    } finally {
      setBusyDevice(null)
    }
  }

  if (loading && !data) {
    return (
      <Card className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаем состояние зала…
      </Card>
    )
  }

  const s = data?.summary

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          Данные могли устареть: {error}
        </div>
      ) : null}

      {/* Секрет показывается один раз — и это надо сказать прямо. */}
      {issued ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Устройство привязано к станции {issued.station}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Скопируйте эти два значения в программу наблюдения. Показываются один раз — восстановить
            их нельзя, можно только отозвать устройство и подтвердить заново.
          </p>
          <div className="mt-3 space-y-2 font-mono text-xs">
            <div className="rounded border border-border bg-surface-muted p-2 break-all">
              <span className="text-muted-foreground">Токен: </span>
              {issued.deviceToken}
            </div>
            <div className="rounded border border-border bg-surface-muted p-2 break-all">
              <span className="text-muted-foreground">Секрет: </span>
              {issued.clientSecret}
            </div>
          </div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setIssued(null)}>
            Скопировал, скрыть
          </Button>
        </Card>
      ) : null}

      {/* Заявки на наблюдение */}
      {data && data.pendingDevices.length > 0 ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldQuestion className="h-4 w-4 text-amber-600" />
            Новые устройства ждут подтверждения ({data.pendingDevices.length})
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Пока вы не подтвердите устройство, оно не может прислать ни одного наблюдения. Станцию
            выбираете вы: сопоставлять по номерам нельзя — у зала имена станций идут диапазонами.
          </p>

          <div className="mt-3 space-y-2">
            {data.pendingDevices.map((device) => (
              <div key={device.id} className="rounded-lg border border-border p-3">
                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>Компьютер: <span className="text-foreground">{device.hostname || 'не сообщил'}</span></span>
                  <span>MAC: <span className="text-foreground">{device.mac || 'не сообщил'}</span></span>
                  <span>Номер SENET: <span className="text-foreground">{device.senetWsNum ?? 'не сообщил'}</span></span>
                  <span>
                    Заявка: <span className="text-foreground">
                      {device.requestedAt ? new Date(device.requestedAt).toLocaleString('ru-RU') : '—'}
                    </span>
                  </span>
                </div>

                {props.canManageDevices ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select
                      value={pickedStation[device.id] || ''}
                      onValueChange={(value) => setPickedStation((prev) => ({ ...prev, [device.id]: value }))}
                    >
                      <SelectTrigger className="h-9 w-48">
                        <SelectValue placeholder="Выберите станцию" />
                      </SelectTrigger>
                      <SelectContent>
                        {props.stations.map((station) => (
                          <SelectItem key={station.id} value={station.id}>
                            {station.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={busyDevice === device.id}
                      onClick={() => void decide(device.id, 'approve')}
                    >
                      {busyDevice === device.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Подтвердить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyDevice === device.id}
                      onClick={() => void decide(device.id, 'revoke')}
                    >
                      Отклонить
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">Подтверждать устройства может владелец.</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Сводка */}
      {s ? (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Состояние зала
            </div>
            <Button variant="ghost" size="sm" onClick={() => void load(true)} className="h-8 gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Обновить
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {[
              { label: 'Всего станций', value: s.total },
              { label: 'Под наблюдением', value: s.observed },
              { label: 'Свободны', value: s.available },
              { label: 'Клиенты', value: s.client },
              { label: 'Обслуживание', value: s.support },
              { label: 'Не отвечают', value: s.offline },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border p-2.5">
                <div className="text-[11px] text-muted-foreground">{item.label}</div>
                <div className="text-lg font-semibold tabular-nums text-foreground">{item.value}</div>
              </div>
            ))}
          </div>

          {/*
            Загрузка показывается только вместе со знаменателем.
            «Загрузка 27%» при одной наблюдаемой станции из семидесяти семи —
            число, которое врёт, даже будучи посчитанным правильно.
          */}
          <div className="mt-3 rounded-lg bg-surface-muted p-3 text-xs">
            {s.observed === 0 ? (
              <span className="text-muted-foreground">
                Наблюдение пока не ведётся ни за одной станцией — загрузку считать не от чего.
              </span>
            ) : (
              <span className="text-body">
                Загрузка <span className="font-semibold text-foreground">{s.occupancy}%</span> — это{' '}
                {s.client} клиентов из {s.occupancyDenominator} наблюдаемых станций. Наблюдением
                покрыто {s.coverage}% зала ({s.observed} из {s.total}).
              </span>
            )}
          </div>
        </Card>
      ) : null}

      {/* Станции */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Станции</h2>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pl-4 pr-2 font-normal">Станция</th>
                <th className="w-40 py-2 px-2 font-normal">Зона</th>
                <th className="w-44 py-2 px-2 font-normal">Состояние</th>
                <th className="w-40 py-2 px-2 font-normal">Сигнал</th>
                <th className="py-2 px-2 pr-4 font-normal">Что запущено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {(data?.stations || []).map((station) => {
                const meta = STATE_LABELS[station.state] || STATE_LABELS.UNKNOWN
                return (
                  <tr key={station.id} className="hover:bg-surface-hover">
                    <td className="py-2 pl-4 pr-2 font-medium text-foreground">{station.name}</td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">{station.zone || '—'}</td>
                    <td className="py-2 px-2">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}
                        title={meta.hint}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">
                      {station.state === 'UNPROVISIONED' ? '—' : ago(station.lastSeenSecondsAgo)}
                    </td>
                    <td className="py-2 px-2 pr-4 text-xs">
                      {station.process ? (
                        <span className="text-foreground">
                          {station.process.name}
                          <span className="ml-1 text-muted-foreground">
                            ({station.process.classification === 'unknown_candidate' ? 'возможно игра' : station.process.classification})
                          </span>
                        </span>
                      ) : station.lastKnown?.process ? (
                        // Устаревшее наблюдение помечается явно: «offline и играет
                        // в CS2» — утверждение, которое не может быть правдой.
                        <span className="text-muted-foreground">
                          последнее известное: {station.lastKnown.process}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {data ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          Обновлено {new Date(data.serverTime).toLocaleTimeString('ru-RU')} · станция считается не
          отвечающей после {data.offlineAfterSec} секунд молчания · правила состояний {data.stateVersion}
        </p>
      ) : null}
    </div>
  )
}
