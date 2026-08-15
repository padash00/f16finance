/**
 * Настройки модуля эффективности продавцов.
 *
 * Всё, что в исходном ТЗ называлось «редактируемым», живёт здесь: веса метрик,
 * пороги классификации, минимальные выборки, границы клипа. Значения по
 * умолчанию — из ТЗ; строка в `store_kpi_settings` их переопределяет по точке.
 *
 * Почему не константы в коде: пороги придётся калибровать по факту (в ТЗ прямо
 * сказано, что бонус, который получают 90% смен, бессмысленен), а калибровать
 * их правкой кода и деплоем — плохая идея.
 */

import type { MetricKey } from './types'

export type StoreKpiSettings = {
  /** Месяцы летнего сезона. Остальное — учебный сезон. */
  summer_months: number[]

  /** Меньше этого числа смен в сегменте — спускаемся на уровень грубее. */
  min_sample_size: number
  /** Меньше этого числа смен у продавца — статус «недостаточно данных». */
  min_qualifying_shifts: number
  /** Меньше этого числа чеков в смене — уверенность вниз (но НЕ балл). */
  min_receipts_for_full_score: number

  /** Границы отношения факт/ожидание: одна аномалия не должна решать всё. */
  ratio_clip_min: number
  ratio_clip_max: number

  /** Веса метрик в общем балле. Недоступные метрики перевзвешиваются. */
  weights: Record<MetricKey, number>

  /** Границы статусов продавца по баллу. */
  status_needs_training_below: number
  status_strong_from: number
  status_top_from: number

  // ── План смены и бонусы ────────────────────────────────────────────────
  /**
   * Перцентили выручки сегмента, из которых берутся уровни.
   * CONTROL — не штрафной порог, а отметка «разобраться, что произошло».
   */
  control_percentile: number
  b1_percentile: number
  b2_percentile: number
  b3_percentile: number

  /** Суммы бонусов, ₸. Платится только максимальный достигнутый уровень. */
  b1_amount: number
  b2_amount: number
  b3_amount: number
  /** Рекорд сегмента — заменяет B3, а не добавляется к нему. */
  record_amount: number

  /** Пороги округляются вверх до этого шага: план должен быть запоминаемым. */
  rounding_step: number

  /** За сколько дней вперёд крон фиксирует планы. */
  plan_lock_days_ahead: number

  // ── Месячный индекс спроса ─────────────────────────────────────────────
  monthly_index_min: number
  monthly_index_max: number
  /** Автоматически применяется изменение не больше этого. Дальше — вручную. */
  auto_adjust_max_delta: number

  // ── Погода и ворота ────────────────────────────────────────────────────
  /** Координаты точки для запроса погоды. null — погода не собирается. */
  latitude: number | null
  longitude: number | null
  /**
   * Разрешено ли погоде двигать бонусные пороги. По умолчанию нет: продавец
   * не влияет на дождь и не должен терять из-за него деньги.
   */
  weather_adjusts_bonus_threshold: boolean

  /**
   * Ворота верхних уровней по тесту на знание товара. По умолчанию выключены:
   * при включённых воротах и непроводимых тестах B3 срезался бы всем за
   * отсутствие данных, а не за незнание.
   */
  require_product_test_for_top_bonus: boolean
  product_test_min_score: number
  product_test_valid_days: number

  /** Версия модели: расчёты прошлых периодов должны помнить свою формулу. */
  model_version: string
}

/**
 * Веса из ТЗ: сумма 100%.
 *
 * `revenue_efficiency` тождественно равна отношению среднего чека к
 * ожидаемому (см. metrics.ts) — то есть средний чек фактически весит 40%.
 * Так решено осознанно: владелец считает средний чек главным показателем
 * работы продавца.
 */
export const DEFAULT_WEIGHTS: Record<MetricKey, number> = {
  avg_ticket: 0.25,
  items_per_receipt: 0.2,
  attach_rate: 0.25,
  revenue_efficiency: 0.15,
  plan_attainment: 0.05,
  product_knowledge: 0.1,
}

export const DEFAULT_STORE_KPI_SETTINGS: StoreKpiSettings = {
  summer_months: [6, 7, 8],
  min_sample_size: 8,
  min_qualifying_shifts: 6,
  min_receipts_for_full_score: 20,
  ratio_clip_min: 0.7,
  ratio_clip_max: 1.3,
  weights: DEFAULT_WEIGHTS,
  status_needs_training_below: 0.9,
  status_strong_from: 1.05,
  status_top_from: 1.15,

  control_percentile: 0.4,
  b1_percentile: 0.6,
  b2_percentile: 0.75,
  b3_percentile: 0.9,

  b1_amount: 2000,
  b2_amount: 3000,
  b3_amount: 5000,
  record_amount: 7000,

  rounding_step: 5000,
  plan_lock_days_ahead: 3,

  monthly_index_min: 0.85,
  monthly_index_max: 1.2,
  auto_adjust_max_delta: 0.05,

  latitude: null,
  longitude: null,
  weather_adjusts_bonus_threshold: false,

  require_product_test_for_top_bonus: false,
  product_test_min_score: 80,
  product_test_valid_days: 90,

  model_version: 'STORE_KPI_V1',
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Math.round(num(value, fallback))
  return n > 0 ? n : fallback
}

/** Перцентиль обязан лежать строго внутри (0;1), иначе уровень бессмыслен. */
function percentileOr(value: unknown, fallback: number): number {
  const n = num(value, fallback)
  return n > 0 && n < 1 ? n : fallback
}

/** Координата в допустимом диапазоне, иначе null: погоду просто не соберём. */
function coordOr(value: unknown, limit: number): number | null {
  if (value == null || value === '') return null
  const n = num(value, NaN)
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null
}

/** Сумма бонуса: ноль допустим (уровень выключен), отрицательная — нет. */
function moneyOr(value: unknown, fallback: number): number {
  const n = Math.round(num(value, fallback))
  return n >= 0 ? n : fallback
}

/**
 * Приводит строку из БД к настройкам. Любое кривое значение молча заменяется
 * значением по умолчанию: расчёт зарплатных величин не должен падать из-за
 * того, что кто-то записал в вес строку.
 */
export function normalizeStoreKpiSettings(row: Record<string, unknown> | null | undefined): StoreKpiSettings {
  const d = DEFAULT_STORE_KPI_SETTINGS
  if (!row) return d

  const rawWeights = (row.weights ?? null) as Record<string, unknown> | null
  const weights: Record<MetricKey, number> = { ...DEFAULT_WEIGHTS }
  if (rawWeights && typeof rawWeights === 'object') {
    for (const key of Object.keys(DEFAULT_WEIGHTS) as MetricKey[]) {
      if (rawWeights[key] == null) continue
      const w = num(rawWeights[key], DEFAULT_WEIGHTS[key])
      weights[key] = w >= 0 ? w : DEFAULT_WEIGHTS[key]
    }
  }

  const summer = Array.isArray(row.summer_months)
    ? (row.summer_months as unknown[]).map((m) => Math.round(num(m, 0))).filter((m) => m >= 1 && m <= 12)
    : d.summer_months

  const clipMin = num(row.ratio_clip_min, d.ratio_clip_min)
  const clipMax = num(row.ratio_clip_max, d.ratio_clip_max)

  // Перевёрнутые границы месячного индекса сняли бы ограничение вовсе.
  const rawMonthlyMin = num(row.monthly_index_min, d.monthly_index_min)
  const rawMonthlyMax = num(row.monthly_index_max, d.monthly_index_max)
  const monthlyOk = rawMonthlyMin > 0 && rawMonthlyMin < rawMonthlyMax
  const monthlyMin = monthlyOk ? rawMonthlyMin : d.monthly_index_min
  const monthlyMax = monthlyOk ? rawMonthlyMax : d.monthly_index_max

  return {
    summer_months: summer.length ? summer : d.summer_months,
    min_sample_size: positiveInt(row.min_sample_size, d.min_sample_size),
    min_qualifying_shifts: positiveInt(row.min_qualifying_shifts, d.min_qualifying_shifts),
    min_receipts_for_full_score: positiveInt(row.min_receipts_for_full_score, d.min_receipts_for_full_score),
    // Клип с перевёрнутыми границами обессмыслил бы защиту от аномалий.
    ratio_clip_min: clipMin > 0 && clipMin < clipMax ? clipMin : d.ratio_clip_min,
    ratio_clip_max: clipMax > clipMin ? clipMax : d.ratio_clip_max,
    weights,
    status_needs_training_below: num(row.status_needs_training_below, d.status_needs_training_below),
    status_strong_from: num(row.status_strong_from, d.status_strong_from),
    status_top_from: num(row.status_top_from, d.status_top_from),

    control_percentile: percentileOr(row.control_percentile, d.control_percentile),
    b1_percentile: percentileOr(row.b1_percentile, d.b1_percentile),
    b2_percentile: percentileOr(row.b2_percentile, d.b2_percentile),
    b3_percentile: percentileOr(row.b3_percentile, d.b3_percentile),

    b1_amount: moneyOr(row.b1_amount, d.b1_amount),
    b2_amount: moneyOr(row.b2_amount, d.b2_amount),
    b3_amount: moneyOr(row.b3_amount, d.b3_amount),
    record_amount: moneyOr(row.record_amount, d.record_amount),

    rounding_step: positiveInt(row.rounding_step, d.rounding_step),
    plan_lock_days_ahead: positiveInt(row.plan_lock_days_ahead, d.plan_lock_days_ahead),

    monthly_index_min: monthlyMin,
    monthly_index_max: monthlyMax,
    auto_adjust_max_delta: Math.abs(num(row.auto_adjust_max_delta, d.auto_adjust_max_delta)),

    latitude: coordOr(row.latitude, 90),
    longitude: coordOr(row.longitude, 180),
    weather_adjusts_bonus_threshold: row.weather_adjusts_bonus_threshold === true,
    require_product_test_for_top_bonus: row.require_product_test_for_top_bonus === true,
    product_test_min_score: positiveInt(row.product_test_min_score, d.product_test_min_score),
    product_test_valid_days: positiveInt(row.product_test_valid_days, d.product_test_valid_days),

    model_version: typeof row.model_version === 'string' && row.model_version ? row.model_version : d.model_version,
  }
}
