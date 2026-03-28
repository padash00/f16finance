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
  onConfirm: (tariffId: string, paymentMethod: 'cash' | 'kaspi' | 'mixed', cashAmount: number, kaspiAmount: number, discountPct: number) => void
  onCancel: () => void
  loading: boolean
}) {
  const sorted = tariffs
    .filter(t => t.zone_id === zoneId)
    .sort((a, b) => a.price - b.price)

  const [selected, setSelected] = useState<string>(sorted[0]?.id ?? '')
  const [payMethod, setPayMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [cashAmt, setCashAmt] = useState('')
  const [kaspiAmt, setKaspiAmt] = useState('')
  const [discountPct, setDiscountPct] = useState('')

  const selectedTariff = sorted.find(t => t.id === selected)
  const discPct = Number(discountPct) || 0
  const finalPrice = selectedTariff ? Math.round(selectedTariff.price * (1 - discPct / 100)) : 0

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
        <div className="mb-4 flex flex-col gap-2">
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
                {t.tariff_type === 'time_window' && t.window_end_time ? (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    до {t.window_end_time}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {t.duration_minutes} мин
                  </span>
                )}
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

        {/* Discount */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">Скидка %</span>
          <input
            type="number"
            min="0"
            max="100"
            value={discountPct}
            onChange={e => setDiscountPct(e.target.value)}
            placeholder="0"
            className="w-20 rounded-lg border border-white/10 bg-background px-2 py-1 text-sm text-right"
          />
        </div>

        {/* Final price */}
        {selectedTariff && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-muted/30 px-4 py-2">
            <span className="text-sm text-muted-foreground">К оплате</span>
            <span className="text-lg font-bold">
              {formatMoney(finalPrice)}
              {discPct > 0 && (
                <span className="ml-1.5 text-xs font-normal text-emerald-400">−{discPct}%</span>
              )}
            </span>
          </div>
        )}

        {/* Payment method */}
        <p className="mb-2 text-sm font-medium">Способ оплаты</p>
        <div className="mb-4 flex gap-2">
          {(['cash', 'kaspi', 'mixed'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setPayMethod(m)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium border transition ${
                payMethod === m
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-white/10 text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'cash' ? 'Наличка' : m === 'kaspi' ? 'Каспи' : 'Смешанный'}
            </button>
          ))}
        </div>

        {/* Mixed amounts */}
        {payMethod === 'mixed' && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Наличка ₸</p>
              <input
                type="number"
                min="0"
                value={cashAmt}
                onChange={e => setCashAmt(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Каспи ₸</p>
              <input
                type="number"
                min="0"
                value={kaspiAmt}
                onChange={e => setKaspiAmt(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => selected && onConfirm(selected, payMethod, Number(cashAmt), Number(kaspiAmt), discPct)}
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
  onExtend: (tariffId: string, paymentMethod: 'cash' | 'kaspi' | 'mixed', cashAmount: number, kaspiAmount: number) => void
  onEnd: () => void
  onClose: () => void
  loading: boolean
}) {
  const [mode, setMode] = useState<'view' | 'extend'>('view')

  const sorted = tariffs
    .filter(t => t.zone_id === zoneId)
    .sort((a, b) => a.price - b.price)

  const [selected, setSelected] = useState<string>(sorted[0]?.id ?? '')
  const [extPayMethod, setExtPayMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [extCashAmt, setExtCashAmt] = useState('')
  const [extKaspiAmt, setExtKaspiAmt] = useState('')

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
            <div className="mb-4 flex flex-col gap-2">
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

            {/* Payment method for extension */}
            <p className="mb-2 text-sm font-medium">Способ оплаты</p>
            <div className="mb-4 flex gap-2">
              {(['cash', 'kaspi', 'mixed'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setExtPayMethod(m)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium border transition ${
                    extPayMethod === m
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-white/10 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m === 'cash' ? 'Наличка' : m === 'kaspi' ? 'Каспи' : 'Смешанный'}
                </button>
              ))}
            </div>
            {extPayMethod === 'mixed' && (
              <div className="mb-4 grid grid-cols-2 gap-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Наличка ₸</p>
                  <input type="number" min="0" value={extCashAmt} onChange={e => setExtCashAmt(e.target.value)} placeholder="0" className="w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Каспи ₸</p>
                  <input type="number" min="0" value={extKaspiAmt} onChange={e => setExtKaspiAmt(e.target.value)} placeholder="0" className="w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm" />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => selected && onExtend(selected, extPayMethod, Number(extCashAmt), Number(extKaspiAmt))}
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

// ─── Mass Zone Start Modal ─────────────────────────────────────────────────────

function MassZoneStartModal({
  zone,
  tariffs,
  freeCount,
  onConfirm,
  onCancel,
  loading,
}: {
  zone: ArenaZone
  tariffs: ArenaTariff[]
  freeCount: number
  onConfirm: (tariffId: string, paymentMethod: 'cash' | 'kaspi' | 'mixed', cashAmount: number, kaspiAmount: number) => void
  onCancel: () => void
  loading: boolean
}) {
  const sorted = tariffs
    .filter(t => t.zone_id === zone.id)
    .sort((a, b) => a.price - b.price)

  const [selected, setSelected] = useState<string>(sorted[0]?.id ?? '')
  const [payMethod, setPayMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [cashAmt, setCashAmt] = useState('')
  const [kaspiAmt, setKaspiAmt] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Запустить зону</h2>
          <button type="button" onClick={onCancel} className="rounded-full p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          Зона: <span className="font-medium text-foreground">{zone.name}</span>
          {' · '}<span className="text-emerald-400">{freeCount} свободных станций</span>
        </p>

        <p className="mb-2 text-sm font-medium">Выберите тариф</p>
        <div className="mb-4 flex flex-col gap-2">
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
              Нет тарифов для этой зоны.
            </p>
          )}
        </div>

        <p className="mb-2 text-sm font-medium">Способ оплаты</p>
        <div className="mb-4 flex gap-2">
          {(['cash', 'kaspi', 'mixed'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setPayMethod(m)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium border transition ${
                payMethod === m
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-white/10 text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'cash' ? 'Наличка' : m === 'kaspi' ? 'Каспи' : 'Смешанный'}
            </button>
          ))}
        </div>
        {payMethod === 'mixed' && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Наличка ₸</p>
              <input type="number" min="0" value={cashAmt} onChange={e => setCashAmt(e.target.value)} placeholder="0" className="w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm" />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Каспи ₸</p>
              <input type="number" min="0" value={kaspiAmt} onChange={e => setKaspiAmt(e.target.value)} placeholder="0" className="w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm" />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => selected && onConfirm(selected, payMethod, Number(cashAmt), Number(kaspiAmt))}
            disabled={!selected || loading || sorted.length === 0 || freeCount === 0}
            className="flex-1"
          >
            {loading ? 'Запускаем...' : `Запустить ${freeCount} станций`}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Отмена
          </Button>
        </div>
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

function DecoIcon({ type, width, height, label, rotation }: { type: string; width: number; height: number; label?: string | null; rotation?: number }) {
  const style: React.CSSProperties = { width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: rotation ? `rotate(${rotation}deg)` : undefined }

  if (type === 'wall') return (
    <div style={{ ...style }}>
      <div style={{ width, height, background: 'repeating-linear-gradient(45deg, #4b5563, #4b5563 5px, #374151 5px, #374151 10px)', borderRadius: 2, opacity: 0.95 }} />
    </div>
  )

  if (type === 'label') return (
    <div style={{ ...style, padding: 4 }}>
      <span style={{ fontSize: Math.max(9, Math.min(13, width / 5)), color: 'rgba(255,255,255,0.65)', textAlign: 'center', wordBreak: 'break-word', lineHeight: 1.2 }}>{label || 'Text'}</span>
    </div>
  )

  if (type === 'entrance') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.8} height={height * 0.8} fill="none">
        <rect x="4" y="4" width="32" height="36" rx="2" stroke="#60a5fa" strokeWidth="2.5" fill="#60a5fa18"/>
        <path d="M20 4 Q36 4 36 20" stroke="#60a5fa" strokeWidth="2" fill="none"/>
        <circle cx="30" cy="22" r="2" fill="#60a5fa"/>
      </svg>
    </div>
  )

  if (type === 'sofa') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.85} height={height * 0.85} fill="none">
        <rect x="3" y="18" width="34" height="16" rx="4" fill="#7c3aed55" stroke="#7c3aed" strokeWidth="2"/>
        <rect x="3" y="12" width="34" height="10" rx="3" fill="#7c3aed33" stroke="#7c3aed" strokeWidth="1.5"/>
        <rect x="3" y="12" width="6" height="22" rx="3" fill="#7c3aed55" stroke="#7c3aed" strokeWidth="1.5"/>
        <rect x="31" y="12" width="6" height="22" rx="3" fill="#7c3aed55" stroke="#7c3aed" strokeWidth="1.5"/>
      </svg>
    </div>
  )

  if (type === 'desk') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.85} height={height * 0.85} fill="none">
        <rect x="3" y="10" width="34" height="20" rx="3" fill="#d9770633" stroke="#d97706" strokeWidth="2"/>
        <line x1="10" y1="30" x2="10" y2="38" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="30" y1="30" x2="30" y2="38" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    </div>
  )

  if (type === 'tv') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.85} height={height * 0.85} fill="none">
        <rect x="3" y="6" width="34" height="24" rx="3" fill="#06b6d433" stroke="#06b6d4" strokeWidth="2"/>
        <rect x="7" y="10" width="26" height="16" rx="1" fill="#06b6d418"/>
        <line x1="20" y1="30" x2="20" y2="36" stroke="#06b6d4" strokeWidth="2"/>
        <line x1="13" y1="36" x2="27" y2="36" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </div>
  )

  if (type === 'bar') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.85} height={height * 0.85} fill="none">
        <rect x="3" y="14" width="34" height="6" rx="2" fill="#f59e0b55" stroke="#f59e0b" strokeWidth="2"/>
        <rect x="5" y="20" width="30" height="14" rx="2" fill="#f59e0b22" stroke="#f59e0b" strokeWidth="1.5"/>
        <line x1="13" y1="20" x2="13" y2="34" stroke="#f59e0b" strokeWidth="1" opacity="0.5"/>
        <line x1="20" y1="20" x2="20" y2="34" stroke="#f59e0b" strokeWidth="1" opacity="0.5"/>
        <line x1="27" y1="20" x2="27" y2="34" stroke="#f59e0b" strokeWidth="1" opacity="0.5"/>
      </svg>
    </div>
  )

  if (type === 'column') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.7} height={height * 0.7} fill="none">
        <circle cx="20" cy="20" r="14" fill="#64748b44" stroke="#64748b" strokeWidth="2.5"/>
        <circle cx="20" cy="20" r="8" fill="#64748b33" stroke="#64748b" strokeWidth="1.5"/>
      </svg>
    </div>
  )

  if (type === 'window') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.8} height={height * 0.8} fill="none">
        <rect x="3" y="3" width="34" height="34" rx="2" fill="#bae6fd18" stroke="#7dd3fc" strokeWidth="2"/>
        <line x1="20" y1="3" x2="20" y2="37" stroke="#7dd3fc" strokeWidth="1.5"/>
        <line x1="3" y1="20" x2="37" y2="20" stroke="#7dd3fc" strokeWidth="1.5"/>
      </svg>
    </div>
  )

  if (type === 'stairs') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.8} height={height * 0.8} fill="none">
        <path d="M5 35 L5 25 L15 25 L15 17 L25 17 L25 9 L35 9 L35 35 Z" fill="#84cc1633" stroke="#84cc16" strokeWidth="2" strokeLinejoin="round"/>
      </svg>
    </div>
  )

  if (type === 'arrow') return (
    <div style={style}>
      <svg viewBox="0 0 40 40" width={width * 0.8} height={height * 0.8} fill="none">
        <path d="M5 20 L28 20 M20 10 L33 20 L20 30" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  )

  // fallback
  return <div style={{ ...style, fontSize: Math.min(width, height) * 0.5, opacity: 0.6 }}>?</div>
}

function ArenaMapView({
  zones,
  stations,
  decorations,
  sessions,
  tariffs,
  operators,
  onStationClick,
}: {
  zones: ArenaZone[]
  stations: ArenaStation[]
  decorations: ArenaMapDecoration[]
  sessions: ArenaSession[]
  tariffs: ArenaTariff[]
  operators: import('@/types').BootstrapOperator[]
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
    <div className="overflow-auto rounded-xl">
      <div
        className="relative rounded-xl bg-zinc-950"
        style={{
          width: MAP_GRID_W * MAP_CELL,
          height: MAP_GRID_H * MAP_CELL,
          minWidth: MAP_GRID_W * MAP_CELL,
          backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.015) 0%, transparent 80%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)',
        }}
      >
        {/* Grid lines */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={MAP_GRID_W * MAP_CELL} height={MAP_GRID_H * MAP_CELL}
        >
          {Array.from({ length: MAP_GRID_W + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i * MAP_CELL} y1={0} x2={i * MAP_CELL} y2={MAP_GRID_H * MAP_CELL} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          ))}
          {Array.from({ length: MAP_GRID_H + 1 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * MAP_CELL} x2={MAP_GRID_W * MAP_CELL} y2={i * MAP_CELL} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
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
              className="absolute rounded-lg pointer-events-none"
              style={{
                left: x * MAP_CELL + 1,
                top: y * MAP_CELL + 1,
                width: w * MAP_CELL - 2,
                height: h * MAP_CELL - 2,
                backgroundColor: color + '15',
                border: `1.5px solid ${color}55`,
                boxShadow: `inset 0 0 20px ${color}08`,
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 px-2 py-0.5 text-[10px] font-bold tracking-wide truncate rounded-tl-lg rounded-tr-lg"
                style={{ backgroundColor: color + '35', color: color }}
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
            className="absolute pointer-events-none select-none"
            style={{
              left: deco.grid_x * MAP_CELL,
              top: deco.grid_y * MAP_CELL,
              width: deco.grid_w * MAP_CELL,
              height: deco.grid_h * MAP_CELL,
              opacity: 0.85,
            }}
          >
            <DecoIcon type={deco.type} width={deco.grid_w * MAP_CELL} height={deco.grid_h * MAP_CELL} label={deco.label} rotation={deco.rotation} />
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

          const stColor = !occupied ? '#10b981' : isExpired ? '#ef4444' : isWarning ? '#f59e0b' : '#f87171'
          const stBg = !occupied
            ? 'rgba(16,185,129,0.13)'
            : isExpired ? 'rgba(239,68,68,0.22)' : isWarning ? 'rgba(245,158,11,0.18)' : 'rgba(239,68,68,0.16)'
          const stBorder = !occupied
            ? 'rgba(16,185,129,0.45)' : isExpired ? 'rgba(239,68,68,0.65)' : isWarning ? 'rgba(245,158,11,0.55)' : 'rgba(239,68,68,0.35)'

          return (
            <button
              key={station.id}
              type="button"
              onClick={() => onStationClick(station)}
              className="absolute flex flex-col items-center justify-center rounded-lg transition-all active:scale-95 hover:brightness-125"
              style={{
                left: x * MAP_CELL + 2,
                top: y * MAP_CELL + 2,
                width: MAP_CELL - 4,
                height: MAP_CELL - 4,
                zIndex: 4,
                backgroundColor: stBg,
                border: `1.5px solid ${stBorder}`,
                boxShadow: isWarning ? `0 0 10px ${stColor}55` : isExpired ? `0 0 8px rgba(239,68,68,0.4)` : 'none',
                gap: 1,
              }}
            >
              <Monitor style={{ width: 16, height: 16, color: stColor, flexShrink: 0 }} />
              <span
                className="truncate text-center font-semibold leading-none"
                style={{ fontSize: 10, maxWidth: MAP_CELL - 8, color: 'rgba(255,255,255,0.9)' }}
              >
                {station.name}
              </span>
              {!occupied && (
                <span style={{ fontSize: 9, color: '#10b981', opacity: 0.7 }}>свободно</span>
              )}
              {occupied && !isExpired && (
                <span
                  className="tabular-nums font-bold leading-none"
                  style={{ fontSize: 13, color: isWarning ? '#f59e0b' : '#34d399' }}
                >
                  {formatRemaining(remainingMs)}
                </span>
              )}
              {isExpired && (
                <span className="font-semibold leading-none" style={{ fontSize: 9, color: '#ef4444' }}>Истекло</span>
              )}
              {occupied && activeSession && (() => {
                const op = activeSession.operator_id ? operators.find(o => o.id === activeSession.operator_id) : null
                return (
                  <span
                    className="truncate text-center leading-none"
                    style={{ fontSize: 9, maxWidth: MAP_CELL - 8, color: 'rgba(255,255,255,0.4)' }}
                  >
                    {op ? (op.short_name || op.name) : ''}{op ? ' · ' : ''}{formatMoney(activeSession.amount)}
                  </span>
                )
              })()}
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
  const [massStartTarget, setMassStartTarget] = useState<ArenaZone | null>(null)

  // Track which sessions we've already alerted/notified
  const notifiedRef = useRef<Set<string>>(new Set())

  // Track previous session IDs to detect ended sessions
  const prevSessionIdsRef = useRef<Set<string>>(new Set())

  // ─── Load data ──────────────────────────────────────────────────────────────

  const loadArena = useCallback(async () => {
    try {
      const data = await api.getArena(config, session)
      setZones(data.zones)
      setStations(data.stations)
      setTariffs(data.tariffs)
      const newSessions: ArenaSession[] = data.sessions
      const newIds = new Set(newSessions.map((s: ArenaSession) => s.id))
      // Detect ended sessions (were in prev, not in current)
      const endedCount = [...prevSessionIdsRef.current].filter(id => !newIds.has(id)).length
      if (endedCount > 0 && prevSessionIdsRef.current.size > 0) {
        for (let i = 0; i < endedCount; i++) {
          try {
            const ctx = new AudioContext()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = 440
            gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3)
            osc.start(ctx.currentTime + i * 0.15)
            osc.stop(ctx.currentTime + i * 0.15 + 0.3)
          } catch { /* ignore */ }
        }
      }
      prevSessionIdsRef.current = newIds
      setSessions(newSessions)
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

  async function handleStart(tariffId: string, payMethod: 'cash' | 'kaspi' | 'mixed', cashAmt: number, kaspiAmt: number, discPct: number) {
    if (!startTarget) return
    setActionLoading(true)
    try {
      const newSession = await api.startArenaSession(config, session, {
        stationId: startTarget.id,
        tariffId,
        operatorId: session.operator.operator_id,
        payment_method: payMethod,
        cash_amount: cashAmt,
        kaspi_amount: kaspiAmt,
        discount_percent: discPct,
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

  async function handleExtend(tariffId: string, payMethod: 'cash' | 'kaspi' | 'mixed', cashAmt: number, kaspiAmt: number) {
    if (!manageTarget) return
    setActionLoading(true)
    try {
      const updated = await api.extendArenaSession(config, session, manageTarget.session.id, tariffId, {
        payment_method: payMethod,
        cash_amount: cashAmt,
        kaspi_amount: kaspiAmt,
      })
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      setManageTarget(null)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось продлить сессию')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleMassStart(zoneId: string, tariffId: string, payMethod: 'cash' | 'kaspi' | 'mixed', cashAmt: number, kaspiAmt: number) {
    const freeStations = stations.filter(s =>
      s.zone_id === zoneId &&
      s.is_active &&
      !sessions.find(sess => sess.station_id === s.id)
    )
    if (freeStations.length === 0) return
    setActionLoading(true)
    // Launch all free stations simultaneously
    await Promise.allSettled(freeStations.map(st =>
      api.startArenaSession(config, session, {
        stationId: st.id,
        tariffId,
        operatorId: session.operator.operator_id,
        payment_method: payMethod,
        cash_amount: cashAmt,
        kaspi_amount: kaspiAmt,
        discount_percent: 0,
      })
    ))
    await loadArena()
    setActionLoading(false)
    setMassStartTarget(null)
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
              operators={bootstrap.operators}
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
            {zoneGroups.map(({ zone, stations: zoneStations }) => {
              const freeInZone = zoneStations.filter(st => !sessionsByStation.has(st.id)).length
              return (
                <section key={zone.id}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {zone.name}
                    </h2>
                    {freeInZone > 0 && tariffs.some(t => t.zone_id === zone.id) && (
                      <button
                        type="button"
                        onClick={() => setMassStartTarget(zone)}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition"
                      >
                        Запустить зону
                      </button>
                    )}
                  </div>
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
              )
            })}

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

      {/* Mass zone start modal */}
      {massStartTarget && (
        <MassZoneStartModal
          zone={massStartTarget}
          tariffs={tariffs}
          freeCount={stations.filter(s => s.zone_id === massStartTarget.id && s.is_active && !sessions.find(sess => sess.station_id === s.id)).length}
          onConfirm={(tariffId, payMethod, cashAmt, kaspiAmt) => handleMassStart(massStartTarget.id, tariffId, payMethod, cashAmt, kaspiAmt)}
          onCancel={() => setMassStartTarget(null)}
          loading={actionLoading}
        />
      )}
    </div>
  )
}
