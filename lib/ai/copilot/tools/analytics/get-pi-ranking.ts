/**
 * AI tool: PI рейтинг операторов (справедливый — с учётом слотов).
 * Capability: performance.view
 */

import type { CopilotTool } from '../../types'

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

export const getPiRankingTool: CopilotTool = {
  name: 'get_pi_ranking',
  category: 'analytics',
  description: 'Справедливый рейтинг операторов по PI (Performance Index — с поправкой на слот)',
  requiredCapability: 'performance.view',
  severity: 'low',
  params: [
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'Период для рейтинга',
      getOptions: async () => [
        { value: 'thisWeek', label: 'Эта неделя' },
        { value: 'lastWeek', label: 'Прошлая неделя' },
        { value: 'thisMonth', label: 'Текущий месяц' },
        { value: 'lastMonth', label: 'Прошлый месяц' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || 'thisMonth')
    const today = todayISO()
    let from = today
    let to = today
    if (period === 'thisWeek') {
      const day = new Date(today).getDay() || 7
      from = addDaysISO(today, -(day - 1))
      to = addDaysISO(from, 6)
    } else if (period === 'lastWeek') {
      const day = new Date(today).getDay() || 7
      const monday = addDaysISO(today, -(day - 1))
      from = addDaysISO(monday, -7)
      to = addDaysISO(monday, -1)
    } else if (period === 'thisMonth') {
      const d = new Date(today)
      from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      to = today
    } else if (period === 'lastMonth') {
      const d = new Date(today)
      const lastMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1)
      from = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`
      const lastDay = new Date(d.getFullYear(), d.getMonth(), 0)
      to = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
    }

    // Дёргаем API endpoint напрямую (он уже все вычисляет с LOO + 180 дней baseline)
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    let url = `${baseUrl}/api/admin/performance/ranking?from=${from}&to=${to}`
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) return { ok: false, message: `Ошибка PI API: ${body?.error || res.status}` }

      const ranking = body.data?.ranking || []
      const qualifying = ranking.filter((r: any) => r.qualifying)
      if (qualifying.length === 0) return { ok: true, message: 'Нет операторов с достаточным числом смен (нужно ≥3).' }

      const lines = [`🎯 PI рейтинг (${period}):\n`]
      qualifying.slice(0, 10).forEach((op: any, i: number) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
        const piTag = op.pi >= 1.15 ? '⭐ Превосходно' : op.pi >= 1.05 ? '✓ Хорошо' : op.pi >= 0.95 ? 'Норма' : op.pi >= 0.85 ? '⚠ Ниже нормы' : '❌ Слабо'
        lines.push(`${medal} ${op.operator_short_name || op.operator_name}: PI=${op.pi.toFixed(2)} · ${piTag} · ${op.shifts} см`)
      })

      return {
        ok: true,
        message: lines.join('\n'),
        data: { count: qualifying.length },
        followUps: [{ label: '👁 Открыть PI', action: 'open:/performance' }],
      }
    } catch (e: any) {
      return { ok: false, message: `Не удалось получить PI: ${e?.message || 'unknown'}` }
    }
  },
}
