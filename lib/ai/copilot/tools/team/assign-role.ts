/**
 * AI tool: назначить роль сотруднику (owner / manager / other).
 * Capability: staff.update
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const assignRoleTool: CopilotTool = {
  name: 'assign_role',
  category: 'team',
  description: 'Назначить роль сотруднику (владелец / менеджер / сотрудник)',
  requiredCapability: 'staff.update',
  severity: 'critical',
  params: [
    {
      name: 'staff_id',
      label: 'Сотрудник',
      type: 'select',
      required: true,
      description: 'Кому меняем роль',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('staff').select('id, full_name, email, role').order('full_name')
        return (data || []).map((s: any) => ({ value: s.id, label: `${s.full_name || s.email || '?'} · ${s.role || ''}` }))
      },
    },
    {
      name: 'role',
      label: 'Новая роль',
      type: 'select',
      required: true,
      description: 'Какая роль',
      getOptions: async () => [
        { value: 'owner', label: '👑 Владелец (полный доступ)' },
        { value: 'manager', label: '🛡 Менеджер (управление)' },
        { value: 'other', label: '👤 Сотрудник (ограниченный)' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const staffId = String(input.staff_id || '')
    const role = String(input.role || '')
    if (!staffId || !['owner', 'manager', 'other'].includes(role)) return { ok: false, message: 'Не хватает данных.' }

    const { data: before } = await ctx.supabase.from('staff').select('full_name, role').eq('id', staffId).single()
    const { error } = await ctx.supabase.from('staff').update({ role }).eq('id', staffId)
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'staff',
        entityId: staffId,
        action: 'change-role',
        payload: { name: before?.full_name, old: before?.role, new: role, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🛡 Роль "${before?.full_name || ''}" изменена: ${before?.role || '?'} → ${role}` }
  },
}
