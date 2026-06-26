/**
 * AI tool: краткая справка по команде (сколько кого).
 * Capability: operators.view (минимум)
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds, scopedOperatorIds } from '../../query-helpers'

export const getTeamInfoTool: CopilotTool = {
  name: 'get_team_info',
  category: 'analytics',
  description: 'Сводка по команде: операторы, сотрудники, лидеры точек',
  requiredCapability: 'operators.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    const [opIds, coIds] = await Promise.all([scopedOperatorIds(ctx), scopedCompanyIds(ctx)])
    let opsQ = ctx.supabase.from('operators').select('id, is_active')
    if (opIds) opsQ = opsQ.in('id', opIds)
    let leadsQ = ctx.supabase
      .from('operator_company_assignments')
      .select('id')
      .eq('is_active', true)
      .in('role_in_company', ['senior_cashier', 'senior_operator'])
    if (coIds) leadsQ = leadsQ.in('company_id', coIds)
    // staff скоупим по организации — иначе считаем сотрудников чужих клубов
    // (источник «2 владельца» — владельцы других орг.).
    let staffQ = ctx.supabase.from('staff').select('id, role')
    if (ctx.organizationId) staffQ = staffQ.eq('organization_id', ctx.organizationId)
    const [{ data: ops }, { data: staff }, { data: leads }] = await Promise.all([
      opsQ,
      staffQ,
      leadsQ,
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
