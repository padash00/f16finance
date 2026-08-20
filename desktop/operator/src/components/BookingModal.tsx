/**
 * Бронь станции — окно оператора.
 *
 * Открывается по клику на свободную станцию вместо запуска сессии. Сессии
 * заводит SENET; наше дело — обещание на будущее, и смешивать их нельзя.
 *
 * Порядок полей повторяет разговор по телефону: сначала номер (человек
 * называет его первым), потом время, потом всё остальное. Как только номер
 * набран, оператор видит, был ли этот человек раньше и сколько раз не пришёл, —
 * ещё до того, как пообещает место.
 */

import { useEffect, useMemo, useState } from 'react'

import * as api from '../lib/api'
import type { PhoneLookup, StationBooking } from '../lib/api'
import type { AppConfig, ArenaStation, ArenaTariff, OperatorSession } from '../types'

type Props = {
  config: AppConfig
  session: OperatorSession
  station: ArenaStation
  /** Все станции точки — из них выбирается компания. */
  allStations: ArenaStation[]
  tariffs: ArenaTariff[]
  /** Уже существующие брони этой станции — чтобы показать занятые часы. */
  existing: StationBooking[]
  /** Докуда разрешено бронировать этой смене. */
  horizonEnd: string | null
  onDone: () => void
  onCancel: () => void
}

/** Время в поле ввода: местное, в формате, который понимает datetime-local. */
function toInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function BookingModal({
  config,
  session,
  station,
  allStations,
  tariffs,
  existing,
  horizonEnd,
  onDone,
  onCancel,
}: Props) {
  // По умолчанию — ближайший круглый час и два часа игры: самый частый запрос.
  const defaults = useMemo(() => {
    const start = new Date()
    start.setMinutes(start.getMinutes() + 30, 0, 0)
    start.setMinutes(0, 0, 0)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    return { start: toInputValue(start), end: toInputValue(end) }
  }, [])

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [startsAt, setStartsAt] = useState(defaults.start)
  const [endsAt, setEndsAt] = useState(defaults.end)
  const [tariffId, setTariffId] = useState<string>('')
  const [notes, setNotes] = useState('')

  /**
   * Станции компании.
   *
   * В тетради компания на пять мест была одной записью, и здесь так же: один
   * телефон, одно время, несколько ПК. Заводить пять отдельных броней на один
   * разговор — это и есть та ручная работа, от которой уходим.
   */
  const [pickedStations, setPickedStations] = useState<string[]>([station.id])

  // Соседи по зоне: компания почти всегда садится рядом, и предлагать ей ПК
  // из другого конца зала бессмысленно.
  const zoneNeighbours = allStations
    .filter((s) => s.id !== station.id && s.zone_id === station.zone_id && s.is_active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))

  const [lookup, setLookup] = useState<PhoneLookup | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const zoneTariffs = tariffs.filter((t) => !t.zone_id || t.zone_id === station.zone_id)

  // Поиск по номеру идёт сам, с задержкой: оператор ещё диктует цифры, а
  // дёргать сервер на каждую нажатую клавишу незачем.
  useEffect(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      setLookup(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const result = await api.lookupBookingPhone(config, session, phone)
        if (!cancelled) {
          setLookup(result)
          // Имя подставляем, только если оператор его ещё не вписал сам.
          if (result.name && !name.trim()) setName(result.name)
        }
      } catch {
        if (!cancelled) setLookup(null)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [phone, config, session, name])

  async function submit() {
    setError(null)

    if (phone.replace(/\D/g, '').length < 10) {
      setError('Нужен номер телефона — по нему потом найдётся этот человек.')
      return
    }

    const start = new Date(startsAt)
    const end = new Date(endsAt)
    if (!(end > start)) {
      setError('Конец брони должен быть позже начала.')
      return
    }

    setSaving(true)
    try {
      await api.createBooking(config, session, {
        stationIds: pickedStations,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        phone,
        name: name.trim() || null,
        tariffId: tariffId || null,
        notes: notes.trim() || null,
      })
      onDone()
    } catch (e: any) {
      // Сервер объясняет отказ по-человечески — пересказывать своими словами
      // значило бы потерять причину. Особенно это важно для пересечений и
      // горизонта: там в сообщении конкретные часы.
      setError(e?.message || 'Не удалось создать бронь')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            {pickedStations.length > 1
              ? `Бронь: ${pickedStations.length} ПК`
              : `Бронь станции ${station.name}`}
          </h2>
          <span className="text-xs text-muted-foreground">Сессия не запускается</span>
        </div>

        {/* Что на этой станции уже обещано */}
        {existing.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Уже забронировано:{' '}
            {existing.map((b) => `${hhmm(b.startsAt)}–${hhmm(b.endsAt)}${b.name ? ` (${b.name})` : ''}`).join(', ')}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {/* Телефон идёт первым: человек называет его первым делом */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Телефон</label>
            <input
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 777 123 45 67"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />

            {/* «Этот номер уже звонил» — до того, как место обещано */}
            {lookup?.known && (
              <div className="mt-1.5 rounded-lg bg-surface-muted px-3 py-2 text-xs">
                <span className="font-medium text-foreground">{lookup.name || 'Без имени'}</span>
                <span className="text-muted-foreground">
                  {' · '}броней: {lookup.stats.total}
                  {lookup.stats.cancelled > 0 ? `, отменял ${lookup.stats.cancelled}` : ''}
                </span>
                {/*
                  Три отмены — это не приговор, а повод спросить точнее.
                  Решение остаётся за оператором: система не отказывает людям.
                */}
                {lookup.stats.cancelled >= 3 && (
                  <div className="mt-1 text-amber-300">
                    Часто не приходит — стоит переспросить, точно ли придёт.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Компания: добавить соседние ПК одним разговором */}
          {zoneNeighbours.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Ещё ПК для компании {pickedStations.length > 1 ? `(выбрано ${pickedStations.length})` : ''}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {zoneNeighbours.map((s) => {
                  const picked = pickedStations.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setPickedStations((prev) =>
                          prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                        )
                      }
                      className={
                        picked
                          ? 'rounded-lg border border-primary bg-primary/20 px-2.5 py-1 text-xs font-semibold text-foreground'
                          : 'rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground'
                      }
                    >
                      {s.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Имя</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как зовут"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">С какого времени</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">До какого</label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                max={horizonEnd ? toInputValue(new Date(horizonEnd)) : undefined}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>

          {horizonEnd && (
            <p className="text-[11px] text-muted-foreground">
              Бронировать можно до {hhmm(horizonEnd)}. Дальше — смена, которая будет работать.
            </p>
          )}

          {zoneTariffs.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Тариф (что обещали)</label>
              <select
                value={tariffId}
                onChange={(e) => setTariffId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Не указан</option>
                {zoneTariffs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.price} ₸
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Заметка</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Например: просил место у окна"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Отмена
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? 'Сохраняю…' : 'Забронировать'}
          </button>
        </div>
      </div>
    </div>
  )
}
