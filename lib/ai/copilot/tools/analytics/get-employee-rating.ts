/**
 * AI tool: рейтинг сотрудников по штрафам / нарушениям.
 * Capability: operators.view
 */

import type { CopilotTool } from '../../types'
import { resolveOperatorNames, scopedOperatorIds } from '../../query-helpers'

export const getEmployeeRatingTool: CopilotTool = {
  name: 'get_employee_rating',
  category: 'analytics',
  description: 'Рейтинг операторов: больше всего штрафов / бонусов за период',
  requiredCapability: 'operators.view',
  severity: 'low',
  params: [
    { name: 'days', label: 'За сколько дней', type: 'number', required: false, description: 'По умолчанию — 30' },
  ],
  handler: async (input, ctx) => {
    const days = Math.max(7, Math.min(365, Number(input.days || 30)))
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

    // Мультитенантная изоляция: корректировки только операторов своей организации
    // (operator_salary_adjustments ключуется по operator_id).
    const opIds = await scopedOperatorIds(ctx)
    let query = ctx.supabase
      .from('operator_salary_adjustments')
      .select('operator_id, kind, amount')
      .eq('status', 'active')
      .gte('date', since)
    if (opIds) query = query.in('operator_id', opIds)
    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: 'Корректировок зарплаты за период нет.' }

    const operatorMap = await resolveOperatorNames(ctx.supabase, data as any)

    type Stat = { name: string; bonuses: number; fines: number; bonusSum: number; fineSum: number }
    const byOp = new Map<string, Stat>()
    for (const r of data as any[]) {
      const key = r.operator_id
      const cur = byOp.get(key) || { name: operatorMap.get(String(key)) || '?', bonuses: 0, fines: 0, bonusSum: 0, fineSum: 0 }
      if (r.kind === 'bonus') { cur.bonuses++; cur.bonusSum += Number(r.amount || 0) }
      if (r.kind === 'fine') { cur.fines++; cur.fineSum += Number(r.amount || 0) }
      byOp.set(key, cur)
    }

    const ranked = Array.from(byOp.values()).sort((a, b) => (b.bonuses - b.fines) - (a.bonuses - a.fines))
    const lines: string[] = [`👥 Рейтинг за ${days} дн:\n`]
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i]
      const score = r.bonuses - r.fines
      const trend = score > 0 ? '🟢' : score < 0 ? '🔴' : '⚪'
      lines.push(`${i + 1}. ${trend} ${r.name}: 🎁${r.bonuses} (+${r.bonusSum.toLocaleString('ru-RU')}) | ⚠${r.fines} (−${r.fineSum.toLocaleString('ru-RU')})`)
    }
    return { ok: true, message: lines.join('\n'), data: { count: ranked.length } }
  },
}
