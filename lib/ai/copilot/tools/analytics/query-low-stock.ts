/**
 * AI tool: посмотреть товары с низким остатком на витрине.
 * Capability: store-showcase.view
 */

import type { CopilotTool } from '../../types'

export const queryLowStockTool: CopilotTool = {
  name: 'query_low_stock',
  category: 'analytics',
  description: 'Показать товары с низким остатком на витрине',
  requiredCapability: 'store-showcase.view',
  severity: 'low',
  params: [
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: false,
      description: 'Фильтр по точке. Если не указан — все.',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return [
          { value: '', label: '📍 Все точки' },
          ...(data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') })),
        ]
      },
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')

    // Запрос по витринным локациям
    let locQuery = ctx.supabase
      .from('inventory_locations')
      .select('id, company_id, location_type')
      .eq('location_type', 'point_display')
      .eq('is_active', true)
    if (companyId) locQuery = locQuery.eq('company_id', companyId)

    const { data: locations, error: locErr } = await locQuery
    if (locErr) return { ok: false, message: `Ошибка: ${locErr.message}` }

    const locationIds = (locations || []).map((l: any) => String(l.id))
    if (locationIds.length === 0) return { ok: true, message: 'Нет активных витрин.' }

    const { data: balances, error: balErr } = await ctx.supabase
      .from('inventory_balances')
      .select('item_id, location_id, quantity')
      .in('location_id', locationIds)
    if (balErr) return { ok: false, message: `Ошибка: ${balErr.message}` }

    const itemIds = Array.from(new Set((balances || []).map((b: any) => String(b.item_id))))
    if (itemIds.length === 0) return { ok: true, message: 'Витрина пуста.' }

    const { data: items, error: itemErr } = await ctx.supabase
      .from('inventory_items')
      .select('id, name, low_stock_threshold')
      .in('id', itemIds)
    if (itemErr) return { ok: false, message: `Ошибка: ${itemErr.message}` }

    type ItemRow = { id: string; name: string; low_stock_threshold: number | null }
    const itemMap = new Map<string, ItemRow>((items || []).map((i: any) => [String(i.id), i as ItemRow]))
    const lowStock: Array<{ name: string; qty: number; threshold: number }> = []
    for (const b of (balances || []) as Array<{ item_id: string; quantity: number }>) {
      const item = itemMap.get(String(b.item_id))
      if (!item) continue
      const threshold = Number(item.low_stock_threshold || 0)
      const qty = Number(b.quantity || 0)
      if (threshold > 0 ? qty <= threshold : qty <= 0) {
        lowStock.push({ name: item.name, qty, threshold })
      }
    }

    if (lowStock.length === 0) return { ok: true, message: '✅ Нет товаров с низким остатком.' }

    lowStock.sort((a, b) => a.qty - b.qty)
    const top = lowStock.slice(0, 15)
    const lines = ['⚠️ Низкий остаток:', ...top.map((s) => `  • ${s.name}: ${s.qty}${s.threshold > 0 ? ` (мин ${s.threshold})` : ''}`)]
    if (lowStock.length > top.length) lines.push(`  ... и ещё ${lowStock.length - top.length}`)

    return {
      ok: true,
      message: lines.join('\n'),
      data: { count: lowStock.length, items: top },
      followUps: [{ label: '👁 Открыть витрину', action: 'open:/store/showcase' }],
    }
  },
}
