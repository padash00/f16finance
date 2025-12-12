// lib/kpiEngine.ts

export type CompanyCode = 'arena' | 'ramen' | 'extra'

// Настройки алгоритма (единые для всех)
const HOLT_ALPHA = 0.6
const HOLT_BETA = 0.2

// Метод Хольта
function holtForecast(series: number[]) {
  if (series.length === 0) return 0
  if (series.length === 1) return Math.max(0, series[0])

  let L = series[0]
  let T = series[1] - series[0]

  for (let i = 1; i < series.length; i++) {
    const y = series[i]
    const prevL = L
    L = HOLT_ALPHA * y + (1 - HOLT_ALPHA) * (L + T)
    T = HOLT_BETA * (L - prevL) + (1 - HOLT_BETA) * T
  }
  return Math.max(0, Math.round(L + T))
}

// Главная функция прогноза
export function calculateForecast(
  targetDate: Date, // На какой месяц строим (Январь)
  prev1Raw: number, // Сумма за Декабрь (N-1)
  prev2Raw: number, // Сумма за Ноябрь (N-2)
  isPrev1CurrentMonth: boolean // Декабрь - это текущий месяц?
) {
  let prev1Estimated = prev1Raw
  let isPartial = false

  // Если N-1 это текущий месяц, экстраполируем (скейлим)
  if (isPrev1CurrentMonth) {
    const now = new Date()
    // Сколько дней всего в месяце N-1
    const totalDays = new Date(targetDate.getFullYear(), targetDate.getMonth(), 0).getDate()
    // Сколько дней прошло (сегодняшний день)
    const passedDays = Math.max(1, now.getDate())

    // Если месяц не закончился, скейлим
    if (passedDays < totalDays) {
      prev1Estimated = Math.round((prev1Raw / passedDays) * totalDays)
      isPartial = true
    }
  }

  const forecast = holtForecast([prev2Raw, prev1Estimated])
  
  // Тренд в %
  const trend = prev1Estimated ? ((forecast - prev1Estimated) / prev1Estimated) * 100 : 0

  return {
    forecast,
    prev1Estimated, // Возвращаем оценку, чтобы показать юзеру "База с учетом прогноза"
    isPartial,
    trend
  }
}
