/**
 * AI tool: получить детальную информацию по оператору
 * (выручка, смены, средний чек за период).
 * Capability: operators.view
 */

import type { CopilotTool } from '../../types'
import { scopedOperatorIds, scopedOperatorRows } from '../../query-helpers'

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
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'За какой период',
      getOptions: async () => [
        { value: 'week', label: 'Неделя' },
        { value: 'month', label: 'Месяц' },
        { value: 'quarter', label: 'Квартал' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const period = String(input.period || 'week')
    if (!operatorId) return { ok: false, message: 'Не выбран оператор.' }

    // Мультитенантная изоляция: оператор должен принадлежать своей организации.
    const allowedOpIds = await scopedOperatorIds(ctx)
    if (allowedOpIds && !allowedOpIds.includes(operatorId)) {
      return { ok: false, message: 'Оператор не найден.' }
    }

    const today = todayISO()
    let from = today
    if (period === 'week') from = addDaysISO(today, -6)
    else if (period === 'month') from = addDaysISO(today, -29)
    else if (period === 'quarter') from = addDaysISO(today, -89)

    const { data: op } = await ctx.supabase.from('operators').select('id, name, short_name').eq('id', operatorId).single()
    if (!op) return { ok: false, message: 'Оператор не найден.' }

    const { data: incomes } = await ctx.supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, card_amount, online_amount, date, shift_id')
      .eq('operator_id', operatorId)
      .gte('date', from)
      .lte('date', today)
      .range(0, 9999)

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
    const periodLabel: Record<string, string> = { week: 'неделя', month: 'месяц', quarter: 'квартал' }

    return {
      ok: true,
      message: `👤 ${op.short_name || op.name} — ${periodLabel[period] || period}:
  Смены: ${shifts}
  Выручка: ${fmt(totalRev)}
  Средняя за смену: ${fmt(avgPerShift)}`,
      data: { totalRev, shifts, avgPerShift },
    }
  },
}
