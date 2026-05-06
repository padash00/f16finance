/**
 * AI tool: добавить поставщика товаров.
 * Capability: store-suppliers.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const addSupplierTool: CopilotTool = {
  name: 'add_supplier',
  category: 'inventory',
  description: 'Добавить поставщика товаров (с контактами)',
  requiredCapability: 'store-suppliers.create',
  severity: 'medium',
  params: [
    {
      name: 'name',
      label: 'Название поставщика',
      type: 'string',
      required: true,
      description: 'ТОО / ИП / частное лицо',
    },
    {
      name: 'contact_phone',
      label: 'Телефон',
      type: 'string',
      required: false,
      description: 'Контакт',
    },
    {
      name: 'contact_person',
      label: 'Контактное лицо',
      type: 'string',
      required: false,
      description: 'ФИО менеджера',
    },
    {
      name: 'comment',
      label: 'Заметка',
      type: 'string',
      required: false,
      description: 'Что поставляет, условия и т.п.',
    },
  ],
  handler: async (input, ctx) => {
    const name = String(input.name || '').trim()
    const phone = String(input.contact_phone || '').trim() || null
    const person = String(input.contact_person || '').trim() || null
    const comment = String(input.comment || '').trim() || null
    if (!name) return { ok: false, message: 'Название обязательно.' }

    const { data, error } = await ctx.supabase
      .from('inventory_suppliers')
      .insert([{ name, contact_phone: phone, contact_person: person, comment, is_active: true }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-supplier',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { name, phone, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Поставщик "${name}" добавлен.` }
  },
}
