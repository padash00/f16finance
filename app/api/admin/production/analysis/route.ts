import { NextResponse } from 'next/server'

import { resolveAllRecipeCosts } from '@/lib/domain/production'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}
function canManage(access: any) {
  if (access.isSuperAdmin) return true
  const role = String(access.staffMember?.role || access.staffRole || '').toLowerCase()
  return role === 'owner' || role === 'manager'
}

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — теоретический food cost и расход ингредиентов
// из продаж блюд (point_sale_items), связанных с техкартами через recipes.sale_item_id.
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const gate = await requireOrgFeature(access, 'restaurant.recipes_lite')
    if (gate) return gate

    const orgId = access.activeOrganization?.id || null
    const scopeOrg = orgId || '00000000-0000-0000-0000-000000000000'
    const url = new URL(request.url)
    const today = new Date().toISOString().slice(0, 10)
    const from = url.searchParams.get('from') || today
    const to = url.searchParams.get('to') || today

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // 1) Техкарты своей орг + состав + цены ингредиентов → себестоимость порции
    const { data: recipes } = await supabase
      .from('recipes')
      .select('id, name, output_qty, yield_factor, sale_item_id')
      .eq('organization_id', scopeOrg)
    const recipeRows = recipes || []
    const recipeIds = recipeRows.map((r: any) => String(r.id))
    let components: any[] = []
    if (recipeIds.length) {
      const { data: comps } = await supabase
        .from('recipe_components')
        .select('recipe_id, ingredient_id, component_recipe_id, qty, waste_pct')
        .in('recipe_id', recipeIds)
      components = comps || []
    }
    const ingIds = Array.from(new Set(components.map((c) => c.ingredient_id).filter(Boolean))) as string[]
    const ingredientCostById = new Map<string, number>()
    const ingredientNameById = new Map<string, string>()
    const ingredientUnitById = new Map<string, string>()
    if (ingIds.length) {
      const { data: ings } = await supabase.from('ingredients').select('id, name, purchase_price, unit').in('id', ingIds)
      for (const it of ings || []) {
        ingredientCostById.set(String(it.id), Number((it as any).purchase_price || 0))
        ingredientNameById.set(String(it.id), String((it as any).name || ''))
        ingredientUnitById.set(String(it.id), String((it as any).unit || ''))
      }
    }
    const compsByRecipe = new Map<string, any[]>()
    for (const c of components) {
      const arr = compsByRecipe.get(String(c.recipe_id)) || []
      arr.push(c); compsByRecipe.set(String(c.recipe_id), arr)
    }
    const costInput = recipeRows.map((r: any) => ({
      id: String(r.id), output_qty: Number(r.output_qty || 1), yield_factor: Number(r.yield_factor || 1),
      components: (compsByRecipe.get(String(r.id)) || []).map((c: any) => ({ ingredient_id: c.ingredient_id, component_recipe_id: c.component_recipe_id, qty: Number(c.qty || 0), waste_pct: Number(c.waste_pct || 0) })),
    }))
    const costs = resolveAllRecipeCosts({ recipes: costInput, ingredientCostById })

    // sale_item_id → recipe
    const recipeBySaleItem = new Map<string, any>()
    for (const r of recipeRows) if (r.sale_item_id) recipeBySaleItem.set(String(r.sale_item_id), r)
    const saleItemIds = Array.from(recipeBySaleItem.keys())
    if (saleItemIds.length === 0) {
      return json({ ok: true, from, to, rows: [], ingredients: [], totals: { sold: 0, food_cost: 0, revenue: 0 } })
    }

    // 2) Продажи за период по точкам своей орг
    const scope = await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin })
    let salesQ = supabase.from('point_sales').select('id').gte('sale_date', from).lte('sale_date', to)
    if (scope.allowedCompanyIds) salesQ = salesQ.in('company_id', scope.allowedCompanyIds)
    const { data: sales } = await salesQ
    const saleIds = (sales || []).map((s: any) => String(s.id))
    const soldByItem = new Map<string, { qty: number; revenue: number }>()
    if (saleIds.length) {
      // чанки по 500 sale_id
      for (let i = 0; i < saleIds.length; i += 500) {
        const chunk = saleIds.slice(i, i + 500)
        const { data: items } = await supabase
          .from('point_sale_items')
          .select('item_id, quantity, total_price, unit_price')
          .in('sale_id', chunk)
          .in('item_id', saleItemIds)
        for (const it of items || []) {
          const k = String(it.item_id)
          const cur = soldByItem.get(k) || { qty: 0, revenue: 0 }
          cur.qty += Number(it.quantity || 0)
          cur.revenue += Number(it.total_price || (it.quantity || 0) * (it.unit_price || 0) || 0)
          soldByItem.set(k, cur)
        }
      }
    }

    // 3) Сводка по техкартам + расход ингредиентов
    const ingUsage = new Map<string, number>()
    const rows: any[] = []
    let totSold = 0, totFood = 0, totRev = 0
    for (const [saleItemId, recipe] of recipeBySaleItem.entries()) {
      const sold = soldByItem.get(saleItemId)
      if (!sold || sold.qty <= 0) continue
      const portion = costs.get(String(recipe.id))?.portionCost || 0
      const foodCost = portion * sold.qty
      totSold += sold.qty; totFood += foodCost; totRev += sold.revenue
      rows.push({
        recipe_id: recipe.id, name: recipe.name, sold_qty: sold.qty,
        portion_cost: Math.round(portion), food_cost: Math.round(foodCost),
        revenue: Math.round(sold.revenue),
        margin: Math.round(sold.revenue - foodCost),
        food_cost_pct: sold.revenue > 0 ? Math.round((foodCost / sold.revenue) * 100) : 0,
      })
      // расход ингредиентов
      for (const c of compsByRecipe.get(String(recipe.id)) || []) {
        if (!c.ingredient_id) continue
        const used = sold.qty * Number(c.qty || 0) * (1 + Number(c.waste_pct || 0) / 100)
        ingUsage.set(String(c.ingredient_id), (ingUsage.get(String(c.ingredient_id)) || 0) + used)
      }
    }
    rows.sort((a, b) => b.food_cost - a.food_cost)
    const ingredients = Array.from(ingUsage.entries()).map(([id, qty]) => ({
      ingredient_id: id, name: ingredientNameById.get(id) || id, unit: ingredientUnitById.get(id) || '',
      qty: Math.round(qty * 100) / 100, cost: Math.round(qty * (ingredientCostById.get(id) || 0)),
    })).sort((a, b) => b.cost - a.cost)

    return json({
      ok: true, from, to, rows, ingredients,
      totals: { sold: totSold, food_cost: Math.round(totFood), revenue: Math.round(totRev), margin: Math.round(totRev - totFood), food_cost_pct: totRev > 0 ? Math.round((totFood / totRev) * 100) : 0 },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
