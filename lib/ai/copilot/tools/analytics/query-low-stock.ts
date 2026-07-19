/**
 * AI tool: посмотреть товары с низким остатком на витрине.
 * Capability: store-showcase.view
 */

import type { CopilotTool } from '../../types'
import { chunkArray, companyOptions, fetchAllPages, scopedCompanyIds } from '../../query-helpers'

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
      getOptions: async (ctx) => companyOptions(ctx, { allLabel: '📍 Все точки' }),
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
    if (companyId) {
      locQuery = locQuery.eq('company_id', companyId)
    } else {
      const ids = await scopedCompanyIds(ctx)
      if (ids) locQuery = locQuery.in('company_id', ids)
    }

    const { data: locations, error: locErr } = await locQuery
    if (locErr) return { ok: false, message: `Ошибка: ${locErr.message}` }

    const locationIds = (locations || []).map((l: any) => String(l.id))
    if (locationIds.length === 0) return { ok: true, message: 'Нет активных витрин.' }

    // Балансов может быть >1000 — постранично, иначе часть низких остатков теряется.
    let balances: any[]
    try {
      balances = await fetchAllPages((from, to) =>
        ctx.supabase
          .from('inventory_balances')
          .select('item_id, location_id, quantity')
          .in('location_id', locationIds)
          .order('item_id', { ascending: true })
          .range(from, to),
      )
    } catch (balErr: any) {
      return { ok: false, message: `Ошибка: ${balErr?.message || 'запрос остатков не удался'}` }
    }

    const itemIds = Array.from(new Set((balances || []).map((b: any) => String(b.item_id))))
    if (itemIds.length === 0) return { ok: true, message: 'Витрина пуста.' }

    // Товары чанками по 200 id (лимит длины URL при большом каталоге).
    let items: any[]
    try {
      const chunks = await Promise.all(
        chunkArray(itemIds, 200).map((ids) =>
          fetchAllPages((from, to) =>
            ctx.supabase
              .from('inventory_items')
              .select('id, name, low_stock_threshold')
              .in('id', ids)
              .order('id', { ascending: true })
              .range(from, to),
          ),
        ),
      )
      items = chunks.flat()
    } catch (itemErr: any) {
      return { ok: false, message: `Ошибка: ${itemErr?.message || 'запрос товаров не удался'}` }
    }

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
