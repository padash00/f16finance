/**
 * AI tool: получить детальную информацию по оператору
 * (выручка, смены, средний чек за период).
 * Capability: operators.view
 */

import type { CopilotTool } from '../../types'
import { scopedOperatorIds, scopedOperatorRows, resolveDateRange, dateRangeParams, fetchAllPages } from '../../query-helpers'

export const getOperatorInfoTool: CopilotTool = {
  name: 'get_operator_info',
  category: 'analytics',
  description: 'Получить статистику оператора (смены, выручка, средний чек)',
  requiredCapability: 'operators.view',
  severity: 'low',
  params: [
    {
      name: 'operator_id',
      label: 'Какой оператор',
      type: 'select',
      required: true,
      description: 'ID оператора',
      getOptions: async (ctx) => {
        const data = await scopedOperatorRows(ctx)
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    ...dateRangeParams(),
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    if (!operatorId) return { ok: false, message: 'Не выбран оператор.' }

    // Мультитенантная изоляция: оператор должен принадлежать своей организации.
    const allowedOpIds = await scopedOperatorIds(ctx)
    if (allowedOpIds && !allowedOpIds.includes(operatorId)) {
      return { ok: false, message: 'Оператор не найден.' }
    }

    const { from, to, label } = resolveDateRange(input, { defaultPeriod: 'week' })

    const { data: op } = await ctx.supabase.from('operators').select('id, name, short_name').eq('id', operatorId).single()
    if (!op) return { ok: false, message: 'Оператор не найден.' }

    const incomes = await fetchAllPages((rFrom, rTo) => {
      let incQ = ctx.supabase
        .from('incomes')
        .select('cash_amount, kaspi_amount, card_amount, online_amount, date, shift_id')
        .eq('operator_id', operatorId)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(rFrom, rTo)
      if (from) incQ = incQ.gte('date', from)
      if (to) incQ = incQ.lte('date', to)
      return incQ
    }).catch(() => [] as any[])

    const rows = incomes || []
    let totalRev = 0
    const shiftSet = new Set<string>()
    const dateSet = new Set<string>()
    for (const r of rows as any[]) {
      totalRev += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
      if (r.shift_id) shiftSet.add(r.shift_id)
      if (r.date) dateSet.add(r.date)
    }
    const shifts = shiftSet.size || dateSet.size
    const avgPerShift = shifts > 0 ? totalRev / shifts : 0

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

    return {
      ok: true,
      message: `👤 ${op.short_name || op.name} — ${label}:
  Смены: ${shifts}
  Выручка: ${fmt(totalRev)}
  Средняя за смену: ${fmt(avgPerShift)}`,
      data: { totalRev, shifts, avgPerShift },
    }
  },
}
