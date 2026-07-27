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

    // Изоляция: раньше вставка шла БЕЗ org/company И с неверными колонками
    // (contact_phone/contact_person/comment) → падала/создавала глобальную строку.
    // Поставщик принадлежит орг и точке-магазину; колонки — phone/contact_name/notes.
    const orgId = ctx.organizationId || null
    if (!orgId) return { ok: false, message: 'Не удалось определить организацию.' }
    let companyId: string | null = null
    try {
      const { data: ss } = await ctx.supabase.from('store_settings').select('store_company_id').eq('organization_id', orgId).maybeSingle()
      companyId = (ss as any)?.store_company_id || null
      if (!companyId) {
        const { data: shops } = await ctx.supabase.from('companies').select('id').eq('organization_id', orgId).eq('store_enabled', true).limit(2)
        if ((shops || []).length === 1) companyId = String((shops as any)[0].id)
      }
    } catch {}
    if (!companyId) return { ok: false, message: 'Не удалось определить точку-магазин.' }

    const { data, error } = await ctx.supabase
      .from('inventory_suppliers')
      .insert([{ name, phone, contact_name: person, notes: comment, organization_id: orgId, company_id: companyId }])
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
