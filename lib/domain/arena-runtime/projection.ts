/**
 * Правило обновления снимка: какое наблюдение побеждает.
 *
 * Сеть в клубе нестабильна, и события приходят не в том порядке, в каком
 * произошли. Классический случай:
 *
 *   21:00  вышел из Windows
 *   21:05  зашёл в Windows
 *
 * Первое застряло и пришло вторым. Если обновлять снимок по порядку прибытия,
 * в базе окажется «вышел», хотя человек сидит за компьютером. Экран покажет
 * «свободно» там, где клиент.
 *
 * Отсюда правило: **побеждает то, что произошло позже**, а не то, что пришло
 * позже. Старое наблюдение физически не может перезаписать новое.
 *
 * Отметки времени раздельные по каждому полю. Общая на строку означала бы,
 * что опоздавшее событие про игру блокирует свежее про пользователя — а это
 * независимые наблюдения, и приходят они вразнобой.
 */

export type ObservationPatch = {
  /** Значение наблюдения. undefined — устройство про это ничего не сказало. */
  value: string | null | undefined
  /** Когда наблюдение сделано, по часам устройства. */
  observedAt: string | null | undefined
}

/**
 * Решает, обновлять ли поле.
 *
 * Возвращает true, только если новое наблюдение строго новее того, что уже
 * записано. Равенство не проходит: при одинаковом времени первое пришедшее
 * уже записано, и переписывать его нечем — второе не содержит новой правды.
 */
export function shouldApply(
  incomingAt: string | null | undefined,
  currentAt: string | null | undefined,
): boolean {
  if (!incomingAt) return false

  const incoming = Date.parse(incomingAt)
  if (!Number.isFinite(incoming)) return false

  if (!currentAt) return true

  const current = Date.parse(currentAt)
  if (!Number.isFinite(current)) return true

  return incoming > current
}

export type SnapshotFields = {
  observed_user_kind: string | null
  observed_user_kind_at: string | null
  observed_game_process: string | null
  observed_game_path: string | null
  observed_game_at: string | null
  observed_state_hint: string | null
  observed_state_hint_at: string | null
  last_boot_at: string | null
}

export type IncomingObservation = {
  userKind?: ObservationPatch
  game?: { process: string | null | undefined; path: string | null | undefined; observedAt: string | null | undefined }
  stateHint?: ObservationPatch
  bootAt?: string | null | undefined
}

/**
 * Накладывает наблюдения на снимок, отбрасывая устаревшие.
 *
 * Возвращает только те поля, которые действительно надо записать. Пустой
 * результат означает, что всё пришедшее старше уже известного — и запись в
 * базу не нужна вовсе.
 */
export function applyObservation(
  current: SnapshotFields,
  incoming: IncomingObservation,
): Partial<SnapshotFields> {
  const patch: Partial<SnapshotFields> = {}

  if (incoming.userKind && shouldApply(incoming.userKind.observedAt, current.observed_user_kind_at)) {
    patch.observed_user_kind = incoming.userKind.value ?? null
    patch.observed_user_kind_at = incoming.userKind.observedAt ?? null
  }

  if (incoming.game && shouldApply(incoming.game.observedAt, current.observed_game_at)) {
    patch.observed_game_process = incoming.game.process ?? null
    patch.observed_game_path = incoming.game.path ?? null
    patch.observed_game_at = incoming.game.observedAt ?? null
  }

  if (incoming.stateHint && shouldApply(incoming.stateHint.observedAt, current.observed_state_hint_at)) {
    patch.observed_state_hint = incoming.stateHint.value ?? null
    patch.observed_state_hint_at = incoming.stateHint.observedAt ?? null
  }

  // Время загрузки не наблюдение, а факт о прошлом: оно может только расти.
  // Меньшее значение означает, что событие относится к предыдущему запуску.
  if (incoming.bootAt && shouldApply(incoming.bootAt, current.last_boot_at)) {
    patch.last_boot_at = incoming.bootAt
  }

  return patch
}

export type ClockCheck =
  | { ok: true }
  | { ok: false; reason: 'CLOCK_SKEW_FUTURE' | 'TOO_OLD' | 'INVALID'; skewSeconds: number | null }

/**
 * Проверка времени события.
 *
 * Событие «из будущего» опасно не само по себе, а тем, что заблокирует все
 * последующие: снимок замрёт на нём навсегда. Поэтому в проекцию оно не идёт.
 * В журнал ложится — как улика о сбитых часах, а не как факт о станции.
 */
export function checkClock(
  occurredAt: string,
  serverNow: Date,
  futureToleranceSec: number,
  maxAgeSec: number,
): ClockCheck {
  const occurred = Date.parse(occurredAt)
  if (!Number.isFinite(occurred)) return { ok: false, reason: 'INVALID', skewSeconds: null }

  const skewSeconds = Math.round((occurred - serverNow.getTime()) / 1000)

  if (skewSeconds > futureToleranceSec) {
    return { ok: false, reason: 'CLOCK_SKEW_FUTURE', skewSeconds }
  }

  if (-skewSeconds > maxAgeSec) {
    return { ok: false, reason: 'TOO_OLD', skewSeconds }
  }

  return { ok: true }
}
