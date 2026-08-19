/**
 * ARENA_STATE_V1 — вывод состояния станции из наблюдений.
 *
 * Это единственное место, где решается, свободен компьютер или занят. Ни
 * устройство, ни база, ни компонент не имеют права иметь своё мнение.
 *
 * Два правила, на которых всё держится:
 *
 * 1. Устройство сообщает наблюдения, а не выводы. «В Windows залогинен
 *    SenetUser» — наблюдение. «Станция занята клиентом» — вывод. Правило
 *    вывода будет меняться по мере того, как мы узнаём реальность, а обновить
 *    его на семидесяти семи diskless-машинах означает пересобрать образ.
 *    Здесь оно меняется деплоем.
 *
 * 2. Устаревшее наблюдение перестаёт быть правдой. Если компьютер молчит две
 *    минуты, его последнее «за мной клиент» больше не описывает настоящее —
 *    оно описывает прошлое. Показывать его как текущее означает врать.
 */

import { OFFLINE_AFTER_SEC } from './config'
import type {
  ArenaObservationFreshness,
  ArenaStationState,
  DeviceRow,
  RuntimeSnapshot,
  WindowsUserKind,
} from './types'

export type ResolvedState = {
  state: ArenaStationState
  freshness: ArenaObservationFreshness
  /** Сколько секунд назад пришёл последний сигнал. null — сигнала не было. */
  lastSeenSecondsAgo: number | null
  /**
   * Последнее известное наблюдение — когда сигнал протух.
   *
   * Отделено от текущего состояния намеренно: «сейчас офлайн, а до этого был
   * клиент с CS2» — полезно для разбора. «Офлайн и играет в CS2» — бессмыслица.
   */
  lastKnown: {
    userKind: WindowsUserKind | null
    gameProcess: string | null
  } | null
}

function secondsBetween(fromIso: string | null | undefined, now: Date): number | null {
  if (!fromIso) return null
  const then = Date.parse(fromIso)
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.round((now.getTime() - then) / 1000))
}

function normalizeUserKind(raw: string | null | undefined): WindowsUserKind | null {
  if (!raw) return null
  const value = String(raw).toLowerCase()
  if (value === 'logonui' || value === 'senet_user' || value === 'support' || value === 'unknown') {
    return value
  }
  return 'unknown'
}

/**
 * Собственно вывод состояния.
 *
 * Порядок проверок важен и не случаен: сначала «есть ли вообще наблюдатель»,
 * потом «свежи ли его данные», и только потом «что он видел». Перепутать
 * первые два значит показать выключенный компьютер свободным.
 */
export function resolveStationState(args: {
  device: DeviceRow | null
  runtime: RuntimeSnapshot | null
  now: Date
  offlineAfterSec?: number
}): ResolvedState {
  const { device, runtime, now } = args
  const offlineAfter = args.offlineAfterSec ?? OFFLINE_AFTER_SEC

  const lastKnown = runtime
    ? {
        userKind: normalizeUserKind(runtime.observed_user_kind),
        gameProcess: runtime.observed_game_process ?? null,
      }
    : null

  // ── Наблюдателя нет вовсе ───────────────────────────────────────────────
  // Это не «свободно». Про такую станцию мы не знаем ничего: она может быть
  // занята, выключена или разобрана. Показывать её зелёной — худшая ошибка
  // всей системы, потому что выглядит она достоверно.
  if (!device) {
    return { state: 'UNPROVISIONED', freshness: 'never', lastSeenSecondsAgo: null, lastKnown: null }
  }

  if (device.status === 'pending') {
    return { state: 'PENDING', freshness: 'never', lastSeenSecondsAgo: null, lastKnown }
  }

  if (device.status === 'revoked') {
    return { state: 'REVOKED', freshness: 'never', lastSeenSecondsAgo: null, lastKnown }
  }

  // ── Наблюдатель есть: насколько свежи его данные ────────────────────────
  const lastSeenSecondsAgo = secondsBetween(runtime?.last_heartbeat_at ?? device.last_seen_at, now)

  if (lastSeenSecondsAgo === null) {
    // Устройство подтверждено, но ни разу не отчиталось. Это не офлайн —
    // офлайн предполагает, что связь была и пропала. Здесь её не было.
    return { state: 'OFFLINE', freshness: 'never', lastSeenSecondsAgo: null, lastKnown }
  }

  if (lastSeenSecondsAgo > offlineAfter) {
    return { state: 'OFFLINE', freshness: 'stale', lastSeenSecondsAgo, lastKnown }
  }

  // ── Данные свежие: что видел наблюдатель ────────────────────────────────
  const userKind = normalizeUserKind(runtime?.observed_user_kind)

  let state: ArenaStationState
  switch (userKind) {
    case 'logonui':
      state = 'AVAILABLE'
      break
    case 'senet_user':
      // На этом этапе CLIENT означает ровно одно: в Windows залогинена учётная
      // запись, под которой SENET пускает клиента. Ни биллинга, ни остатка
      // времени, ни типа счёта здесь нет — и притворяться, что есть, нельзя.
      state = 'CLIENT'
      break
    case 'support':
      state = 'SUPPORT'
      break
    default:
      // Сигнал свежий, но кто за компьютером — неизвестно. Это честнее, чем
      // выбрать наугад между «свободно» и «занято».
      state = 'UNKNOWN'
  }

  return { state, freshness: 'fresh', lastSeenSecondsAgo, lastKnown }
}

/**
 * Считается ли станция занятой человеком.
 *
 * Support и клиент оба занимают компьютер физически, но это разные вещи для
 * бизнеса: один платит, другой чинит. Поэтому функция отвечает на вопрос
 * «место занято», а не «место продано».
 */
export function isHumanOccupied(state: ArenaStationState): boolean {
  return state === 'CLIENT' || state === 'SUPPORT'
}

/** Занята ли станция коммерчески — то есть клиентом. */
export function isCommerciallyOccupied(state: ArenaStationState): boolean {
  return state === 'CLIENT'
}

/**
 * Знаем ли мы вообще, что происходит со станцией.
 *
 * Нужно для честного знаменателя: станцию без наблюдателя нельзя учитывать ни
 * как занятую, ни как свободную. Её надо считать отдельно.
 */
export function isObserved(state: ArenaStationState): boolean {
  return state === 'AVAILABLE' || state === 'CLIENT' || state === 'SUPPORT' || state === 'UNKNOWN'
}
