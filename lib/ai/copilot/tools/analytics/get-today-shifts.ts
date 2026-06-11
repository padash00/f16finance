/**
 * AI tool: посмотреть кто работает сегодня (день + ночь).
 * Capability: shifts.view
 */

import type { CopilotTool } from '../../types'
import { resolveCompanyNames, resolveOperatorNames, scopedCompanyIds } from '../../query-helpers'

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
    let query = ctx.supabase
      .from('shifts')
      .select('id, shift_type, operator_name, operator_id, company_id')
      .eq('date', today)
      .order('shift_type')
    // Мультитенантная изоляция: только смены точек своей организации.
    const ids = await scopedCompanyIds(ctx)
    if (ids) query = query.in('company_id', ids)
    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    if (rows.length === 0) {
      return { ok: true, message: '📅 На сегодня нет назначенных смен.' }
    }

    const [companyMap, operatorMap] = await Promise.all([
      resolveCompanyNames(ctx.supabase, rows as any),
      resolveOperatorNames(ctx.supabase, rows as any),
    ])

    const lines: string[] = [`📅 Смены на сегодня (${today}):\n`]
    const byCompany = new Map<string, Array<{ type: string; name: string }>>()
    for (const sh of rows as any[]) {
      const companyName = companyMap.get(String(sh.company_id)) || '?'
      const list = byCompany.get(companyName) || []
      list.push({
        type: sh.shift_type === 'night' ? '🌙' : '☀️',
        name: operatorMap.get(String(sh.operator_id)) || sh.operator_name || '?',
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
