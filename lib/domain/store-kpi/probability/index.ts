/**
 * Вероятностный слой модуля эффективности — единая точка входа.
 *
 * Внутри только чистая математика: ни обращений к базе, ни React, ни модели
 * ИИ. Всё детерминировано, всё тестируемо, симуляция воспроизводима по seed.
 *
 * Слой работает в теневом режиме: он считает прогноз рядом с существующим, но
 * не трогает ни оценку продавца, ни планы, ни выплаты. Право что-то менять он
 * получит только после бэктеста, который покажет, что новая модель лучше
 * старой — а не просто сложнее.
 */

export * from './types'
export { createRng, seedFromString, quantile, mean, variance } from './math'
export { estimateRate, DEFAULT_PRIOR } from './beta-binomial'
export { forecastDemand, factPercentile } from './demand'
export { fitNegativeBinomial } from './negative-binomial'
export { simulateShift, DEFAULT_ITERATIONS } from './monte-carlo'
export { probabilityDiagnostics, dispersionSummary, type ModelCheck, type ModelDiagnostics } from './diagnostics'
export { compareModels, calibration, type BacktestComparison, type ModelMetrics } from './backtest'
