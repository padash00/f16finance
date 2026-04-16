import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { postInventoryReceipt } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

function canViewWarehouse(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager', 'other'].includes(access.staffRole)
}

function normalizeQty(v: unknown) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0
}

/** Ensure warehouse location exists for a company, create if missing */
async function ensureCompanyWarehouse(supabase: any, companyId: string) {
  const { data: existing, error: fetchErr } = await supabase
    .from('inventory_locations')
    .select('id, name, code, location_type, is_active')
    .eq('company_id', companyId)
    .eq('location_type', 'warehouse')
    .maybeSingle()

  if (fetchErr) throw fetchErr
  if (existing?.id) return existing

  // Create warehouse for this company
  const { data: company, error: compErr } = await supabase
    .from('companies')
    .select('id, name, code, organization_id')
    .eq('id', companyId)
    .maybeSingle()
  if (compErr) throw compErr
  if (!company?.id) throw new Error('company-not-found')

  const { data: created, error: insErr } = await supabase
    .from('inventory_locations')
    .insert({
      company_id: companyId,
      organization_id: company.organization_id,
      name: `Склад — ${company.name}`,
      code: company.code ? `WH-${company.code}` : null,
      location_type: 'warehouse',
      is_active: true,
    })
    .select('id, name, code, location_type, is_active')
    .single()

  if (insErr) throw insErr
  return created
}

// ─── GET: warehouse balances for a company ───────────────────────────────────

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canViewWarehouse(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Get all available companies (null = superadmin/legacy = no filter)
    const companiesQuery = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds) companiesQuery.in('id', companyScope.allowedCompanyIds)
    const { data: companies, error: companiesErr } = await companiesQuery
    if (companiesErr) throw companiesErr

    // Determine which company to show
    let companyId = url.searchParams.get('company_id') || null
    if (!companyId) {
      companyId = (companies || [])[0]?.id || null
    }
    if (!companyId) return json({ error: 'company-required' }, 400)

    // Access check (when scope is limited)
    if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
      if (!companyScope.allowedCompanyIds.includes(companyId)) {
        return json({ error: 'forbidden' }, 403)
      }
    }

    // Ensure warehouse exists
    const warehouse = await ensureCompanyWarehouse(supabase, companyId)

    // Balances
    const { data: balances, error: balErr } = await supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, sale_price, default_purchase_price, category_id, category:category_id(id, name))')
      .eq('location_id', warehouse.id)
      .order('quantity', { ascending: false })
    if (balErr) throw balErr

    // Categories for filter
    const { data: categories } = await supabase
      .from('inventory_categories')
      .select('id, name')
      .order('name')

    return json({
      ok: true,
      data: {
        warehouse,
        companies: companies || [],
        balances: balances || [],
        categories: categories || [],
        selectedCompanyId: companyId,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.GET', message: error?.message })
    return json({ error: error?.message || 'Ошибка загрузки склада' }, 500)
  }
}

// ─── POST: add stock / lookup barcode / create item ──────────────────────────

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'action-required' }, 400)

    // ── lookupBarcode ──────────────────────────────────────────────────────────
    if (body.action === 'lookupBarcode') {
      const barcode = String(body.barcode || '').trim()
      if (!barcode) return json({ error: 'barcode-required' }, 400)

      const { data: item } = await supabase
        .from('inventory_items')
        .select('id, name, barcode, unit, sale_price, default_purchase_price, category_id, category:category_id(id, name)')
        .eq('barcode', barcode)
        .eq('is_active', true)
        .maybeSingle()

      return json({ ok: true, data: { item: item || null } })
    }

    // ── createItem (new item not in catalog) ───────────────────────────────────
    if (body.action === 'createItem') {
      const name = String(body.name || '').trim()
      const barcode = String(body.barcode || '').trim()
      if (!name) return json({ error: 'name-required' }, 400)
      if (!barcode) return json({ error: 'barcode-required' }, 400)

      const orgId = access.activeOrganization?.id || null

      const { data: item, error: insErr } = await supabase
        .from('inventory_items')
        .insert({
          name,
          barcode,
          unit: String(body.unit || 'шт'),
          sale_price: normalizeQty(body.sale_price),
          default_purchase_price: normalizeQty(body.purchase_price),
          organization_id: orgId,
          is_active: true,
        })
        .select('id, name, barcode, unit, sale_price, default_purchase_price')
        .single()

      if (insErr) {
        if (insErr.code === '23505') return json({ error: 'barcode-already-exists' }, 409)
        throw insErr
      }

      return json({ ok: true, data: { item } })
    }

    // ── addStock (receipt-style add to warehouse) ──────────────────────────────
    if (body.action === 'addStock') {
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      const items: Array<{ item_id: string; quantity: number; unit_cost: number }> = (body.items || [])
        .map((i: any) => ({
          item_id: String(i.item_id || '').trim(),
          quantity: normalizeQty(i.quantity),
          unit_cost: normalizeQty(i.unit_cost),
        }))
        .filter((i: any) => i.item_id && i.quantity > 0)

      if (items.length === 0) return json({ error: 'items-required' }, 400)

      const warehouse = await ensureCompanyWarehouse(supabase, companyId)
      const actorUserId = access.staffMember?.id || null

      const result = await postInventoryReceipt(supabase, {
        location_id: warehouse.id,
        received_at: new Date().toISOString(),
        supplier_id: null,
        comment: String(body.comment || '').trim() || 'Добавлено через склад',
        created_by: actorUserId,
        items,
      })

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'inventory-warehouse-stock',
        entityId: warehouse.id,
        action: 'add_stock',
        payload: { company_id: companyId, items_count: items.length },
      })

      return json({ ok: true, data: { receipt: result } })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.POST', message: error?.message })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
