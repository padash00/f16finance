/**
 * AI tool: показать сводку по смене (любой смене за дату).
 * Capability: shifts.view
 */

import type { CopilotTool } from '../../types'
import { resolveOperatorNames } from '../../query-helpers'

export const getShiftReportTool: CopilotTool = {
  name: 'get_shift_report',
  category: 'analytics',
  description: 'Показать сводку смены по дате и точке (выручка, оператор, расхождения)',
  requiredCapability: 'shifts.view',
  severity: 'low',
  params: [
    {
      name: 'date',
      label: 'Дата смены',
      type: 'date',
      required: true,
      description: 'YYYY-MM-DD',
    },
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: true,
      description: 'Какая точка',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const date = String(input.date || '')
    const companyId = String(input.company_id || '')
    if (!date || !companyId) return { ok: false, message: 'Нужны дата и точка.' }

    const { data: shifts } = await ctx.supabase
      .from('shifts')
      .select('id, shift_type, operator_name, operator_id')
      .eq('date', date)
      .eq('company_id', companyId)

    const { data: incomes } = await ctx.supabase
      .from('incomes')
      .select('shift, cash_amount, kaspi_amount, card_amount, online_amount, operator_id')
      .eq('date', date)
      .eq('company_id', companyId)

    if ((!shifts || shifts.length === 0) && (!incomes || incomes.length === 0)) {
      return { ok: true, message: `На ${date} нет смен и выручки на этой точке.` }
    }

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const lines: string[] = [`📅 ${date}:\n`]

    // Группируем выручку по смене
    const byShift = new Map<string, { cash: number; kaspi: number; card: number; online: number }>()
    for (const r of (incomes || []) as any[]) {
      const key = r.shift || 'day'
      const cur = byShift.get(key) || { cash: 0, kaspi: 0, card: 0, online: 0 }
      cur.cash += Number(r.cash_amount || 0)
      cur.kaspi += Number(r.kaspi_amount || 0)
      cur.card += Number(r.card_amount || 0)
      cur.online += Number(r.online_amount || 0)
      byShift.set(key, cur)
    }

    const operatorMap = await resolveOperatorNames(ctx.supabase, (shifts || []) as any)

    for (const sh of (shifts || []) as any[]) {
      const opName = operatorMap.get(String(sh.operator_id)) || sh.operator_name || '?'
      const inc = byShift.get(sh.shift_type) || { cash: 0, kaspi: 0, card: 0, online: 0 }
      const total = inc.cash + inc.kaspi + inc.card + inc.online
      lines.push(`${sh.shift_type === 'night' ? '🌙' : '☀️'} ${opName}:`)
      lines.push(`  Итого: ${fmt(total)}`)
      if (inc.cash > 0) lines.push(`  💵 Нал: ${fmt(inc.cash)}`)
      if (inc.kaspi > 0) lines.push(`  💳 Безналичный: ${fmt(inc.kaspi)}`)
      if (inc.card > 0) lines.push(`  💸 Карта: ${fmt(inc.card)}`)
      if (inc.online > 0) lines.push(`  🌐 Онлайн: ${fmt(inc.online)}`)
    }

    return { ok: true, message: lines.join('\n'), data: { shifts: shifts?.length || 0, incomes: incomes?.length || 0 } }
  },
}
