'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, LogOut, Monitor, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import WorkModeSwitch from '@/components/WorkModeSwitch'
import { toastError, toastInfo } from '@/lib/toast'
import * as api from '@/lib/api'
import type { AppConfig, ArenaSession, ArenaStation, ArenaTariff, ArenaZone, BootstrapData, OperatorSession } from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onLogout: () => void
  onSwitchToShift?: () => void
  onSwitchToSale?: () => void
  onSwitchToScanner?: () => void
  onSwitchToRequest?: () => void
  onOpenCabinet?: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(n: number) {
  return n.toLocaleString('ru-RU') + ' ₸'
}

function getRemainingMs(endsAt: string): number {
  return new Date(endsAt).getTime() - Date.now()
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSec = Math.ceil(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Start Session Modal ───────────────────────────────────────────────────────

function StartSessionModal({
  station,
  tariffs,
  zoneId,
  onConfirm,
  onCancel,
  loading,
}: {
  station: ArenaStation
  tariffs: ArenaTariff[]
  zoneId: string | null
  onConfirm: (tariffId: string) => void
  onCancel: () => void
  loading: boolean
}) {
  const sorted = tariffs
    .filter(t => t.zone_id === zoneId)
    .sort((a, b) => a.price - b.price)

  const [selected, setSelected] = useState<string>(sorted[0]?.id ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Запустить сессию</h2>
          <button type="button" onClick={onCancel} className="rounded-full p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          Станция: <span className="font-medium text-foreground">{station.name}</span>
        </p>

        <p className="mb-2 text-sm font-medium">Выберите тариф</p>
        <div className="mb-6 flex flex-col gap-2">
          {sorted.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${
                selected === t.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
            >
              <span className="font-medium">{t.name}</span>
              <span className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {t.duration_minutes} мин
                </span>
                <span className="font-semibold text-foreground">{formatMoney(t.price)}</span>
              </span>
            </button>
          ))}
          {sorted.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Нет тарифов для этой зоны. Добавьте тарифы на сайте Orda.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || loading || sorted.length === 0}
            className="flex-1"
          >
            {loading ? 'Запускаем...' : 'Запустить'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Отмена
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Manage Session Modal ──────────────────────────────────────────────────────

function ManageSessionModal({
  station,
  session: arenaSession,
  tariffs,
  zoneId,
  onExtend,
  onEnd,
  onClose,
  loading,
}: {
  station: ArenaStation
  session: ArenaSession
  tariffs: ArenaTariff[]
  zoneId: string | null
  onExtend: (tariffId: string) => void
  onEnd: () => void
  onClose: () => void
  loading: boolean
}) {
  const [mode, setMode] = useState<'view' | 'extend'>('view')

  const sorted = tariffs
    .filter(t => t.zone_id === zoneId)
    .sort((a, b) => a.price - b.price)

  const [selected, setSelected] = useState<string>(sorted[0]?.id ?? '')
  const remainingMs = getRemainingMs(arenaSession.ends_at)
  const isExpired = remainingMs <= 0
  const endsAt = new Date(arenaSession.ends_at)
  const timeStr = endsAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{station.name}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'view' ? (
          <>
            <div className="mb-5 rounded-xl bg-muted/40 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Оканчивается в</span>
                <span className="font-medium">{timeStr}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Осталось</span>
                <span className={`font-bold text-base ${isExpired ? 'text-destructive' : remainingMs < 5 * 60_000 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {isExpired ? 'Истекло' : formatRemaining(remainingMs)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Сумма</span>
                <span className="font-medium">{formatMoney(arenaSession.amount)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button type="button" variant="outline" onClick={() => setMode('extend')} disabled={loading}>
                Продлить
              </Button>
              <Button type="button" variant="destructive" onClick={onEnd} disabled={loading}>
                {loading ? 'Завершаем...' : 'Завершить сессию'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium">Выберите тариф для продления</p>
            <div className="mb-5 flex flex-col gap-2">
              {sorted.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t.id)}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${
                    selected === t.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  <span className="font-medium">{t.name}</span>
                  <span className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t.duration_minutes} мин
                    </span>
                    <span className="font-semibold text-foreground">{formatMoney(t.price)}</span>
                  </span>
                </button>
              ))}
              {sorted.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Нет тарифов для этой зоны. Добавьте тарифы на сайте Orda.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => selected && onExtend(selected)}
                disabled={!selected || loading || sorted.length === 0}
                className="flex-1"
              >
                {loading ? 'Продлеваем...' : 'Подтвердить'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setMode('view')} disabled={loading}>
                Назад
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Station Card ─────────────────────────────────────────────────────────────

function StationCard({
  station,
  activeSession,
  tariffs,
  onStart,
  onManage,
  tick,
}: {
  station: ArenaStation
  activeSession: ArenaSession | undefined
  tariffs: ArenaTariff[]
  onStart: () => void
  onManage: () => void
  tick: number
}) {
  void tick
  const occupied = !!activeSession
  const tariff = activeSession?.tariff_id ? tariffs.find((t) => t.id === activeSession.tariff_id) : null
  const remainingMs = activeSession ? getRemainingMs(activeSession.ends_at) : 0
  const totalMs = tariff ? tariff.duration_minutes * 60_000 : 0
  const progressPct = occupied && totalMs > 0
    ? Math.max(0, Math.min(100, (remainingMs / totalMs) * 100))
    : 0
  const isExpired = occupied && remainingMs <= 0
  const isWarning = occupied && !isExpired && remainingMs < 5 * 60_000

  const endTime = activeSession
    ? new Date(activeSession.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-300 ${
        !occupied
          ? 'border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-transparent hover:border-emerald-500/40 hover:from-emerald-500/10'
          : isExpired
            ? 'border-destructive/40 bg-gradient-to-b from-destructive/10 to-transparent'
            : isWarning
              ? 'border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-transparent'
              : 'border-red-500/25 bg-gradient-to-b from-red-500/8 to-transparent'
      }`}
    >
      {/* Progress bar at top */}
      {occupied && totalMs > 0 && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10">
          <div
            className={`h-full transition-all duration-1000 ${
              isWarning ? 'bg-amber-500' : isExpired ? 'bg-destructive' : 'bg-emerald-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      <div className="p-4">
        {/* Station name + status */}
        <div className="mb-3 flex items-start justify-between gap-2">
          <p className="font-semibold text-sm leading-snug">{station.name}</p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              !occupied
                ? 'bg-emerald-500/15 text-emerald-400'
                : isExpired
                  ? 'bg-destructive/20 text-destructive'
                  : isWarning
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-red-500/15 text-red-400'
            }`}
          >
            {!occupied ? 'Свободно' : isExpired ? 'Истекло' : isWarning ? '⚠ Скоро' : 'Занято'}
          </span>
        </div>

        {/* Session info */}
        {occupied && activeSession ? (
          <div className="mb-4 space-y-2">
            {tariff && (
              <p className="text-xs font-medium text-muted-foreground">{tariff.name}</p>
            )}
            {/* Big countdown */}
            <div
              className={`text-3xl font-bold tabular-nums tracking-tight ${
                isExpired ? 'text-destructive' : isWarning ? 'text-amber-400' : 'text-foreground'
              }`}
            >
              {isExpired ? '—:——' : formatRemaining(remainingMs)}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>до {endTime}</span>
              <span className="font-medium text-foreground">{formatMoney(activeSession.amount)}</span>
            </div>
          </div>
        ) : (
          <div className="mb-4 h-[72px] flex items-center justify-center">
            <div className="text-muted-foreground/30">
              <Monitor className="h-8 w-8" />
            </div>
          </div>
        )}

        {/* Action button */}
        <button
          type="button"
          onClick={occupied ? onManage : onStart}
          className={`w-full rounded-xl py-2 text-sm font-semibold transition-all ${
            !occupied
              ? 'bg-emerald-500 text-white hover:bg-emerald-400 active:scale-95'
              : 'border border-white/15 bg-white/5 text-foreground hover:bg-white/10 active:scale-95'
          }`}
        >
          {occupied ? 'Управление' : 'Запустить'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ArenaPage({
  config,
  bootstrap,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToSale,
  onSwitchToScanner,
  onSwitchToRequest,
  onOpenCabinet,
}: Props) {
  const [zones, setZones] = useState<ArenaZone[]>([])
  const [stations, setStations] = useState<ArenaStation[]>([])
  const [tariffs, setTariffs] = useState<ArenaTariff[]>([])
  const [sessions, setSessions] = useState<ArenaSession[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [tick, setTick] = useState(0)

  // Modal state
  const [startTarget, setStartTarget] = useState<ArenaStation | null>(null)
  const [manageTarget, setManageTarget] = useState<{ station: ArenaStation; session: ArenaSession } | null>(null)

  // Track which sessions we've already alerted/notified
  const notifiedRef = useRef<Set<string>>(new Set())

  // ─── Load data ──────────────────────────────────────────────────────────────

  const loadArena = useCallback(async () => {
    try {
      const data = await api.getArena(config, session)
      setZones(data.zones)
      setStations(data.stations)
      setTariffs(data.tariffs)
      setSessions(data.sessions)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось загрузить зал')
    } finally {
      setLoading(false)
    }
  }, [config, session])

  useEffect(() => {
    void loadArena()
    const interval = window.setInterval(() => {
      void loadArena()
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [loadArena])

  // ─── Second-tick for countdowns ──────────────────────────────────────────────

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTick((n) => n + 1)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  // ─── 5-min notification check ────────────────────────────────────────────────

  useEffect(() => {
    for (const s of sessions) {
      if (notifiedRef.current.has(s.id)) continue
      const remaining = getRemainingMs(s.ends_at)
      if (remaining > 0 && remaining <= 5 * 60_000) {
        notifiedRef.current.add(s.id)
        void api.notifyArena5min(config, session, s.id)
        const st = stations.find((x) => x.id === s.station_id)
        toastInfo(`⏰ ${st?.name ?? 'Станция'}: осталось менее 5 мин`, 8000)
        // Play beep via Web Audio
        try {
          const ctx = new AudioContext()
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.frequency.value = 880
          gain.gain.setValueAtTime(0.3, ctx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
          osc.start(ctx.currentTime)
          osc.stop(ctx.currentTime + 0.5)
        } catch { /* ignore */ }
      }
    }
  }, [sessions, stations, config, session])

  // Clear notification tracker for sessions that ended
  useEffect(() => {
    const activeIds = new Set(sessions.map((s) => s.id))
    for (const id of notifiedRef.current) {
      if (!activeIds.has(id)) notifiedRef.current.delete(id)
    }
  }, [sessions])

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function handleStart(tariffId: string) {
    if (!startTarget) return
    setActionLoading(true)
    try {
      const newSession = await api.startArenaSession(config, session, {
        stationId: startTarget.id,
        tariffId,
        operatorId: session.operator.operator_id,
      })
      setSessions((prev) => [...prev, newSession])
      setStartTarget(null)
      toastInfo(`Сессия запущена: ${startTarget.name}`)
    } catch (err: any) {
      if (err?.message === 'station-already-occupied') {
        toastError('Станция уже занята. Обновите список.')
        void loadArena()
      } else {
        toastError(err?.message || 'Не удалось запустить сессию')
      }
    } finally {
      setActionLoading(false)
    }
  }

  async function handleEnd() {
    if (!manageTarget) return
    setActionLoading(true)
    try {
      await api.endArenaSession(config, session, manageTarget.session.id)
      setSessions((prev) => prev.filter((s) => s.id !== manageTarget.session.id))
      setManageTarget(null)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось завершить сессию')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleExtend(tariffId: string) {
    if (!manageTarget) return
    setActionLoading(true)
    try {
      const updated = await api.extendArenaSession(config, session, manageTarget.session.id, tariffId)
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      setManageTarget(null)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось продлить сессию')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── Group stations by zone ──────────────────────────────────────────────────

  const sessionsByStation = new Map(sessions.map((s) => [s.station_id, s]))

  const unzoned = stations.filter((s) => !s.zone_id)
  const zoneGroups = zones.map((z) => ({
    zone: z,
    stations: stations.filter((s) => s.zone_id === z.id),
  })).filter((g) => g.stations.length > 0)

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Drag region */}
      <div className="h-9 drag-region absolute inset-x-0 top-0 z-10" />

      {/* Header */}
      <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border/60 px-4 pt-9">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{bootstrap.device.name}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="truncate text-sm text-muted-foreground">{session.operator.name}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2 no-drag">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Обновить"
            onClick={loadArena}
            className="rounded-lg px-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

          <WorkModeSwitch
            active="arena"
            showSale={!!onSwitchToSale}
            showScanner={!!onSwitchToScanner}
            showRequest={!!onSwitchToRequest}
            showArena
            onShift={onSwitchToShift}
            onSale={onSwitchToSale}
            onScanner={onSwitchToScanner}
            onRequest={onSwitchToRequest}
            onCabinet={onOpenCabinet}
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Выйти"
            onClick={onLogout}
            className="rounded-lg px-2 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            <span className="animate-spin mr-2 inline-block h-4 w-4 rounded-full border-2 border-border border-t-foreground" />
            Загрузка...
          </div>
        ) : stations.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Monitor className="h-8 w-8 opacity-30" />
            <p className="text-sm">Нет станций. Добавьте их на сайте Orda.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Zones */}
            {zoneGroups.map(({ zone, stations: zoneStations }) => (
              <section key={zone.id}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {zone.name}
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {zoneStations.map((st) => (
                    <StationCard
                      key={st.id}
                      station={st}
                      activeSession={sessionsByStation.get(st.id)}
                      tariffs={tariffs}
                      tick={tick}
                      onStart={() => setStartTarget(st)}
                      onManage={() => {
                        const s = sessionsByStation.get(st.id)
                        if (s) setManageTarget({ station: st, session: s })
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* Unzoned */}
            {unzoned.length > 0 && (
              <section>
                {zoneGroups.length > 0 && (
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Без зоны
                  </h2>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {unzoned.map((st) => (
                    <StationCard
                      key={st.id}
                      station={st}
                      activeSession={sessionsByStation.get(st.id)}
                      tariffs={tariffs}
                      tick={tick}
                      onStart={() => setStartTarget(st)}
                      onManage={() => {
                        const s = sessionsByStation.get(st.id)
                        if (s) setManageTarget({ station: st, session: s })
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Summary */}
            <div className="flex items-center gap-4 rounded-xl bg-muted/30 px-4 py-3 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {stations.length - sessions.length} свободно
              </span>
              <span className="flex items-center gap-1.5 text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {sessions.length} занято
              </span>
              <span className="ml-auto text-muted-foreground">
                {sessions.reduce((sum, s) => sum + (s.amount || 0), 0).toLocaleString('ru-RU')} ₸ за сессии
              </span>
            </div>
          </div>
        )}
      </main>

      {/* Start session modal */}
      {startTarget && tariffs.length > 0 && (
        <StartSessionModal
          station={startTarget}
          tariffs={tariffs}
          zoneId={startTarget.zone_id}
          onConfirm={handleStart}
          onCancel={() => setStartTarget(null)}
          loading={actionLoading}
        />
      )}

      {/* Manage session modal */}
      {manageTarget && (
        <ManageSessionModal
          station={manageTarget.station}
          session={manageTarget.session}
          tariffs={tariffs}
          zoneId={manageTarget.station.zone_id}
          onExtend={handleExtend}
          onEnd={handleEnd}
          onClose={() => setManageTarget(null)}
          loading={actionLoading}
        />
      )}
    </div>
  )
}
