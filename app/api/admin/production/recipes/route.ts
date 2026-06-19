import { NextResponse } from 'next/server'

import { resolveAllRecipeCosts } from '@/lib/domain/production'
import { writeAuditLog } from '@/lib/server/audit'
import { requireOrgFeature } from '@/lib/server/entitlements'
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

function getOrgId(access: any): string | null {
  return access.activeOrganization?.id || null
}

type ComponentInput = {
  ingredient_id?: string | null
  component_recipe_id?: string | null
  name?: string | null
  qty?: number
  unit?: string | null
  waste_pct?: number | null
}

// ─── GET: список техкарт с food cost + каталог ингредиентов ──────────────────
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const gate = await requireOrgFeature(access, 'restaurant.recipes_lite')
    if (gate) return gate

    const orgId = getOrgId(access)
    if (!access.isSuperAdmin && !orgId) return json({ ok: true, recipes: [], ingredients: [] })

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const scopeOrg = orgId || '00000000-0000-0000-0000-000000000000'

    const { data: recipes, error: rErr } = await supabase
      .from('recipes')
      .select('id, name, category, output_qty, output_unit, yield_factor, sale_item_id, is_semi_finished, is_active, notes')
      .eq('organization_id', scopeOrg)
      .order('name')
    if (rErr) throw rErr

    const recipeIds = (recipes || []).map((r: any) => String(r.id))
    let components: any[] = []
    if (recipeIds.length) {
      const { data: comps, error: cErr } = await supabase
        .from('recipe_components')
        .select('id, recipe_id, ingredient_id, component_recipe_id, name, qty, unit, waste_pct, sort_order')
        .in('recipe_id', recipeIds)
        .order('sort_order')
      if (cErr) throw cErr
      components = comps || []
    }

    // Цены ингредиентов (из каталога ингредиентов своей орг)
    const ingIds = Array.from(new Set(components.map((c) => c.ingredient_id).filter(Boolean))) as string[]
    const ingredientCostById = new Map<string, number>()
    const ingredientNameById = new Map<string, string>()
    if (ingIds.length) {
      const { data: ings } = await supabase
        .from('ingredients')
        .select('id, name, purchase_price')
        .in('id', ingIds)
      for (const it of ings || []) {
        ingredientCostById.set(String(it.id), Number((it as any).purchase_price || 0))
        ingredientNameById.set(String(it.id), String((it as any).name || ''))
      }
    }

    // Состав по техкарте
    const compsByRecipe = new Map<string, any[]>()
    for (const c of components) {
      const arr = compsByRecipe.get(String(c.recipe_id)) || []
      arr.push(c)
      compsByRecipe.set(String(c.recipe_id), arr)
    }

    const recipeName = new Map<string, string>((recipes || []).map((r: any) => [String(r.id), String(r.name)]))
    const costInput = (recipes || []).map((r: any) => ({
      id: String(r.id),
      output_qty: Number(r.output_qty || 1),
      yield_factor: Number(r.yield_factor || 1),
      components: (compsByRecipe.get(String(r.id)) || []).map((c: any) => ({
        ingredient_id: c.ingredient_id,
        component_recipe_id: c.component_recipe_id,
        name: c.name || (c.ingredient_id ? ingredientNameById.get(String(c.ingredient_id)) : c.component_recipe_id ? recipeName.get(String(c.component_recipe_id)) : null),
        qty: Number(c.qty || 0),
        unit: c.unit,
        waste_pct: Number(c.waste_pct || 0),
      })),
    }))
    const costs = resolveAllRecipeCosts({ recipes: costInput, ingredientCostById })

    const out = (recipes || []).map((r: any) => {
      const cost = costs.get(String(r.id)) || { recipeCost: 0, portionCost: 0, components: [] }
      return {
        ...r,
        components: compsByRecipe.get(String(r.id)) || [],
        recipe_cost: Math.round(cost.recipeCost),
        portion_cost: Math.round(cost.portionCost),
      }
    })

    // Каталог ингредиентов своей орг (для формы)
    const { data: ingredients } = await supabase
      .from('ingredients')
      .select('id, name, unit, purchase_price, category, stock_qty')
      .eq('organization_id', scopeOrg)
      .eq('is_active', true)
      .order('name')

    // Товары продажи (для связи техкарта → блюдо в чеке)
    const { data: saleItems } = await supabase
      .from('inventory_items')
      .select('id, name, sale_price')
      .eq('organization_id', scopeOrg)
      .eq('is_active', true)
      .order('name')

    return json({ ok: true, recipes: out, ingredients: ingredients || [], saleItems: saleItems || [] })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

// ─── POST: создать техкарту ──────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const gate = await requireOrgFeature(access, 'restaurant.recipes_lite')
    if (gate) return gate

    const orgId = getOrgId(access)
    if (!orgId) return json({ error: 'Нет активной организации' }, 400)

    const body = (await request.json().catch(() => null)) as any
    const name = String(body?.name || '').trim()
    if (!name) return json({ error: 'Название обязательно' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data: recipe, error } = await supabase
      .from('recipes')
      .insert({
        organization_id: orgId,
        company_id: body?.company_id || null,
        name,
        category: body?.category?.trim() || null,
        output_qty: Number(body?.output_qty) || 1,
        output_unit: String(body?.output_unit || 'порц').trim() || 'порц',
        yield_factor: Number(body?.yield_factor) || 1,
        sale_item_id: body?.sale_item_id || null,
        is_semi_finished: body?.is_semi_finished === true,
        notes: body?.notes?.trim() || null,
      })
      .select('id')
      .single()
    if (error) throw error

    const comps = (Array.isArray(body?.components) ? body.components : []) as ComponentInput[]
    const rows = comps
      .filter((c) => (c.ingredient_id || c.component_recipe_id || c.name) && Number(c.qty) > 0)
      .map((c, i) => ({
        recipe_id: (recipe as any).id,
        ingredient_id: c.ingredient_id || null,
        component_recipe_id: c.component_recipe_id || null,
        name: c.name?.trim() || null,
        qty: Number(c.qty) || 0,
        unit: String(c.unit || 'г').trim() || 'г',
        waste_pct: Number(c.waste_pct) || 0,
        sort_order: i,
      }))
    if (rows.length) {
      const { error: cErr } = await supabase.from('recipe_components').insert(rows)
      if (cErr) throw cErr
    }

    await writeAuditLog(supabase, { entityType: 'recipe', entityId: String((recipe as any).id), action: 'create', payload: { name, organization_id: orgId } })
    return json({ ok: true, id: (recipe as any).id })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

// ─── PATCH: редактировать техкарту (+ заменить состав) ───────────────────────
export async function PATCH(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const gate = await requireOrgFeature(access, 'restaurant.recipes_lite')
    if (gate) return gate

    const orgId = getOrgId(access)
    const body = (await request.json().catch(() => null)) as any
    const id = String(body?.id || '').trim()
    if (!id) return json({ error: 'id обязателен' }, 400)
    const name = String(body?.name || '').trim()
    if (!name) return json({ error: 'Название обязательно' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Изоляция: рецепт обязан принадлежать орг — иначе ниже мы стёрли бы/подменили
    // состав (recipe_components) чужой техкарты, даже если сам update затронул 0 строк.
    if (!access.isSuperAdmin && orgId) {
      const { data: ownRecipe } = await supabase
        .from('recipes')
        .select('id')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!ownRecipe) return json({ error: 'forbidden' }, 403)
    }

    let upd = supabase
      .from('recipes')
      .update({
        name,
        category: body?.category?.trim() || null,
        output_qty: Number(body?.output_qty) || 1,
        output_unit: String(body?.output_unit || 'порц').trim() || 'порц',
        yield_factor: Number(body?.yield_factor) || 1,
        sale_item_id: body?.sale_item_id || null,
        is_semi_finished: body?.is_semi_finished === true,
        notes: body?.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (!access.isSuperAdmin && orgId) upd = upd.eq('organization_id', orgId) // нельзя править чужую
    const { error } = await upd
    if (error) throw error

    if (Array.isArray(body?.components)) {
      await supabase.from('recipe_components').delete().eq('recipe_id', id)
      const comps = body.components as ComponentInput[]
      const rows = comps
        .filter((c) => (c.ingredient_id || c.component_recipe_id || c.name) && Number(c.qty) > 0)
        .map((c, i) => ({
          recipe_id: id,
          ingredient_id: c.ingredient_id || null,
          component_recipe_id: c.component_recipe_id || null,
          name: c.name?.trim() || null,
          qty: Number(c.qty) || 0,
          unit: String(c.unit || 'г').trim() || 'г',
          waste_pct: Number(c.waste_pct) || 0,
          sort_order: i,
        }))
      if (rows.length) {
        const { error: cErr } = await supabase.from('recipe_components').insert(rows)
        if (cErr) throw cErr
      }
    }

    await writeAuditLog(supabase, { entityType: 'recipe', entityId: id, action: 'update', payload: { name } })
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

// ─── DELETE ?id= ─────────────────────────────────────────────────────────────
export async function DELETE(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const orgId = getOrgId(access)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return json({ error: 'id обязателен' }, 400)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    let del = supabase.from('recipes').delete().eq('id', id)
    if (!access.isSuperAdmin && orgId) del = del.eq('organization_id', orgId) // нельзя удалить чужую
    const { error } = await del
    if (error) throw error
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
