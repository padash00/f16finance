'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, List, LogOut, Map as MapIcon, Monitor, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import WorkModeSwitch from '@/components/WorkModeSwitch'
import { toastError, toastInfo } from '@/lib/toast'
import * as api from '@/lib/api'
import type { AppConfig, ArenaMapDecoration, ArenaSession, ArenaStation, ArenaTariff, ArenaZone, BootstrapData, OperatorSession } from '@/types'

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

// ─── Station Card (list view) ──────────────────────────────────────────────────

function StationCard({
  station,
  activeSession,
  tariffs,
  onStart,
  onManage,
}: {
  station: ArenaStation
  activeSession: ArenaSession | undefined
  tariffs: ArenaTariff[]
  onStart: () => void
  onManage: () => void
}) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!activeSession) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [activeSession?.id, activeSession?.ends_at])

  const occupied = !!activeSession
  const tariff = activeSession?.tariff_id ? tariffs.find((t) => t.id === activeSession.tariff_id) : null
  const remainingMs = activeSession ? new Date(activeSession.ends_at).getTime() - now : 0
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

// ─── Arena Map View ────────────────────────────────────────────────────────────

const MAP_CELL = 70
const MAP_GRID_W = 24
const MAP_GRID_H = 14

function decoEmoji(type: string) {
  const map: Record<string, string> = {
    sofa: '🛋', entrance: '🚪', wall: '🧱', desk: '🖥', arrow: '➡️', label: '🏷',
  }
  return map[type] ?? '❓'
}

function ArenaMapView({
  zones,
  stations,
  decorations,
  sessions,
  tariffs,
  onStationClick,
}: {
  zones: ArenaZone[]
  stations: ArenaStation[]
  decorations: ArenaMapDecoration[]
  sessions: ArenaSession[]
  tariffs: ArenaTariff[]
  onStationClick: (station: ArenaStation) => void
}) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const sessionsByStation = new Map(sessions.map(s => [s.station_id, s]))
  const stationsOnMap = stations.filter(s => s.grid_x != null && s.grid_y != null)
  const zonesOnMap = zones.filter(z => z.grid_x != null)

  if (stationsOnMap.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
        <MapIcon className="h-8 w-8 opacity-30" />
        <p className="text-sm">Карта не настроена. Настройте расположение станций на сайте Orda.</p>
      </div>
    )
  }

  return (
    <div className="overflow-auto">
      <div
        className="relative border border-white/10 rounded-lg bg-zinc-900/50"
        style={{ width: MAP_GRID_W * MAP_CELL, height: MAP_GRID_H * MAP_CELL, minWidth: MAP_GRID_W * MAP_CELL }}
      >
        {/* Grid lines */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={MAP_GRID_W * MAP_CELL} height={MAP_GRID_H * MAP_CELL}
        >
          {Array.from({ length: MAP_GRID_W + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i * MAP_CELL} y1={0} x2={i * MAP_CELL} y2={MAP_GRID_H * MAP_CELL} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}
          {Array.from({ length: MAP_GRID_H + 1 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * MAP_CELL} x2={MAP_GRID_W * MAP_CELL} y2={i * MAP_CELL} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}
        </svg>

        {/* Zones */}
        {zonesOnMap.map(zone => {
          const x = zone.grid_x!
          const y = zone.grid_y!
          const w = zone.grid_w ?? 4
          const h = zone.grid_h ?? 4
          const color = zone.color ?? '#3b82f6'
          return (
            <div
              key={zone.id}
              className="absolute rounded pointer-events-none"
              style={{
                left: x * MAP_CELL + 1,
                top: y * MAP_CELL + 1,
                width: w * MAP_CELL - 2,
                height: h * MAP_CELL - 2,
                backgroundColor: color + '18',
                border: `1px solid ${color}44`,
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 truncate rounded-tl rounded-tr px-1.5 text-[9px] font-semibold"
                style={{ backgroundColor: color + '30', color: color }}
              >
                {zone.name}
              </div>
            </div>
          )
        })}

        {/* Decorations */}
        {decorations.map(deco => (
          <div
            key={deco.id}
            className="absolute flex items-center justify-center pointer-events-none select-none"
            style={{
              left: deco.grid_x * MAP_CELL,
              top: deco.grid_y * MAP_CELL,
              width: MAP_CELL,
              height: MAP_CELL,
              fontSize: 28,
              transform: deco.rotation ? `rotate(${deco.rotation}deg)` : undefined,
              opacity: 0.7,
            }}
          >
            {deco.type === 'label' && deco.label
              ? <span className="text-[9px] text-white/50 text-center leading-tight">{deco.label}</span>
              : decoEmoji(deco.type)
            }
          </div>
        ))}

        {/* Stations */}
        {stationsOnMap.map(station => {
          const x = station.grid_x!
          const y = station.grid_y!
          const activeSession = sessionsByStation.get(station.id)
          const occupied = !!activeSession
          const tariff = activeSession?.tariff_id ? tariffs.find(t => t.id === activeSession.tariff_id) : null
          const remainingMs = activeSession ? new Date(activeSession.ends_at).getTime() - now : 0
          const isExpired = occupied && remainingMs <= 0
          const isWarning = occupied && !isExpired && remainingMs < 5 * 60_000

          return (
            <button
              key={station.id}
              type="button"
              onClick={() => onStationClick(station)}
              className="absolute flex flex-col items-center justify-center rounded transition-all active:scale-95"
              style={{
                left: x * MAP_CELL + 1,
                top: y * MAP_CELL + 1,
                width: MAP_CELL - 2,
                height: MAP_CELL - 2,
                zIndex: 4,
                backgroundColor: !occupied
                  ? 'rgba(16,185,129,0.2)'
                  : isExpired
                    ? 'rgba(239,68,68,0.3)'
                    : isWarning
                      ? 'rgba(245,158,11,0.25)'
                      : 'rgba(239,68,68,0.2)',
                border: `1px solid ${
                  !occupied ? 'rgba(16,185,129,0.5)'
                  : isExpired ? 'rgba(239,68,68,0.6)'
                  : isWarning ? 'rgba(245,158,11,0.5)'
                  : 'rgba(239,68,68,0.4)'
                }`,
              }}
            >
              <Monitor
                style={{
                  width: 18, height: 18,
                  color: !occupied ? '#10b981' : isExpired ? '#ef4444' : isWarning ? '#f59e0b' : '#f87171',
                }}
              />
              <span
                className="truncate text-center leading-tight mt-1 font-semibold"
                style={{ fontSize: 11, maxWidth: MAP_CELL - 6, color: 'rgba(255,255,255,0.85)' }}
              >
                {station.name}
              </span>
              {occupied && !isExpired && (
                <span
                  className="leading-none tabular-nums font-bold mt-0.5"
                  style={{
                    fontSize: 12,
                    color: isWarning ? '#f59e0b' : '#10b981',
                  }}
                >
                  {formatRemaining(remainingMs)}
                </span>
              )}
              {isExpired && (
                <span className="text-[10px] font-semibold text-destructive mt-0.5">Истекло</span>
              )}
            </button>
          )
        })}
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
  const [decorations, setDecorations] = useState<ArenaMapDecoration[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')

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
      setDecorations(data.decorations ?? [])
    } catch (err: any) {
      toastError(err?.message || 'Не удалось загрузить зал')
    } finally {
      setLoading(false)
    }
  }, [config, session])

  const pollIntervalRef = useRef<number | null>(null)

  useEffect(() => {
    void loadArena()
    const handleVisibility = () => { if (document.visibilityState === 'visible') void loadArena() }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loadArena])

  // Adaptive polling: 5s with active sessions, 20s when idle
  useEffect(() => {
    if (pollIntervalRef.current !== null) window.clearInterval(pollIntervalRef.current)
    const ms = sessions.length > 0 ? 5_000 : 20_000
    pollIntervalRef.current = window.setInterval(() => void loadArena(), ms)
    return () => {
      if (pollIntervalRef.current !== null) window.clearInterval(pollIntervalRef.current)
    }
  }, [sessions.length, loadArena])

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

  function handleStationClick(station: ArenaStation) {
    const activeSession = sessions.find(s => s.station_id === station.id)
    if (activeSession) {
      setManageTarget({ station, session: activeSession })
    } else {
      setStartTarget(station)
    }
  }

  // ─── Group stations by zone (list view) ──────────────────────────────────────

  const sessionsByStation = new Map(sessions.map((s) => [s.station_id, s]))

  const unzoned = stations.filter((s) => !s.zone_id)
  const zoneGroups = zones.map((z) => ({
    zone: z,
    stations: stations.filter((s) => s.zone_id === z.id),
  })).filter((g) => g.stations.length > 0)

  const hasMapData = stations.some(s => s.grid_x != null)

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Drag region */}
      <div className="h-9 shrink-0 drag-region bg-card" />

      {/* Header */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-5 pb-3 no-drag">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{bootstrap.device.name}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="truncate text-sm text-muted-foreground">{session.operator.name}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2 no-drag">
          {/* Map/List toggle */}
          {hasMapData && (
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-2 py-1.5 text-xs transition ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Список"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('map')}
                className={`px-2 py-1.5 text-xs transition ${viewMode === 'map' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Карта"
              >
                <MapIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

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
        ) : viewMode === 'map' ? (
          <div className="flex flex-col gap-4">
            <ArenaMapView
              zones={zones}
              stations={stations}
              decorations={decorations}
              sessions={sessions}
              tariffs={tariffs}
              onStationClick={handleStationClick}
            />
            {/* Mini summary under map */}
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
                {sessions.reduce((sum, s) => sum + (s.amount || 0), 0).toLocaleString('ru-RU')} ₸
              </span>
            </div>
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
