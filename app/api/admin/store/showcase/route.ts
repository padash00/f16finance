import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createInventoryRequest } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { notifyInventoryRequestCreated } from '@/lib/server/telegram'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager', 'other'].includes(access.staffRole)
}

function canCreateRequest(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager', 'other'].includes(access.staffRole)
}

function normalizeQty(v: unknown) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0
}

// ─── GET: showcase balances for a company ────────────────────────────────────

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const companiesQuery = supabase.from('companies').select('id, name, code').eq('show_in_structure', true).order('name')
    if (companyScope.allowedCompanyIds) companiesQuery.in('id', companyScope.allowedCompanyIds)
    const { data: companies } = await companiesQuery

    let companyId = url.searchParams.get('company_id') || null
    if (!companyId) companyId = (companies || [])[0]?.id || null
    if (!companyId) return json({ error: 'company-required' }, 400)

    if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
      if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
    }

    // Fetch catalog and warehouse locations (showcase = catalog - warehouse)
    const [{ data: catalogLoc }, { data: warehouseLoc }] = await Promise.all([
      supabase.from('inventory_locations').select('id, name').eq('company_id', companyId).eq('location_type', 'catalog').maybeSingle(),
      supabase.from('inventory_locations').select('id, name').eq('company_id', companyId).eq('location_type', 'warehouse').maybeSingle(),
    ])

    let balances: any[] = []
    if (catalogLoc?.id) {
      // Fetch catalog and warehouse balances together
      const locationIds = [catalogLoc.id, warehouseLoc?.id].filter(Boolean)
      const { data: allBal, error: balErr } = await supabase
        .from('inventory_balances')
        .select('location_id, item_id, quantity, item:item_id(id, name, barcode, unit, sale_price, low_stock_threshold, category_id, category:category_id(id, name))')
        .in('location_id', locationIds)
      if (balErr) throw balErr

      const catalogMap = new Map<string, any>()
      const warehouseMap = new Map<string, any>()
      ;(allBal || []).forEach((b: any) => {
        if (b.location_id === catalogLoc.id) catalogMap.set(b.item_id, b)
        else if (warehouseLoc?.id && b.location_id === warehouseLoc.id) warehouseMap.set(b.item_id, b)
      })

      balances = Array.from(catalogMap.keys()).map((itemId) => {
        const cat = catalogMap.get(itemId)
        const wh = warehouseMap.get(itemId)
        const catalogQty = Number(cat?.quantity || 0)
        const warehouseQty = Number(wh?.quantity || 0)
        const showcaseQty = Math.max(0, catalogQty - warehouseQty)
        return {
          item_id: itemId,
          item: cat.item,
          quantity: showcaseQty,
          catalog_quantity: catalogQty,
          warehouse_quantity: warehouseQty,
          updated_at: cat.updated_at,
        }
      }).sort((a, b) => b.quantity - a.quantity)
    }

    // Pending requests from this company
    const { data: pendingRequests } = await supabase
      .from('inventory_requests')
      .select('id, status, created_at, comment, items:inventory_request_items(id, item_id, requested_qty, approved_qty, item:item_id(id, name))')
      .eq('requesting_company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(20)

    return json({
      ok: true,
      data: {
        showcase: catalogLoc ? { id: catalogLoc.id, name: 'Витрина' } : null,
        warehouse: warehouseLoc || null,
        companies: companies || [],
        balances,
        warehouseItems: balances.filter((b) => b.warehouse_quantity > 0),
        pendingRequests: pendingRequests || [],
        selectedCompanyId: companyId,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/showcase.GET', message: error?.message })
    return json({ error: error?.message || 'Ошибка загрузки витрины' }, 500)
  }
}

// ─── POST: create request from showcase to warehouse ─────────────────────────

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canCreateRequest(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'action-required' }, 400)

    if (body.action === 'createRequest') {
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      const items: Array<{ item_id: string; requested_qty: number; comment?: string | null }> =
        (body.items || [])
          .map((i: any) => ({
            item_id: String(i.item_id || '').trim(),
            requested_qty: Math.round((normalizeQty(i.requested_qty) + Number.EPSILON) * 1000) / 1000,
            comment: i.comment ? String(i.comment).trim() : null,
          }))
          .filter((i: any) => i.item_id && i.requested_qty > 0)

      if (items.length === 0) return json({ error: 'items-required' }, 400)

      // Source = warehouse, Target = point_display
      // When approved: warehouse decreases → showcase (= catalog - warehouse) auto-increases
      const { data: warehouse, error: whErr } = await supabase
        .from('inventory_locations')
        .select('id')
        .eq('company_id', companyId)
        .eq('location_type', 'warehouse')
        .eq('is_active', true)
        .maybeSingle()
      if (whErr) throw whErr
      if (!warehouse?.id) return json({ error: 'warehouse-not-found' }, 404)

      // Ensure point_display exists (for legacy compatibility)
      let showcaseId: string | null = null
      const { data: pdLoc } = await supabase
        .from('inventory_locations')
        .select('id')
        .eq('company_id', companyId)
        .eq('location_type', 'point_display')
        .maybeSingle()
      if (pdLoc?.id) {
        showcaseId = pdLoc.id
      } else {
        // Create point_display if missing
        const { data: company } = await supabase.from('companies').select('name, code, organization_id').eq('id', companyId).maybeSingle()
        const { data: newPD } = await supabase
          .from('inventory_locations')
          .insert({ company_id: companyId, organization_id: company?.organization_id, name: `Витрина — ${company?.name || companyId}`, location_type: 'point_display', is_active: true })
          .select('id').single()
        showcaseId = newPD?.id ?? warehouse.id
      }

      const actorUserId = access.staffMember?.id || null

      const result = await createInventoryRequest(supabase, {
        source_location_id: warehouse.id,
        target_location_id: showcaseId!,
        requesting_company_id: companyId,
        comment: String(body.comment || '').trim() || null,
        created_by: actorUserId,
        items,
      })

      // ── Telegram notification ──────────────────────────────────────────────
      void (async () => {
        try {
          // Company name
          const { data: company } = await supabase
            .from('companies')
            .select('name')
            .eq('id', companyId)
            .maybeSingle()

          // Item names
          const itemIds = items.map((i) => i.item_id)
          const { data: itemRows } = await supabase
            .from('inventory_items')
            .select('id, name, unit')
            .in('id', itemIds)
          const itemMap: Record<string, { name: string; unit: string }> = {}
          for (const r of itemRows || []) itemMap[r.id] = { name: r.name, unit: r.unit }

          // Staff owners/managers with telegram
          const { data: staffRows } = await supabase
            .from('staff')
            .select('telegram_chat_id, full_name')
            .eq('company_id', companyId)
            .in('role', ['owner', 'manager'])
            .not('telegram_chat_id', 'is', null)

          // Creator name from staff member
          const createdByName = access.staffMember
            ? (access.staffMember as any).full_name || (access.staffMember as any).name || null
            : null

          const chatIds = [
            ...(staffRows || []).map((s: any) => String(s.telegram_chat_id)),
            process.env.TELEGRAM_ADMIN_CHAT_ID,
          ].filter(Boolean) as string[]

          const uniqueChatIds = [...new Set(chatIds)]

          await notifyInventoryRequestCreated({
            companyName: company?.name || companyId,
            createdByName,
            comment: String(body.comment || '').trim() || null,
            items: items.map((i) => ({
              name: itemMap[i.item_id]?.name || i.item_id,
              requested_qty: i.requested_qty,
              unit: itemMap[i.item_id]?.unit || 'шт',
            })),
            chatIds: uniqueChatIds,
          })
        } catch { /* не ломать основной сценарий */ }
      })()

      return json({ ok: true, data: result })
    }

    // ── returnToWarehouse (move items back from showcase to warehouse) ────────
    if (body.action === 'returnToWarehouse') {
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      type ReturnItem = { item_id: string; quantity: number }
      const items: ReturnItem[] = (body.items || [])
        .map((i: any) => ({ item_id: String(i.item_id || '').trim(), quantity: normalizeQty(i.quantity) }))
        .filter((i: ReturnItem) => i.item_id && i.quantity > 0)

      if (items.length === 0) return json({ error: 'items-required' }, 400)

      // In new catalog model: showcase = catalog - warehouse (virtual)
      // "Return to warehouse" = increase warehouse_balance only (showcase auto-decreases)
      const { data: warehouse, error: whErr } = await supabase
        .from('inventory_locations')
        .select('id')
        .eq('company_id', companyId)
        .eq('location_type', 'warehouse')
        .maybeSingle()
      if (whErr) throw whErr
      if (!warehouse?.id) return json({ error: 'warehouse-not-found' }, 404)

      const actorUserId = access.staffMember?.id || null
      const now = new Date().toISOString()

      for (const item of items) {
        const { data: whBal } = await supabase
          .from('inventory_balances')
          .select('quantity')
          .eq('location_id', warehouse.id)
          .eq('item_id', item.item_id)
          .maybeSingle()

        const whQty = Number(whBal?.quantity || 0) + item.quantity
        await supabase
          .from('inventory_balances')
          .upsert({ location_id: warehouse.id, item_id: item.item_id, quantity: whQty, updated_at: now }, { onConflict: 'location_id,item_id' })

        await supabase.from('inventory_movements').insert({
          item_id: item.item_id,
          to_location_id: warehouse.id,
          quantity: item.quantity,
          movement_type: 'transfer',
          reference_type: 'return_to_warehouse',
          comment: String(body.comment || '').trim() || 'Возврат на склад (витрина → склад)',
          created_by: actorUserId,
          created_at: now,
        })
      }

      return json({ ok: true, data: { returned: items.length } })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/showcase.POST', message: error?.message })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
