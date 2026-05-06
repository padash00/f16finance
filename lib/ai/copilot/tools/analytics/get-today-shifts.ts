/**
 * AI tool: посмотреть кто работает сегодня (день + ночь).
 * Capability: shifts.view
 */

import type { CopilotTool } from '../../types'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const getTodayShiftsTool: CopilotTool = {
  name: 'get_today_shifts',
  category: 'analytics',
  description: 'Показать кто работает сегодня (по точкам, день и ночь)',
  requiredCapability: 'shifts.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    const today = todayISO()
    const { data, error } = await ctx.supabase
      .from('shifts')
      .select('id, shift_type, operator_name, operator:operator_id(name, short_name), company:company_id(name, code)')
      .eq('date', today)
      .order('shift_type')
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    if (rows.length === 0) {
      return { ok: true, message: '📅 На сегодня нет назначенных смен.' }
    }

    const lines: string[] = [`📅 Смены на сегодня (${today}):\n`]
    const byCompany = new Map<string, Array<{ type: string; name: string }>>()
    for (const sh of rows as any[]) {
      const op = Array.isArray(sh.operator) ? sh.operator[0] : sh.operator
      const co = Array.isArray(sh.company) ? sh.company[0] : sh.company
      const companyName = (co?.name || '?') + (co?.code ? ` (${co.code})` : '')
      const list = byCompany.get(companyName) || []
      list.push({
        type: sh.shift_type === 'night' ? '🌙' : '☀️',
        name: op?.short_name || op?.name || sh.operator_name || '?',
      })
      byCompany.set(companyName, list)
    }

    for (const [company, shifts] of byCompany) {
      lines.push(`📍 ${company}:`)
      for (const s of shifts) lines.push(`  ${s.type} ${s.name}`)
    }
    lines.push(`\nИтого смен: ${rows.length}`)

    return { ok: true, message: lines.join('\n'), data: { count: rows.length, shifts: rows } }
  },
}
