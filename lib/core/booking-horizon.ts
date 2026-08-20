/**
 * Насколько далеко вперёд оператору разрешено бронировать.
 *
 * Правило владельца: **не дальше конца текущих операционных суток**.
 *
 * Дневная смена может забронировать и на ночь — ночь входит в те же сутки.
 * Ночная смена упирается в утро: следующий день принадлежит другим людям, и
 * распоряжаться им она не должна.
 *
 * Причина не техническая, а рабочая. Бронь — это обещание, которое кто-то
 * будет выполнять. Оператор, обещающий на послезавтра, раздаёт обязательства
 * сменам, которые об этом не знают и не участвовали в разговоре с клиентом.
 *
 * Граница суток — шесть утра, ровно та же, что делит смены на дневную и
 * ночную в остальной арене. Если её однажды сдвинут, менять надо здесь и там
 * одновременно, иначе бронирование и смены разъедутся.
 */

/** Час, с которого начинаются новые операционные сутки. */
export const OPERATIONAL_DAY_START_HOUR = 6

/**
 * Конец операционных суток, в которых находится указанный момент.
 *
 * До шести утра сутки считаются вчерашними: ночная смена, работающая в два
 * часа ночи, находится в сутках предыдущего дня, и её горизонт — сегодняшнее
 * утро, а не завтрашнее.
 */
export function operationalDayEnd(now: Date, timeZoneOffsetHours = 5): Date {
  // Работаем в местном времени точки: граница смены — это шесть утра по
  // Казахстану, а не по всемирному времени.
  const local = new Date(now.getTime() + timeZoneOffsetHours * 3600_000)

  const end = new Date(local)
  end.setUTCHours(OPERATIONAL_DAY_START_HOUR, 0, 0, 0)

  // Если местное время уже за шесть утра, конец суток — завтрашнее утро.
  if (local.getUTCHours() >= OPERATIONAL_DAY_START_HOUR) {
    end.setUTCDate(end.getUTCDate() + 1)
  }

  return new Date(end.getTime() - timeZoneOffsetHours * 3600_000)
}

export type HorizonCheck =
  | { ok: true }
  | { ok: false; reason: 'past' | 'beyond-horizon'; horizonEnd: Date }

/**
 * Можно ли завести такую бронь прямо сейчас.
 *
 * Проверяется конец брони, а не начало: смысл ограничения в том, чтобы не
 * раздавать обязательства чужим сменам, а обязательство длится до конца.
 */
export function checkBookingHorizon(
  startsAt: Date,
  endsAt: Date,
  now: Date,
  timeZoneOffsetHours = 5,
): HorizonCheck {
  const horizonEnd = operationalDayEnd(now, timeZoneOffsetHours)

  // Бронь в прошлое — почти всегда описка в часах. Небольшой запас оставляем:
  // оператор может завести бронь на «сейчас», пока клиент идёт от двери.
  if (endsAt.getTime() <= now.getTime() - 5 * 60_000) {
    return { ok: false, reason: 'past', horizonEnd }
  }

  if (endsAt.getTime() > horizonEnd.getTime()) {
    return { ok: false, reason: 'beyond-horizon', horizonEnd }
  }

  return { ok: true }
}

/** Человеческое объяснение отказа — его же показываем оператору. */
export function horizonRefusalText(check: Extract<HorizonCheck, { ok: false }>): string {
  if (check.reason === 'past') {
    return 'Бронь заканчивается в прошлом. Проверьте время.'
  }
  return 'Бронировать можно только до конца своей смены. На следующий день брони заводит смена, которая будет работать.'
}
