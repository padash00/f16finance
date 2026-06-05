/**
 * AI tool: показать детали зарплаты оператора за неделю.
 * Capability: salary.view
 */

import type { CopilotTool } from '../../types'
import { scopedOperatorRows } from '../../query-helpers'

function thisWeekStart(): string {
  const now = new Date()
  const day = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day - 1))
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

export const getOperatorSalaryTool: CopilotTool = {
  name: 'get_operator_salary',
  category: 'analytics',
  description: 'Показать зарплату оператора за неделю (брутто, штрафы, бонусы, авансы, к выплате)',
  requiredCapability: 'salary.view',
  severity: 'low',
  params: [
    {
      name: 'operator_id',
      label: 'Оператор',
      type: 'select',
      required: true,
      description: 'ID оператора',
      getOptions: async (ctx) => {
        const data = await scopedOperatorRows(ctx)
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    {
      name: 'week_start',
      label: 'Начало недели (YYYY-MM-DD)',
      type: 'date',
      required: false,
      description: 'Понедельник недели. Если не указан — текущая.',
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const weekStart = String(input.week_start || '').trim() || thisWeekStart()
    if (!operatorId) return { ok: false, message: 'Не выбран оператор.' }

    const { data: op } = await ctx.supabase.from('operators').select('id, name, short_name').eq('id', operatorId).single()
    if (!op) return { ok: false, message: 'Оператор не найден.' }

    const { data: week } = await ctx.supabase
      .from('operator_salary_weeks')
      .select('id, gross_amount, bonus_amount, fine_amount, debt_amount, advance_amount, net_amount, paid_amount, remaining_amount, status, week_end')
      .eq('operator_id', operatorId)
      .eq('week_start', weekStart)
      .maybeSingle()

    if (!week) {
      return { ok: true, message: `${op.short_name || op.name} — на неделе ${weekStart} ещё нет расчёта зарплаты.` }
    }

    const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('ru-RU') + ' ₸'
    return {
      ok: true,
      message: `💼 ${op.short_name || op.name} — зарплата за неделю ${weekStart} – ${week.week_end}:
  Брутто: ${fmt(week.gross_amount)}
  + Бонусы: ${fmt(week.bonus_amount)}
  − Штрафы: ${fmt(week.fine_amount)}
  − Долги: ${fmt(week.debt_amount)}
  − Авансы: ${fmt(week.advance_amount)}
  Чистыми: ${fmt(week.net_amount)}
  Выплачено: ${fmt(week.paid_amount)}
  Остаток: ${fmt(week.remaining_amount)}
  Статус: ${week.status}`,
      data: { week },
    }
  },
}
