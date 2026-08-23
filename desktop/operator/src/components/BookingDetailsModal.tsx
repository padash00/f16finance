/**
 * Карточка брони — то, что открывается кликом по забронированной станции.
 *
 * До этого клик по такой станции открывал форму создания новой брони: система
 * знала, что место обещано, а показать это обещание было негде. Оператору
 * звонили отменять, и он ничего не мог сделать.
 *
 * Здесь видно, кто и на когда записан, и отсюда бронь отменяется — этот ПК или
 * вся компания. Причина отмены пишется в своё поле и не затирает заметку,
 * оставленную при бронировании.
 *
 * Отсюда же бронь переносится и продлевается: «давайте не на девять, а на
 * десять» не должно означать отменить и завести заново.
 */

import { useState } from 'react'

import * as api from '../lib/api'
import type { StationBooking } from '../lib/api'
import { toastError, toastSuccess } from '../lib/toast'
import type { AppConfig, OperatorSession } from '../types'

type Props = {
  config: AppConfig
  session: OperatorSession
  /** Бронь, по которой кликнули. */
  booking: StationBooking
  /** Вся компания: строки с тем же groupId, включая текущую. */
  groupBookings: StationBooking[]
  onChanged: () => void
  onClose: () => void
  /** Завести ещё одну бронь на эту же станцию — на другое время. */
  onBookAnother?: () => void
}

/**
 * Готовые причины отмены.
 *
 * Свободное поле оператор в спешке не заполняет, и в базе остаются пустые
 * отмены. Кнопкой — заполняет, потому что это одно нажатие.
 */
const REASONS = ['Передумал', 'Не дозвонились', 'Перенесли на другое время', 'Опоздал, место отдали']

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Время в поле ввода: местное, в формате datetime-local. */
function toInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function BookingDetailsModal({
  config,
  session,
  booking,
  groupBookings,
  onChanged,
  onClose,
  onBookAnother,
}: Props) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<'one' | 'group' | null>(null)

  // Перенос: поля показываются по кнопке, чтобы карточка оставалась про
  // «кто и на когда», а не про редактирование.
  const [moving, setMoving] = useState(false)
  const [newStart, setNewStart] = useState(() => toInputValue(new Date(booking.startsAt)))
  const [newEnd, setNewEnd] = useState(() => toInputValue(new Date(booking.endsAt)))
  const [moveError, setMoveError] = useState<string | null>(null)

  const isGroup = Boolean(booking.groupId) && groupBookings.length > 1
  const stationNames = groupBookings.map((b) => b.stationName || '—')
  const started = new Date(booking.startsAt).getTime() <= Date.now()

  /**
   * Сдвинуть бронь целиком или продлить конец.
   *
   * `shiftMinutes` двигает оба конца — «перенесите на час позже».
   * `extendMinutes` двигает только конец — «мы задержимся».
   */
  async function quickMove(options: { shiftMinutes?: number; extendMinutes?: number }) {
    const start = new Date(booking.startsAt)
    const end = new Date(booking.endsAt)
    const shift = options.shiftMinutes ?? 0
    const extend = options.extendMinutes ?? 0
    await move(
      new Date(start.getTime() + shift * 60_000),
      new Date(end.getTime() + (shift + extend) * 60_000),
    )
  }

  async function move(start: Date, end: Date) {
    setMoveError(null)
    if (!(end > start)) {
      setMoveError('Конец брони должен быть позже начала.')
      return
    }
    setBusy(true)
    try {
      const result = await api.rescheduleBooking(config, session, booking.id, {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      })
      const names = result.stationNames?.length ? result.stationNames.join(', ') : booking.stationName || ''
      toastSuccess(
        `Перенесено: ${names || 'бронь'} · ${start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
      )
      onChanged()
    } catch (e: any) {
      // Сервер объясняет отказ конкретно: чем занято и до скольки. Пересказ
      // своими словами потерял бы часы, которые оператор сейчас назовёт вслух.
      setMoveError(e?.message || 'Не удалось перенести бронь')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(wholeGroup: boolean) {
    setBusy(true)
    try {
      const result = await api.cancelBooking(config, session, booking.id, {
        wholeGroup,
        reason: reason.trim() || null,
      })
      const names = result.stationNames?.length ? result.stationNames.join(', ') : booking.stationName || ''
      toastSuccess(names ? `Бронь снята: ${names}` : 'Бронь отменена')
      onChanged()
    } catch (e: any) {
      toastError(e?.message || 'Не удалось отменить бронь')
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            {isGroup ? `Бронь: ${groupBookings.length} ПК` : `Бронь ${booking.stationName || ''}`}
          </h2>
          <span className="text-xs text-violet-300">
            {started ? 'идёт сейчас' : 'ждём'}
          </span>
        </div>

        <div className="mt-4 space-y-2.5 rounded-xl border border-border bg-surface-muted px-3.5 py-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Время</span>
            <span className="font-semibold tabular-nums text-foreground">
              {hhmm(booking.startsAt)} – {hhmm(booking.endsAt)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Кто</span>
            <span className="text-foreground">{booking.name || 'Без имени'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Телефон</span>
            {/* Номер выделяется: по нему перезванивают, а не читают глазами */}
            <span className="select-all font-medium tabular-nums text-foreground">
              {booking.phone || '—'}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Компьютеры</span>
            <span className="text-right text-foreground">{stationNames.join(', ')}</span>
          </div>
          {booking.notes ? (
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">Заметка</span>
              <span className="text-right text-foreground">{booking.notes}</span>
            </div>
          ) : null}
          {booking.createdAt ? (
            <div className="flex justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Записана</span>
              <span className="text-muted-foreground">{hhmm(booking.createdAt)}</span>
            </div>
          ) : null}
        </div>

        {/*
          Перенос. «Давайте не на девять, а на десять» — самая частая правка, и
          до сих пор она означала отменить и завести заново: продиктовать
          телефон, имя, набрать те же пять машин.
        */}
        <div className="mt-4">
          {!moving ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void quickMove({ shiftMinutes: 30 })}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Позже на 30 мин
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void quickMove({ shiftMinutes: 60 })}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Позже на час
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void quickMove({ extendMinutes: 60 })}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Продлить на час
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMoving(true)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Другое время…
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-border px-3.5 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">С какого</label>
                  <input
                    type="datetime-local"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">До какого</label>
                  <input
                    type="datetime-local"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  />
                </div>
              </div>
              {isGroup && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Переносится вся компания — {groupBookings.length} ПК: они пришли вместе и сядут вместе.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void move(new Date(newStart), new Date(newEnd))}
                  className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy ? 'Переношу…' : 'Перенести'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMoving(false)}
                  className="rounded-lg border border-border px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Не переносить
                </button>
              </div>
            </div>
          )}

          {moveError && (
            <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {moveError}
            </div>
          )}
        </div>

        {/* Причина: одно нажатие вместо набора текста с клиентом на линии */}
        <div className="mt-4">
          <label className="mb-1.5 block text-xs text-muted-foreground">Причина отмены</label>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason((prev) => (prev === r ? '' : r))}
                className={
                  reason === r
                    ? 'rounded-lg border border-primary bg-primary/20 px-2.5 py-1 text-xs font-medium text-foreground'
                    : 'rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground'
                }
              >
                {r}
              </button>
            ))}
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Или своими словами"
            className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        {/*
          Отмена подтверждается вторым нажатием. Бронь — это обещание живому
          человеку, и снять его случайным кликом мимо не должно быть можно.
        */}
        {confirming ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-3">
            <p className="text-sm text-rose-100">
              {confirming === 'group'
                ? `Снять всю бронь на ${groupBookings.length} ПК (${stationNames.join(', ')})?`
                : `Снять бронь с ${booking.stationName || 'этого ПК'}?`}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void cancel(confirming === 'group')}
                className="rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Отменяю…' : 'Да, отменить'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(null)}
                className="rounded-lg border border-border px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Нет
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirming('one')}
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/20"
            >
              {isGroup ? `Отменить ${booking.stationName || 'этот ПК'}` : 'Отменить бронь'}
            </button>
            {isGroup && (
              <button
                type="button"
                onClick={() => setConfirming('group')}
                className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/20"
              >
                Отменить всю компанию ({groupBookings.length} ПК)
              </button>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-between gap-2">
          {onBookAnother ? (
            <button
              type="button"
              onClick={onBookAnother}
              className="rounded-lg border border-border px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Ещё бронь на этот ПК
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
