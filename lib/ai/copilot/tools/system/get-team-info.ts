/**
 * AI tool: краткая справка по команде (сколько кого).
 * Capability: operators.view (минимум)
 */

import type { CopilotTool } from '../../types'

export const getTeamInfoTool: CopilotTool = {
  name: 'get_team_info',
  category: 'analytics',
  description: 'Сводка по команде: операторы, сотрудники, лидеры точек',
  requiredCapability: 'operators.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    const [{ data: ops }, { data: staff }, { data: leads }] = await Promise.all([
      ctx.supabase.from('operators').select('id, is_active'),
      ctx.supabase.from('staff').select('id, role'),
      ctx.supabase
        .from('operator_company_assignments')
        .select('id')
        .eq('is_active', true)
        .in('role_in_company', ['senior_cashier', 'senior_operator']),
    ])

    const activeOps = (ops || []).filter((o: any) => o.is_active).length
    const inactiveOps = (ops || []).filter((o: any) => !o.is_active).length

    const staffByRole = new Map<string, number>()
    for (const s of (staff || []) as any[]) {
      const r = s.role || 'other'
      staffByRole.set(r, (staffByRole.get(r) || 0) + 1)
    }

    const lines: string[] = ['👥 Команда:\n']
    lines.push(`📋 Операторы: ${activeOps} активных${inactiveOps > 0 ? `, ${inactiveOps} заблокированных` : ''}`)
    lines.push(`🏆 Лидеры точек: ${(leads || []).length}`)
    lines.push('')
    lines.push(`👔 Сотрудники: ${(staff || []).length}`)
    for (const [role, count] of staffByRole) {
      const label: Record<string, string> = {
        owner: 'Владельцы',
        manager: 'Руководители',
        marketer: 'Маркетологи',
        other: 'Прочие',
      }
      lines.push(`  • ${label[role] || role}: ${count}`)
    }

    return { ok: true, message: lines.join('\n'), data: { activeOps, staffCount: (staff || []).length } }
  },
}
