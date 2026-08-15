/**
 * AI tool: создать нового оператора.
 * Capability: operators.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const createOperatorTool: CopilotTool = {
  name: 'create_operator',
  category: 'team',
  description: 'Добавить нового оператора в систему',
  requiredCapability: 'operators.create',
  severity: 'high',
  params: [
    {
      name: 'name',
      label: 'Полное имя',
      type: 'string',
      required: true,
      description: 'Полное ФИО оператора',
      extractHint: 'Айгерим Сериккызы',
    },
    {
      name: 'short_name',
      label: 'Короткое имя',
      type: 'string',
      required: false,
      description: 'Имя для отображения в интерфейсе (если отличается)',
    },
    {
      name: 'phone',
      label: 'Телефон',
      type: 'string',
      required: false,
      description: 'Опциональный телефон',
    },
  ],
  handler: async (input, ctx) => {
    const name = String(input.name || '').trim()
    const shortName = String(input.short_name || '').trim() || null
    const phone = String(input.phone || '').trim() || null

    if (!name) return { ok: false, message: 'Имя обязательно.' }

    // Оператор без organization_id виден в глобальных выборках и невидим в
    // скоупе своей организации — штампуем владельца при создании.
    if (!ctx.organizationId && !ctx.isSuperAdmin) {
      return { ok: false, message: 'Нет активной организации — оператора создать нельзя.' }
    }

    const { data, error } = await ctx.supabase
      .from('operators')
      .insert([{ name, short_name: shortName, is_active: true, organization_id: ctx.organizationId || null }])
      .select('id, name')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    if (phone && data?.id) {
      await ctx.supabase.from('operator_profiles').insert([{ operator_id: data.id, phone, full_name: name }]).select().single().catch(() => null)
    }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        // Тегируем событие организацией: иначе запись уходит в «общий» пул
        // audit_log и её читают копилоты других клиентов.
        organizationId: ctx.organizationId || null,
        entityType: 'operator',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { name, phone, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Оператор ${name} создан.`, data: { operatorId: data?.id } }
  },
}
