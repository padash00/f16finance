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
 *
 * Компания набирается по всему залу, а не по одной зоне. Пять машин в Standard
 * и пять в VIP — обычный заказ на день рождения, и раньше его нельзя было
 * завести одной бронью в принципе.
 */

import { useEffect, useMemo, useState } from 'react'

import * as api from '../lib/api'
import type { PhoneLookup, StationBooking } from '../lib/api'
import { toastSuccess, toastWarning } from '../lib/toast'
import type { AppConfig, ArenaStation, ArenaTariff, ArenaZone, OperatorSession } from '../types'

type Props = {
  config: AppConfig
  session: OperatorSession
  station: ArenaStation
  /** Все станции точки — из них выбирается компания. */
  allStations: ArenaStation[]
  /** Зоны: компанию собираем по всему залу, и нужно показать, где какой ПК. */
  zones: ArenaZone[]
  tariffs: ArenaTariff[]
  /** Уже существующие брони этой станции — чтобы показать занятые часы. */
  existing: StationBooking[]
  /** Брони всей точки — чтобы не предлагать занятые на это время ПК. */
  allBookings: StationBooking[]
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
  zones,
  tariffs,
  existing,
  allBookings,
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
  /** Сколько машин просит компания — для автоподбора. */
  const [wantedCount, setWantedCount] = useState('2')

  const [lookup, setLookup] = useState<PhoneLookup | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Занятые ПК из отказа сервера.
   *
   * Сервер отказал целиком и назвал занятые. Дальше оператор решает: убрать их
   * и забронировать остальные одним нажатием — или менять время.
   */
  const [busyFromServer, setBusyFromServer] = useState<{ ids: string[]; freeCount: number } | null>(null)

  /**
   * Кто занят на выбранное время.
   *
   * Считаем на месте, из уже загруженных броней: показывать оператору ПК,
   * который сервер всё равно отклонит, — значит заставить его набирать список
   * заново с клиентом на линии.
   */
  const busyStationIds = useMemo(() => {
    const start = new Date(startsAt).getTime()
    const end = new Date(endsAt).getTime()
    const busy = new Set<string>()
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return busy
    for (const booking of allBookings) {
      if (!booking.stationId) continue
      const bStart = new Date(booking.startsAt).getTime()
      const bEnd = new Date(booking.endsAt).getTime()
      // Пересечение интервалов: начало раньше чужого конца и конец позже
      // чужого начала. Впритык — не пересечение: 19:00–21:00 и 21:00–23:00
      // уживаются на одной машине.
      if (start < bEnd && end > bStart) busy.add(booking.stationId)
    }
    return busy
  }, [allBookings, startsAt, endsAt])

  /**
   * Зал по зонам: зона кликнутой станции идёт первой.
   *
   * Компания чаще садится рядом, поэтому своя зона сверху. Но остальные тоже
   * видны и выбираются — пять в Standard и пять в VIP это одна бронь.
   */
  const zoneGroups = useMemo(() => {
    const byZone = new Map<string, { zone: ArenaZone | null; stations: ArenaStation[] }>()
    const sorted = [...allStations]
      .filter((s) => s.is_active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))

    for (const st of sorted) {
      const key = st.zone_id || 'no-zone'
      if (!byZone.has(key)) {
        byZone.set(key, { zone: zones.find((z) => z.id === st.zone_id) || null, stations: [] })
      }
      byZone.get(key)!.stations.push(st)
    }

    const groups = [...byZone.entries()].map(([key, value]) => ({ key, ...value }))
    const ownKey = station.zone_id || 'no-zone'
    return groups.sort((a, b) => {
      if (a.key === ownKey) return -1
      if (b.key === ownKey) return 1
      return (a.zone?.name || 'Без зоны').localeCompare(b.zone?.name || 'Без зоны', 'ru')
    })
  }, [allStations, zones, station.zone_id])

  // Тарифы тех зон, из которых набрана компания. При выборе по всему залу
  // ограничивать список тарифами одной зоны бессмысленно.
  const pickedZoneIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of pickedStations) {
      const st = allStations.find((s) => s.id === id)
      if (st?.zone_id) ids.add(st.zone_id)
    }
    return ids
  }, [pickedStations, allStations])

  const relevantTariffs = tariffs.filter((t) => !t.zone_id || pickedZoneIds.has(t.zone_id))
  const multiZone = pickedZoneIds.size > 1

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

  // Сменилось время — прежний отказ сервера уже ни о чём не говорит.
  useEffect(() => {
    setBusyFromServer(null)
  }, [startsAt, endsAt])

  /**
   * Подобрать N свободных ПК.
   *
   * «Нам нужно десять машин на девять вечера» — оператор не должен искать их
   * глазами по залу и складывать в уме. Сначала берётся зона кликнутой станции
   * (компания хочет сидеть рядом), потом — зоны, где свободных больше, чтобы
   * компания разбилась на меньшее число кусков.
   */
  function autoPick(count: number) {
    if (!Number.isFinite(count) || count < 1) return

    const freeIn = (group: { stations: ArenaStation[] }) =>
      group.stations.filter((s) => !busyStationIds.has(s.id))

    // Зона кликнутой станции первой, дальше — по числу свободных мест.
    const [own, ...rest] = zoneGroups
    const ordered = [own, ...rest.sort((a, b) => freeIn(b).length - freeIn(a).length)].filter(Boolean)

    const picked: string[] = []
    // Станция, по которой кликнули, остаётся в наборе: оператор ткнул именно
    // в неё, и подмена этого выбора выглядела бы как ошибка программы.
    if (!busyStationIds.has(station.id)) picked.push(station.id)

    for (const group of ordered) {
      for (const s of freeIn(group)) {
        if (picked.length >= count) break
        if (!picked.includes(s.id)) picked.push(s.id)
      }
      if (picked.length >= count) break
    }

    setPickedStations(picked)
    if (picked.length < count) {
      setError(`Свободно только ${picked.length} ПК на это время, а нужно ${count}.`)
    } else {
      setError(null)
    }
  }

  /** Как компания разложилась по зонам — «Standard 5 · VIP 5». */
  const pickedSplit = useMemo(() => {
    const counts = new Map<string, number>()
    for (const id of pickedStations) {
      const st = allStations.find((s) => s.id === id)
      const zoneName = zones.find((z) => z.id === st?.zone_id)?.name || 'Без зоны'
      counts.set(zoneName, (counts.get(zoneName) || 0) + 1)
    }
    return [...counts.entries()].map(([zone, n]) => `${zone} ${n}`).join(' · ')
  }, [pickedStations, allStations, zones])

  function toggleStation(id: string) {
    setPickedStations((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  /** Взять всю зону разом: компания на десять машин — это один клик, а не десять. */
  function pickWholeZone(stations: ArenaStation[]) {
    const free = stations.filter((s) => !busyStationIds.has(s.id)).map((s) => s.id)
    const allPicked = free.every((id) => pickedStations.includes(id))
    setPickedStations((prev) =>
      allPicked
        ? prev.filter((id) => !free.includes(id))
        : [...new Set([...prev, ...free])],
    )
  }

  async function submit(options?: { skipBusy?: boolean }) {
    setError(null)

    if (phone.replace(/\D/g, '').length < 10) {
      setError('Нужен номер телефона — по нему потом найдётся этот человек.')
      return
    }

    if (pickedStations.length === 0) {
      setError('Не выбрано ни одного компьютера.')
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
      const result = await api.createBooking(config, session, {
        stationIds: pickedStations,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        phone,
        name: name.trim() || null,
        tariffId: tariffId || null,
        notes: notes.trim() || null,
        skipBusy: options?.skipBusy,
      })
      // Если часть машин пропущена, оператор должен узнать об этом до того,
      // как положит трубку. Держим на экране дольше обычного: это то, что он
      // сейчас скажет клиенту вслух.
      if (result.skippedStations && result.skippedStations.length > 0) {
        toastWarning(
          `Забронировано: ${result.stationNames.join(', ')}. ` +
            `Заняты и пропущены: ${result.skippedStations.join(', ')}.`,
          10000,
        )
      } else {
        toastSuccess(`Бронь: ${result.stationNames.join(', ')} · ${hhmm(start.toISOString())}`)
      }
      onDone()
    } catch (e: any) {
      // Сервер объясняет отказ по-человечески — пересказывать своими словами
      // значило бы потерять причину. Особенно это важно для пересечений и
      // горизонта: там в сообщении конкретные часы.
      setError(e?.message || 'Не удалось создать бронь')

      const payload = e?.payload
      if (payload?.error === 'booking-overlap' && Array.isArray(payload.busyStationIds)) {
        setBusyFromServer({
          ids: payload.busyStationIds.map(String),
          freeCount: Number(payload.freeCount || 0),
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card p-5 shadow-2xl">
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

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
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

          {/* Время идёт до выбора машин: от него зависит, какие свободны */}
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

          {/* Компания: весь зал, зона кликнутой станции первой */}
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="text-xs text-muted-foreground">
                Компьютеры {pickedStations.length > 1 ? `(выбрано ${pickedStations.length})` : ''}
              </label>
              <span className="text-[11px] text-muted-foreground">
                занятые на это время — серым
              </span>
            </div>

            {/* «Нам нужно десять машин» — считает система, а не оператор глазами */}
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Нужно ПК:</span>
              <input
                type="number"
                min={1}
                max={40}
                value={wantedCount}
                onChange={(e) => setWantedCount(e.target.value)}
                className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
              />
              <button
                type="button"
                onClick={() => autoPick(Number(wantedCount))}
                className="rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
              >
                Подобрать
              </button>
              {pickedStations.length > 1 && (
                <span className="ml-auto truncate text-[11px] text-muted-foreground">{pickedSplit}</span>
              )}
            </div>

            <div className="max-h-52 space-y-2.5 overflow-y-auto rounded-lg border border-border p-2.5">
              {zoneGroups.map((group) => {
                const freeInZone = group.stations.filter((s) => !busyStationIds.has(s.id))
                const pickedInZone = group.stations.filter((s) => pickedStations.includes(s.id)).length
                return (
                  <div key={group.key}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.zone?.name || 'Без зоны'}
                        {pickedInZone > 0 ? ` · ${pickedInZone}` : ''}
                      </span>
                      {freeInZone.length > 0 && (
                        <button
                          type="button"
                          onClick={() => pickWholeZone(group.stations)}
                          className="text-[11px] text-primary hover:underline"
                        >
                          вся зона · {freeInZone.length}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.stations.map((s) => {
                        const picked = pickedStations.includes(s.id)
                        const busy = busyStationIds.has(s.id)
                        // Занятый ПК всё равно можно выбрать вручную: брони
                        // отменяют, и оператор может знать больше системы.
                        // Сервер проверит ещё раз и откажет, если занят.
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleStation(s.id)}
                            title={busy ? 'Занято на это время' : undefined}
                            className={
                              picked
                                ? 'rounded-lg border border-primary bg-primary/20 px-2.5 py-1 text-xs font-semibold text-foreground'
                                : busy
                                  ? 'rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground/50 line-through'
                                  : 'rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground'
                            }
                          >
                            {s.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {multiZone && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {pickedSplit} — это одна бронь, отменяется целиком или по ПК.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Имя</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как зовут"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          {relevantTariffs.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Тариф (что обещали)</label>
              <select
                value={tariffId}
                onChange={(e) => setTariffId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Не указан</option>
                {relevantTariffs.map((t) => (
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
            {/*
              Компания на десять машин обычно согласна на восемь. Собирать
              список заново — это полминуты молчания в трубку, поэтому
              «забронировать остальные» делается одним нажатием.
            */}
            {busyFromServer && busyFromServer.freeCount > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit({ skipBusy: true })}
                className="mt-2 block rounded-lg border border-rose-400/50 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-50"
              >
                Забронировать свободные ({busyFromServer.freeCount})
              </button>
            )}
          </div>
        )}

        <div className="mt-5 flex shrink-0 justify-end gap-2">
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
