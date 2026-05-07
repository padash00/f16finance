/**
 * AI tool: рассчитать зарплату оператора за период.
 * Capability: salary.view
 */

import type { CopilotTool } from '../../types'

export const calculatePayrollTool: CopilotTool = {
  name: 'calculate_payroll',
  category: 'salary',
  description: 'Рассчитать зарплату оператора за период (смены + бонусы − штрафы − авансы)',
  requiredCapability: 'salary.view',
  severity: 'low',
  params: [
    {
      name: 'operator_id',
      label: 'Оператор',
      type: 'select',
      required: true,
      description: 'Кому',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('operators').select('id, name, short_name').eq('is_active', true).order('name')
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    { name: 'period_start', label: 'Начало периода', type: 'date', required: true, description: 'YYYY-MM-DD' },
    { name: 'period_end', label: 'Конец периода', type: 'date', required: true, description: 'YYYY-MM-DD' },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const start = String(input.period_start || '')
    const end = String(input.period_end || '')
    if (!operatorId || !start || !end) return { ok: false, message: 'Не хватает данных.' }

    const { data: opRow } = await ctx.supabase.from('operators').select('name, short_name').eq('id', operatorId).single()

    const { data: shifts } = await ctx.supabase
      .from('shifts')
      .select('shift_type')
      .eq('operator_id', operatorId)
      .gte('date', start)
      .lte('date', end)

    const { data: adjustments } = await ctx.supabase
      .from('operator_salary_adjustments')
      .select('kind, amount')
      .eq('operator_id', operatorId)
      .eq('status', 'active')
      .gte('date', start)
      .lte('date', end)

    const dayShifts = (shifts || []).filter((s: any) => s.shift_type !== 'night').length
    const nightShifts = (shifts || []).filter((s: any) => s.shift_type === 'night').length
    const dayRate = 8000  // placeholder — реальные ставки в operators.day_rate / night_rate
    const nightRate = 10000
    const baseSalary = dayShifts * dayRate + nightShifts * nightRate

    const bonuses = (adjustments || []).filter((a: any) => a.kind === 'bonus').reduce((s: number, a: any) => s + Number(a.amount || 0), 0)
    const fines = (adjustments || []).filter((a: any) => a.kind === 'fine').reduce((s: number, a: any) => s + Number(a.amount || 0), 0)
    const advances = (adjustments || []).filter((a: any) => a.kind === 'advance').reduce((s: number, a: any) => s + Number(a.amount || 0), 0)
    const debts = (adjustments || []).filter((a: any) => a.kind === 'debt').reduce((s: number, a: any) => s + Number(a.amount || 0), 0)

    const total = baseSalary + bonuses - fines - advances - debts

    const opName = opRow?.short_name || opRow?.name || ''
    const lines = [
      `💰 Расчёт зарплаты ${opName} (${start}—${end}):`,
      ``,
      `Смены: ${dayShifts} день + ${nightShifts} ночь = ${baseSalary.toLocaleString('ru-RU')} ₸`,
      bonuses ? `🎁 Бонусы: +${bonuses.toLocaleString('ru-RU')} ₸` : null,
      fines ? `⚠ Штрафы: −${fines.toLocaleString('ru-RU')} ₸` : null,
      advances ? `💵 Авансы: −${advances.toLocaleString('ru-RU')} ₸` : null,
      debts ? `📉 Долги: −${debts.toLocaleString('ru-RU')} ₸` : null,
      ``,
      `Итого к выплате: ${total.toLocaleString('ru-RU')} ₸`,
    ].filter(Boolean) as string[]

    return { ok: true, message: lines.join('\n'), data: { total, baseSalary, bonuses, fines, advances, debts } }
  },
}
