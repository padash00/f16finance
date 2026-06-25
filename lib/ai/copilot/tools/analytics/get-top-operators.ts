/**
 * AI tool: топ операторов по выручке за период.
 * Capability: operator-analytics.view
 */

import type { CopilotTool } from '../../types'
import { scopedOperatorIds, scopedOperatorRows, resolveDateRange, dateRangeParams } from '../../query-helpers'

export const getTopOperatorsTool: CopilotTool = {
  name: 'get_top_operators',
  category: 'analytics',
  description: 'Топ операторов по выручке за период',
  requiredCapability: 'operator-analytics.view',
  severity: 'low',
  params: [...dateRangeParams()],
  handler: async (input, ctx) => {
    const { from, to, label } = resolveDateRange(input, { defaultPeriod: 'week' })

    const ops = await scopedOperatorRows(ctx)
    const opMap = new Map((ops || []).map((o: any) => [String(o.id), o]))

    // Мультитенантная изоляция: только выручка операторов своей организации.
    const opIds = await scopedOperatorIds(ctx)
    let incomesQ = ctx.supabase
      .from('incomes')
      .select('operator_id, cash_amount, kaspi_amount, card_amount, online_amount, shift_id, date')
      .not('operator_id', 'is', null)
      .range(0, 19999)
    if (from) incomesQ = incomesQ.gte('date', from)
    if (to) incomesQ = incomesQ.lte('date', to)
    if (opIds) incomesQ = incomesQ.in('operator_id', opIds)
    const { data: incomes } = await incomesQ

    const stats = new Map<string, { rev: number; shifts: Set<string> }>()
    for (const r of (incomes || []) as any[]) {
      const opId = String(r.operator_id)
      const cur = stats.get(opId) || { rev: 0, shifts: new Set<string>() }
      cur.rev += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
      cur.shifts.add(r.shift_id || r.date)
      stats.set(opId, cur)
    }

    const ranking = Array.from(stats.entries())
      .map(([opId, s]) => {
        const op: any = opMap.get(opId)
        return {
          name: op?.short_name || op?.name || '?',
          rev: s.rev,
          shifts: s.shifts.size,
          avg: s.shifts.size > 0 ? s.rev / s.shifts.size : 0,
        }
      })
      .sort((a, b) => b.rev - a.rev)

    if (ranking.length === 0) return { ok: true, message: 'Нет данных за период.' }

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const lines = [`🏆 Топ операторов (${label}):\n`]
    ranking.slice(0, 10).forEach((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
      lines.push(`${medal} ${r.name}: ${fmt(r.rev)} (${r.shifts} см, ${fmt(r.avg)}/см)`)
    })

    return {
      ok: true,
      message: lines.join('\n'),
      data: { count: ranking.length },
      followUps: [{ label: '👁 Открыть рейтинг', action: 'open:/performance' }],
    }
  },
}
