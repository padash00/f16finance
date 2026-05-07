/**
 * Fuzzy matching для имён операторов, товаров, точек.
 *
 * AI извлекает из ввода юзера имя ("Айга", "колу", "арена"), и tool
 * пытается найти точное совпадение в БД. Если AI выдумал ID — engine
 * валидирует через getOptions и сбрасывает. Но для строковых полей
 * (например имя оператора в свободном тексте) — лучше fuzzy-match.
 */

/**
 * Levenshtein distance — сколько правок нужно из строки А в строку Б.
 */
function distance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const m = a.length
  const n = b.length
  const dp: number[][] = []
  for (let i = 0; i <= m; i++) dp[i] = [i]
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1,
        )
      }
    }
  }
  return dp[m][n]
}

/**
 * Нормализация для сравнения: lower-case, trim, схлопываем пробелы.
 */
function normalize(s: string): string {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

export type FuzzyCandidate<T> = {
  item: T
  haystack: string  // поле по которому матчим
}

export type FuzzyResult<T> = {
  item: T
  score: number      // 0 = идеальное совпадение
  matchType: 'exact' | 'starts' | 'contains' | 'fuzzy'
}

/**
 * Найти лучшее совпадение `needle` среди `candidates`.
 * Стратегия (по убыванию приоритета):
 *   1. Точное совпадение (после нормализации)
 *   2. Кандидат начинается с needle ("Айга" matches "Айгерим")
 *   3. Кандидат содержит needle (substring)
 *   4. Levenshtein distance ≤ 30% от длины needle
 *
 * Возвращает null если ничего не найдено или needle слишком короткий.
 */
export function fuzzyFindBest<T>(
  needle: string,
  candidates: FuzzyCandidate<T>[],
): FuzzyResult<T> | null {
  const n = normalize(needle)
  if (n.length < 2 || candidates.length === 0) return null

  let exact: FuzzyResult<T> | null = null
  let starts: FuzzyResult<T> | null = null
  let contains: FuzzyResult<T> | null = null
  let fuzzy: FuzzyResult<T> | null = null

  for (const c of candidates) {
    const h = normalize(c.haystack)
    if (h === n) {
      return { item: c.item, score: 0, matchType: 'exact' }
    }
    if (!exact && h.startsWith(n)) {
      starts = { item: c.item, score: 1, matchType: 'starts' }
    }
    if (!starts && h.includes(n)) {
      contains = { item: c.item, score: 2, matchType: 'contains' }
    }
    if (!contains && !starts) {
      // Fuzzy: distance ≤ 30% от длины needle (но минимум 1)
      const d = distance(n, h)
      const threshold = Math.max(1, Math.floor(n.length * 0.3))
      if (d <= threshold) {
        if (!fuzzy || d < fuzzy.score) {
          fuzzy = { item: c.item, score: 3 + d, matchType: 'fuzzy' }
        }
      }
    }
  }

  return starts || contains || fuzzy
}

/**
 * Если нашлось много кандидатов, начинающихся с needle — собрать все
 * для предложения пользователю выбора (а не угадывать).
 */
export function fuzzyFindAllStarts<T>(
  needle: string,
  candidates: FuzzyCandidate<T>[],
): T[] {
  const n = normalize(needle)
  if (n.length < 2) return []
  return candidates
    .filter((c) => normalize(c.haystack).startsWith(n))
    .map((c) => c.item)
}
