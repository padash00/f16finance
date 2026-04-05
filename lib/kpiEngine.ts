// lib/kpiEngine.ts

export type CompanyCode = 'arena' | 'ramen' | 'extra'

const HOLT_ALPHA = 0.6
const HOLT_BETA = 0.2

function holtForecast(series: number[]) {
  if (series.length === 0) return 0
  if (series.length === 1) return Math.max(0, Math.round(series[0]))

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

export function calculateForecast(
  targetDate: Date, 
  prev1Raw: number, 
  prev2Raw: number
) {
  // Для проверки "текущего месяца" используем локальное время, чтобы не зависеть от UTC
  const now = new Date()
  const prev1Date = new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1)
  
  const isPrev1Current = 
    prev1Date.getFullYear() === now.getFullYear() && 
    prev1Date.getMonth() === now.getMonth()

  let prev1Estimated = prev1Raw
  let isPartial = false

  if (isPrev1Current) {
    const totalDaysInMonth = new Date(prev1Date.getFullYear(), prev1Date.getMonth() + 1, 0).getDate()
    const passedDays = Math.min(totalDaysInMonth, Math.max(1, now.getDate()))

    if (passedDays < totalDaysInMonth) {
      prev1Estimated = Math.round((prev1Raw / passedDays) * totalDaysInMonth)
      isPartial = true
    }
  }

  const forecast = holtForecast([prev2Raw, prev1Estimated])
  
  const trend = prev1Estimated > 0 
    ? ((forecast - prev1Estimated) / prev1Estimated) * 100 
    : 0

  return { forecast, prev1Estimated, isPartial, trend }
}
