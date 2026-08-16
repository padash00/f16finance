/**
 * Ротация вопросов экзамена — чистая логика.
 *
 * Еженедельный экзамен с одними и теми же вопросами за месяц превращается в
 * заучивание ответов, а потом в переписку в чате. Проверять он перестаёт, но
 * время у людей забирает — это хуже, чем не проверять вовсе.
 *
 * Правила намеренно мягкие:
 *
 *   * вопрос, заданный за последние четыре недели, не повторяется;
 *   * вопрос, на котором человек ошибся, возвращается через две недели —
 *     ошибку нужно закрыть, а не забыть;
 *   * если после отсева вопросов не хватило на билет, ограничение снимается.
 *     Короткий билет хуже повторного вопроса: экзамен из трёх вопросов не
 *     проверяет ничего.
 *
 * Здесь нет обращений к базе: отбор должен быть виден в тестах, а не только
 * на живых данных.
 */

import { createHash } from 'node:crypto'

/** Сколько недель вопрос считается «недавно заданным». */
const COOLDOWN_DAYS = 28

/** Через сколько дней возвращается вопрос, на котором ошиблись. */
const MISTAKE_RETURN_DAYS = 14

export type AskedQuestion = {
  question_hash: string
  asked_on: string
  was_correct: boolean | null
}

/**
 * Отпечаток вопроса.
 *
 * Нормализуем текст: модель переставляет пробелы и регистр, и без этого один
 * и тот же вопрос считался бы разным.
 */
export function questionHash(question: { q?: string }): string {
  const text = String(question?.q || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

function daysBetween(from: string, to: Date): number {
  const a = new Date(`${from}T00:00:00Z`).getTime()
  return Math.floor((to.getTime() - a) / 86_400_000)
}

/**
 * Какие отпечатки сейчас нельзя задавать этому человеку.
 *
 * Ошибочные возвращаются раньше правильных: смысл повтора именно в том, чтобы
 * закрыть пробел, а не в том, чтобы ещё раз услышать верный ответ.
 */
export function blockedHashes(history: AskedQuestion[], now: Date = new Date()): Set<string> {
  const blocked = new Set<string>()

  for (const row of history) {
    const age = daysBetween(row.asked_on, now)
    const cooldown = row.was_correct === false ? MISTAKE_RETURN_DAYS : COOLDOWN_DAYS
    if (age < cooldown) blocked.add(row.question_hash)
  }

  return blocked
}

/**
 * Отбирает вопросы для билета с учётом истории.
 *
 * Сначала берутся невиданные, потом — давно не заданные, и только если не
 * хватило, добираются любые. Порядок внутри групп случайный: два человека не
 * должны получить одинаковый билет.
 */
export function pickWithRotation<T extends { q?: string }>(
  pool: T[],
  count: number,
  history: AskedQuestion[],
  now: Date = new Date(),
): T[] {
  if (pool.length <= count) return [...pool]

  const blocked = blockedHashes(history, now)
  const shuffle = <X,>(list: X[]) => [...list].sort(() => Math.random() - 0.5)

  const fresh = shuffle(pool.filter((q) => !blocked.has(questionHash(q))))
  if (fresh.length >= count) return fresh.slice(0, count)

  // Не хватило — добираем из недавних. Короткий билет хуже повторного вопроса.
  const rest = shuffle(pool.filter((q) => blocked.has(questionHash(q))))
  return [...fresh, ...rest].slice(0, count)
}

