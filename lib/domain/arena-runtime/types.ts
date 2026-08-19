/**
 * Типы слоя наблюдения за станциями.
 *
 * Главное различие, которое здесь закреплено: наблюдение и вывод — разные
 * вещи. Устройство сообщает, что видит Windows. Состояние станции выводит
 * сервер. Смешать их в одном поле означало бы навсегда потерять возможность
 * разобраться, почему система решила так, а не иначе.
 */

/** Кто залогинен в Windows — со слов устройства. */
export type WindowsUserKind =
  /** Экран входа: в системе никого. */
  | 'logonui'
  /** Учётная запись, под которой SENET пускает клиента. */
  | 'senet_user'
  /** Технический вход: обслуживание, настройка, ремонт. */
  | 'support'
  /** Кто-то есть, но опознать не удалось. */
  | 'unknown'

/**
 * Состояние станции — вывод сервера, а не сообщение устройства.
 *
 * Ни одно из этих значений не приходит снаружи и не хранится в базе. Каждое
 * вычисляется заново при чтении из наблюдений и времени их получения.
 */
export type ArenaStationState =
  /** Наблюдателя никогда не было: устройство не зарегистрировано. */
  | 'UNPROVISIONED'
  /** Заявка подана, но человек её ещё не подтвердил. */
  | 'PENDING'
  /** Устройство отозвано. */
  | 'REVOKED'
  /** Наблюдатель был, но замолчал дольше порога. */
  | 'OFFLINE'
  /** Компьютер жив, за ним никого. */
  | 'AVAILABLE'
  /** За компьютером клиент. */
  | 'CLIENT'
  /** За компьютером техническая учётная запись. */
  | 'SUPPORT'
  /** Сигнал свежий, но наблюдения противоречивы или неизвестны. */
  | 'UNKNOWN'

/** Свежесть данных о станции. */
export type ArenaObservationFreshness = 'fresh' | 'stale' | 'never'

/** Классификация процесса — вывод сервера по имени и пути. */
export type ProcessClassification =
  /** Магазин или лаунчер: сам по себе не игра. */
  | 'launcher'
  /** Фоновая программа: мессенджер, оверлей. */
  | 'background'
  /** Часть SENET или системы клуба. */
  | 'infrastructure'
  /** Системный процесс Windows. */
  | 'system'
  /**
   * Ничего из перечисленного.
   *
   * Именно кандидат, а не игра. «Не в списке известного» ещё не означает
   * «игра»: так в игры попали бы антивирус, драйвер и обновление Windows.
   * Настоящую игру подтверждает только привязка к каталогу клуба, которой
   * пока нет.
   */
  | 'unknown_candidate'

/** Что устройство наблюдает прямо сейчас — общая часть heartbeat и событий. */
export type StationObservation = {
  windowsUserKind?: WindowsUserKind | null
  gameProcess?: string | null
  gamePath?: string | null
  bootAt?: string | null
  /** Догадка устройства о состоянии. Только сверка, в проекцию не идёт. */
  stateHint?: string | null
}

/** Строка снимка, как она лежит в базе. */
export type RuntimeSnapshot = {
  station_id: string
  observed_user_kind: string | null
  observed_user_kind_at: string | null
  observed_game_process: string | null
  observed_game_path: string | null
  observed_game_at: string | null
  observed_state_hint: string | null
  last_boot_at: string | null
  last_heartbeat_at: string | null
  agent_version: string | null
}

/** Строка устройства в той части, что нужна для вывода состояния. */
export type DeviceRow = {
  id: string
  status: 'pending' | 'active' | 'revoked'
  last_seen_at: string | null
  agent_version: string | null
}
