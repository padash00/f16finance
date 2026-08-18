/**
 * Числовой фундамент вероятностного движка.
 *
 * Здесь только чистая математика: ни Supabase, ни React, ни обращений ко
 * времени. Всё детерминировано — одни и те же входные данные всегда дают
 * один и тот же результат, иначе тесты и бэктест не имели бы смысла.
 *
 * Отдельное правило на весь модуль: наружу не должно выйти ни одного NaN и ни
 * одной бесконечности. Плохие входные данные превращаются в null, а не в
 * красивое число, которому нельзя верить.
 */

/** Конечное число или null. Одно место, где отсекается вся числовая грязь. */
export function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Генератор псевдослучайных чисел mulberry32.
 *
 * Свой, а не Math.random, ровно по одной причине: Monte Carlo должен быть
 * воспроизводим. Без seed один и тот же отчёт показывал бы каждую минуту
 * немного другую вероятность B2, и человек справедливо перестал бы ему верить.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Стабильный seed из строки: одинаковый сегмент — одинаковая симуляция. */
export function seedFromString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]

/** Логарифм гамма-функции. Нужен всюду, где встречаются факториалы. */
export function logGamma(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return NaN
  if (x < 0.5) {
    // Формула отражения: для малых аргументов ряд Ланцоша неточен.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  }
  const z = x - 1
  let a = 0.99999999999980993
  const t = z + 7.5
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i + 1)
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
}

export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b)
}

/**
 * Регуляризованная неполная бета-функция I_x(a, b).
 *
 * Это функция распределения бета-распределения. На ней держится вся часть про
 * attach-rate: «какова вероятность, что истинная доля продавца выше нормы» —
 * это ровно 1 − I_норма(a, b).
 *
 * Считается непрерывной дробью по методу Лентца — стандартный устойчивый
 * способ; прямое суммирование ряда разваливается на хвостах.
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b)) return NaN
  if (a <= 0 || b <= 0) return NaN
  if (x <= 0) return 0
  if (x >= 1) return 1

  // Дробь сходится быстро только на «своей» половине; вторую берём через
  // симметрию I_x(a,b) = 1 − I_(1−x)(b,a).
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a)
  }

  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b)) / a
  const TINY = 1e-30
  let f = 1
  let c = 1
  let d = 0

  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2)
    let numerator: number
    if (i === 0) {
      numerator = 1
    } else if (i % 2 === 0) {
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    } else {
      numerator = (-((a + m) * (a + b + m)) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    }

    d = 1 + numerator * d
    if (Math.abs(d) < TINY) d = TINY
    d = 1 / d

    c = 1 + numerator / c
    if (Math.abs(c) < TINY) c = TINY

    const delta = c * d
    f *= delta
    if (Math.abs(1 - delta) < 1e-12) break
  }

  return clamp01(front * (f - 1))
}

/**
 * Квантиль бета-распределения — обратная к функции выше.
 *
 * Аналитической формулы нет, поэтому обычная бисекция: она медленнее Ньютона,
 * но не расходится на краях, а края здесь как раз рабочий случай (доля 0/3 или
 * 3/3 у продавца за смену — обычное дело).
 */
export function betaQuantile(p: number, a: number, b: number): number {
  const target = clamp01(p)
  if (a <= 0 || b <= 0 || !Number.isFinite(a) || !Number.isFinite(b)) return NaN
  if (target <= 0) return 0
  if (target >= 1) return 1

  let low = 0
  let high = 1
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2
    if (regularizedIncompleteBeta(mid, a, b) < target) low = mid
    else high = mid
    if (high - low < 1e-10) break
  }
  return (low + high) / 2
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const value of values) sum += value
  return finiteOrNull(sum / values.length)
}

/** Выборочная дисперсия (делитель n−1). На одном наблюдении её не существует. */
export function variance(values: number[]): number | null {
  if (values.length < 2) return null
  const avg = mean(values)
  if (avg === null) return null
  let sum = 0
  for (const value of values) sum += (value - avg) ** 2
  return finiteOrNull(sum / (values.length - 1))
}

/**
 * Перцентиль с линейной интерполяцией.
 *
 * Повторяет поведение percentile() из baseline.ts намеренно: если эмпирические
 * перцентили в модуле и в вероятностном движке начнут считаться по-разному,
 * сравнение старой и новой модели перестанет быть честным.
 */
export function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const pos = clamp01(p) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return finiteOrNull(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo))
}

/** Стандартное нормальное — нужно гамма-сэмплеру. Бокс — Мюллер. */
export function sampleNormal(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Гамма-распределение, метод Марсальи — Цанга.
 *
 * Само по себе оно в отчётах не показывается; оно нужно, чтобы порождать
 * отрицательное биномиальное как смесь Пуассонов — то есть буквально
 * «поток разный в разные дни», что и есть сверхдисперсия.
 */
export function sampleGamma(rng: () => number, shape: number, scale: number): number {
  if (!Number.isFinite(shape) || shape <= 0) return NaN
  if (shape < 1) {
    // Приём Джонка для shape < 1: гамма(k) = гамма(k+1) · U^(1/k).
    const u = rng() || Number.EPSILON
    return sampleGamma(rng, shape + 1, scale) * Math.pow(u, 1 / shape)
  }

  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (let i = 0; i < 1000; i++) {
    const x = sampleNormal(rng)
    const v = (1 + c * x) ** 3
    if (v <= 0) continue
    const u = rng()
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v * scale
    }
  }
  // До сюда практически не доходит; возвращаем матожидание, чтобы не зациклиться.
  return shape * scale
}
