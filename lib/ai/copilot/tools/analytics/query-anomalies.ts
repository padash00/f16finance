/**
 * AI tool: найти аномалии в выручке за последний период
 * (дни где сильно ниже/выше среднего).
 * Capability: analytics.view
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysISO(iso: string, diff: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

const reIso = /^\d{4}-\d{2}-\d{2}$/

export const queryAnomaliesTool: CopilotTool = {
  name: 'query_anomalies',
  category: 'analytics',
  description: 'Найти аномальные дни — выручка сильно выше или ниже средней',
  requiredCapability: 'analytics.view',
  severity: 'low',
  params: [
    {
      name: 'period',
      label: 'За какой период',
      type: 'select',
      required: true,
      description: 'Анализируем последние N дней',
      getOptions: async () => [
        { value: '14', label: 'Последние 14 дней' },
        { value: '30', label: 'Последние 30 дней' },
        { value: '60', label: 'Последние 60 дней' },
      ],
    },
    { name: 'from', label: 'С даты', type: 'string', required: false, description: 'Начало периода YYYY-MM-DD (произвольный диапазон, имеет приоритет над period).' },
    { name: 'to', label: 'По дату', type: 'string', required: false, description: 'Конец периода YYYY-MM-DD.' },
  ],
  handler: async (input, ctx) => {
    const today = todayISO()
    const inFrom = String(input.from || '').trim()
    const inTo = String(input.to || '').trim()
    const hasExact = reIso.test(inFrom) && reIso.test(inTo)

    let from: string
    let to: string
    let days: number
    if (hasExact) {
      from = inFrom
      to = inTo
      const [fy, fm, fd] = from.split('-').map(Number)
      const [ty, tm, td] = to.split('-').map(Number)
      days = Math.round((new Date(ty, (tm || 1) - 1, td || 1).getTime() - new Date(fy, (fm || 1) - 1, fd || 1).getTime()) / 86400000) + 1
    } else {
      days = Number(input.period || '30')
      from = addDaysISO(today, -(days - 1))
      to = today
    }

    // Мультитенантная изоляция: только выручка точек своей организации.
    const ids = await scopedCompanyIds(ctx)
    let rowsQ = ctx.supabase
      .from('incomes')
      .select('date, cash_amount, kaspi_amount, card_amount, online_amount')
      .gte('date', from)
      .lte('date', to)
      .range(0, 19999)
    if (ids) rowsQ = rowsQ.in('company_id', ids)
    const { data: rows } = await rowsQ

    if (!rows || rows.length === 0) return { ok: true, message: 'Нет данных за период.' }

    // Группируем по дате
    const byDate = new Map<string, number>()
    for (const r of rows as any[]) {
      const sum = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
      byDate.set(r.date, (byDate.get(r.date) || 0) + sum)
    }
    const values = Array.from(byDate.values())
    if (values.length < 7) return { ok: true, message: 'Слишком мало дней для анализа аномалий.' }

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
    const stdDev = Math.sqrt(variance)

    const lowThreshold = Math.max(0, mean - 1.5 * stdDev)
    const highThreshold = mean + 1.5 * stdDev

    const lows: string[] = []
    const highs: string[] = []
    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const sortedByDate = Array.from(byDate.entries()).sort()
    for (const [date, sum] of sortedByDate) {
      if (sum <= lowThreshold) lows.push(`  📉 ${date}: ${fmt(sum)} (норма ${fmt(mean)})`)
      else if (sum >= highThreshold) highs.push(`  📈 ${date}: ${fmt(sum)} (норма ${fmt(mean)})`)
    }

    if (lows.length === 0 && highs.length === 0) {
      return { ok: true, message: `✅ Аномалий нет за ${days} дней. Среднее: ${fmt(mean)}, σ ${fmt(stdDev)}.` }
    }

    const lines: string[] = [`🔍 Аномалии за ${days} дней (среднее ${fmt(mean)}, σ ${fmt(stdDev)}):\n`]
    if (highs.length > 0) {
      lines.push('Положительные:')
      lines.push(...highs.slice(0, 5))
      if (highs.length > 5) lines.push(`  ... и ещё ${highs.length - 5}`)
    }
    if (lows.length > 0) {
      lines.push('\nОтрицательные:')
      lines.push(...lows.slice(0, 5))
      if (lows.length > 5) lines.push(`  ... и ещё ${lows.length - 5}`)
    }

    return { ok: true, message: lines.join('\n'), data: { lows: lows.length, highs: highs.length, mean, stdDev } }
  },
}
