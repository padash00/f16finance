/**
 * AI tool: стоимость остатков на складе и витрине.
 * Capability: warehouse.view OR showcase.view
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds } from '../../query-helpers'

export const getStockValueTool: CopilotTool = {
  name: 'get_stock_value',
  category: 'analytics',
  description: 'Сколько товара на складе по закупочной/продажной стоимости',
  requiredCapability: 'warehouse.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    // Мультитенантная изоляция: остатки только по локациям своей организации
    // (inventory_balances не имеет company_id — резолвим локации через inventory_locations).
    const ids = await scopedCompanyIds(ctx)
    let allowedLocationIds: string[] | null = null
    if (ids) {
      const { data: locs } = await ctx.supabase
        .from('inventory_locations')
        .select('id')
        .in('company_id', ids)
      const locIds = (locs || []).map((l: any) => String(l.id))
      if (locIds.length === 0) return { ok: true, message: '📦 Остатков нет.' }
      allowedLocationIds = locIds
    }

    let balancesQ = ctx.supabase
      .from('inventory_balances')
      .select('quantity, item:item_id(name, sale_price), location:location_id(name, kind)')
    if (allowedLocationIds) balancesQ = balancesQ.in('location_id', allowedLocationIds)
    const { data: balances, error } = await balancesQ
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!balances?.length) return { ok: true, message: '📦 Остатков нет.' }

    let warehouseValue = 0
    let showcaseValue = 0
    let warehouseCount = 0
    let showcaseCount = 0

    for (const b of balances as any[]) {
      const item = Array.isArray(b.item) ? b.item[0] : b.item
      const loc = Array.isArray(b.location) ? b.location[0] : b.location
      const qty = Number(b.quantity || 0)
      const price = Number(item?.sale_price || 0)
      const value = qty * price

      if (loc?.kind === 'warehouse') { warehouseValue += value; warehouseCount += qty }
      else if (loc?.kind === 'point_display') { showcaseValue += value; showcaseCount += qty }
    }

    const total = warehouseValue + showcaseValue
    const lines = [
      `📦 Стоимость остатков (по продажной):`,
      ``,
      `🏭 Склад: ${warehouseValue.toLocaleString('ru-RU')} ₸ (${warehouseCount} шт)`,
      `🛍 Витрина: ${showcaseValue.toLocaleString('ru-RU')} ₸ (${showcaseCount} шт)`,
      ``,
      `Итого: ${total.toLocaleString('ru-RU')} ₸`,
    ]
    return { ok: true, message: lines.join('\n'), data: { total, warehouseValue, showcaseValue } }
  },
}
