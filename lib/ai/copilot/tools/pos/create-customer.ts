/**
 * AI tool: создать карточку клиента (для лояльности).
 * Capability: customers.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const createCustomerTool: CopilotTool = {
  name: 'create_customer',
  category: 'pos',
  description: 'Создать карточку клиента (для программы лояльности)',
  requiredCapability: 'customers.create',
  severity: 'medium',
  params: [
    {
      name: 'name',
      label: 'Имя клиента',
      type: 'string',
      required: true,
      description: 'ФИО или имя',
    },
    {
      name: 'phone',
      label: 'Телефон',
      type: 'string',
      required: false,
      description: 'Контакт для связи',
    },
    {
      name: 'birth_date',
      label: 'День рождения (YYYY-MM-DD)',
      type: 'date',
      required: false,
      description: 'Опционально для скидок именинникам',
    },
  ],
  handler: async (input, ctx) => {
    const name = String(input.name || '').trim()
    const phone = String(input.phone || '').trim() || null
    const birthDate = String(input.birth_date || '').trim() || null
    if (!name) return { ok: false, message: 'Имя обязательно.' }

    const { data, error } = await ctx.supabase
      .from('customers')
      .insert([{ name, phone, birth_date: birthDate, loyalty_points: 0 }])
      .select('id, name')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'customer',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { name, phone, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Клиент "${name}" создан.`, data: { customerId: data?.id } }
  },
}
