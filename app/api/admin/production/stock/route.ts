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

// Теоретический расход ингредиентов за период (по продажам связанных блюд).
async function theoreticalUsage(supabase: any, orgId: string | null, isSuperAdmin: boolean, scopeOrg: string, from: string, to: string) {
  const { data: recipes } = await supabase.from('recipes').select('id, output_qty, yield_factor, sale_item_id').eq('organization_id', scopeOrg)
  const recipeRows = recipes || []
  const recipeIds = recipeRows.map((r: any) => String(r.id))
  let components: any[] = []
  if (recipeIds.length) {
    const { data: comps } = await supabase.from('recipe_components').select('recipe_id, ingredient_id, component_recipe_id, qty, waste_pct').in('recipe_id', recipeIds)
    components = comps || []
  }
  const ingIds = Array.from(new Set(components.map((c) => c.ingredient_id).filter(Boolean))) as string[]
  const ingredientCostById = new Map<string, number>()
  if (ingIds.length) {
    const { data: ings } = await supabase.from('ingredients').select('id, purchase_price').in('id', ingIds)
    for (const it of ings || []) ingredientCostById.set(String(it.id), Number((it as any).purchase_price || 0))
  }
  const compsByRecipe = new Map<string, any[]>()
  for (const c of components) { const a = compsByRecipe.get(String(c.recipe_id)) || []; a.push(c); compsByRecipe.set(String(c.recipe_id), a) }
  const costInput = recipeRows.map((r: any) => ({ id: String(r.id), output_qty: Number(r.output_qty || 1), yield_factor: Number(r.yield_factor || 1), components: (compsByRecipe.get(String(r.id)) || []).map((c: any) => ({ ingredient_id: c.ingredient_id, component_recipe_id: c.component_recipe_id, qty: Number(c.qty || 0), waste_pct: Number(c.waste_pct || 0) })) }))
  resolveAllRecipeCosts({ recipes: costInput, ingredientCostById }) // прогрев (не используем, но валидирует)

  const recipeBySaleItem = new Map<string, any>()
  for (const r of recipeRows) if (r.sale_item_id) recipeBySaleItem.set(String(r.sale_item_id), r)
  const saleItemIds = Array.from(recipeBySaleItem.keys())
  const usage = new Map<string, number>()
  if (!saleItemIds.length) return usage

  const scope = await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin })
  let salesQ = supabase.from('point_sales').select('id').gte('sale_date', from).lte('sale_date', to)
  if (scope.allowedCompanyIds) salesQ = salesQ.in('company_id', scope.allowedCompanyIds)
  const { data: sales } = await salesQ
  const saleIds = (sales || []).map((s: any) => String(s.id))
  const soldByItem = new Map<string, number>()
  for (let i = 0; i < saleIds.length; i += 500) {
    const chunk = saleIds.slice(i, i + 500)
    const { data: items } = await supabase.from('point_sale_items').select('item_id, quantity').in('sale_id', chunk).in('item_id', saleItemIds)
    for (const it of items || []) soldByItem.set(String(it.item_id), (soldByItem.get(String(it.item_id)) || 0) + Number(it.quantity || 0))
  }
  for (const [saleItemId, recipe] of recipeBySaleItem.entries()) {
    const sold = soldByItem.get(saleItemId) || 0
    if (sold <= 0) continue
    for (const c of compsByRecipe.get(String(recipe.id)) || []) {
      if (!c.ingredient_id) continue
      const used = sold * Number(c.qty || 0) * (1 + Number(c.waste_pct || 0) / 100)
      usage.set(String(c.ingredient_id), (usage.get(String(c.ingredient_id)) || 0) + used)
    }
  }
  return usage
}

// GET — журнал движений (последние 100) своей орг.
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const gate = await requireOrgFeature(access, 'restaurant.recipes_lite')
    if (gate) return gate
    const orgId = access.activeOrganization?.id || null
    if (!access.isSuperAdmin && !orgId) return json({ ok: true, movements: [] })
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data, error } = await supabase
      .from('ingredient_movements')
      .select('id, ingredient_id, kind, qty_delta, balance_after, variance, comment, period_from, period_to, created_at, ingredient:ingredient_id(name, unit)')
      .eq('organization_id', orgId || '00000000-0000-0000-0000-000000000000')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    const movements = (data || []).map((m: any) => {
      const ing = Array.isArray(m.ingredient) ? m.ingredient[0] : m.ingredient
      return { ...m, ingredient_name: ing?.name || '—', ingredient_unit: ing?.unit || '' }
    })
    return json({ ok: true, movements })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const gate = await requireOrgFeature(access, 'restaurant.recipes_lite')
    if (gate) return gate
    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ error: 'Нет активной организации' }, 400)
    const scopeOrg = orgId
    const body = (await request.json().catch(() => null)) as any
    const action = String(body?.action || '')
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const userId = access.user?.id || null

    const move = async (ingredient_id: string, kind: string, delta: number, balanceAfter: number, extra: any = {}) => {
      await supabase.from('ingredient_movements').insert({ organization_id: orgId, ingredient_id, kind, qty_delta: delta, balance_after: balanceAfter, created_by: userId, ...extra })
    }
    const getIng = async (id: string) => {
      const { data } = await supabase.from('ingredients').select('id, stock_qty').eq('id', id).eq('organization_id', scopeOrg).maybeSingle()
      return data
    }

    if (action === 'receipt') {
      const id = String(body?.ingredient_id || '')
      const qty = Number(body?.qty) || 0
      if (!id || qty <= 0) return json({ error: 'ingredient_id и qty>0' }, 400)
      const ing = await getIng(id)
      if (!ing) return json({ error: 'Ингредиент не найден' }, 404)
      const balance = Number((ing as any).stock_qty || 0) + qty
      await supabase.from('ingredients').update({ stock_qty: balance, updated_at: new Date().toISOString() }).eq('id', id)
      await move(id, 'receipt', qty, balance, { comment: body?.comment?.trim() || null })
      return json({ ok: true, balance })
    }

    if (action === 'count') {
      const id = String(body?.ingredient_id || '')
      const counted = Number(body?.counted)
      if (!id || !Number.isFinite(counted)) return json({ error: 'ingredient_id и counted' }, 400)
      const ing = await getIng(id)
      if (!ing) return json({ error: 'Ингредиент не найден' }, 404)
      const expected = Number((ing as any).stock_qty || 0)
      const variance = counted - expected // <0 = недостача
      await supabase.from('ingredients').update({ stock_qty: counted, updated_at: new Date().toISOString() }).eq('id', id)
      await move(id, 'count', counted - expected, counted, { variance, comment: body?.comment?.trim() || null })
      return json({ ok: true, expected, counted, variance })
    }

    if (action === 'writeoff_sales') {
      const today = new Date().toISOString().slice(0, 10)
      const from = String(body?.from || today)
      const to = String(body?.to || today)
      const usage = await theoreticalUsage(supabase, orgId, access.isSuperAdmin, scopeOrg, from, to)
      let count = 0
      for (const [ingId, used] of usage.entries()) {
        if (used <= 0) continue
        const ing = await getIng(ingId)
        if (!ing) continue
        const balance = Number((ing as any).stock_qty || 0) - used
        await supabase.from('ingredients').update({ stock_qty: balance, updated_at: new Date().toISOString() }).eq('id', ingId)
        await move(ingId, 'sale_writeoff', -used, balance, { period_from: from, period_to: to })
        count++
      }
      return json({ ok: true, written_off: count, from, to })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
