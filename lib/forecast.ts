export function holtForecastNext(
  series: number[],
  alpha = 0.5,
  beta = 0.3,
  growthClampPct = 0.15, // ограничим тренд ±15% от уровня
) {
  if (series.length === 0) return 0
  if (series.length === 1) return series[0]

  let L = series[0]
  let T = series[1] - series[0]

  for (let i = 1; i < series.length; i++) {
    const y = series[i]
    const prevL = L

    L = alpha * y + (1 - alpha) * (L + T)
    T = beta * (L - prevL) + (1 - beta) * T

    const clamp = Math.abs(L) * growthClampPct
    if (T > clamp) T = clamp
    if (T < -clamp) T = -clamp
  }

  const next = L + T
  return Math.max(0, next)
}
