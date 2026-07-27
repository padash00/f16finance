/**
 * AI tool: добавить товар в каталог.
 * Capability: catalog.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const addItemTool: CopilotTool = {
  name: 'add_item',
  category: 'inventory',
  description: 'Добавить новый товар в каталог',
  requiredCapability: 'catalog.create',
  severity: 'medium',
  params: [
    { name: 'name', label: 'Название товара', type: 'string', required: true, description: 'Как называется' },
    { name: 'sale_price', label: 'Цена продажи (₸)', type: 'number', required: true, description: 'По какой продаём' },
    { name: 'unit', label: 'Единица', type: 'string', required: false, description: 'шт / кг / л', extractHint: 'шт' },
    { name: 'barcode', label: 'Штрихкод', type: 'string', required: false, description: 'Опционально' },
  ],
  handler: async (input, ctx) => {
    const name = String(input.name || '').trim()
    const price = Number(input.sale_price || 0)
    const unit = String(input.unit || 'шт').trim() || 'шт'
    const barcode = String(input.barcode || '').trim() || null
    if (!name || price < 0) return { ok: false, message: 'Не хватает данных.' }

    // Изоляция: раньше вставка шла БЕЗ organization_id/company_id → глобальная
    // строка (кросс-тенант баг). Товар принадлежит орг и точке-магазину.
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
    if (!companyId) return { ok: false, message: 'Не удалось определить точку-магазин. Укажите её в настройках магазина.' }

    const { data, error } = await ctx.supabase
      .from('inventory_items')
      .insert([{ name, sale_price: price, unit, barcode, organization_id: orgId, company_id: companyId }])
      .select('id, name')
      .single()
    if (error) return { ok: false, message: `Не удалось добавить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-item',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { name, price, unit, barcode, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📦 Товар "${name}" добавлен (${price.toLocaleString('ru-RU')} ₸ / ${unit}).` }
  },
}
