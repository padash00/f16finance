import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
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

async function ensureCompanyLocation(
  supabase: any,
  companyId: string,
  locationType: 'warehouse' | 'point_display' | 'catalog_total',
) {
  const { data: existing } = await supabase
    .from('inventory_locations')
    .select('id, name, code, location_type, is_active')
    .eq('company_id', companyId)
    .eq('location_type', locationType)
    .maybeSingle()
  if (existing?.id) return existing

  const { data: company } = await supabase
    .from('companies')
    .select('id, name, code, organization_id')
    .eq('id', companyId)
    .maybeSingle()
  if (!company?.id) throw new Error('company-not-found')

  const prefix = locationType === 'warehouse' ? 'WH' : locationType === 'point_display' ? 'PD' : 'CT'
  const namePrefix = locationType === 'warehouse' ? 'Склад' : locationType === 'point_display' ? 'Витрина' : 'Каталог'
  const { data: created, error: insErr } = await supabase
    .from('inventory_locations')
    .insert({
      company_id: companyId,
      organization_id: company.organization_id,
      name: `${namePrefix} — ${company.name}`,
      code: company.code ? `${prefix}-${company.code}` : null,
      location_type: locationType,
      is_active: true,
    })
    .select('id, name, code, location_type, is_active')
    .single()
  if (insErr) throw insErr
  return created
}

// ─── GET: showcase from physical point_display ────────────────────────────────

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

    // Только точки с включённым магазином (активная локация point_display)
    const { data: enabledLocs, error: enabledErr } = await supabase
      .from('inventory_locations')
      .select('company_id')
      .eq('location_type', 'point_display')
      .eq('is_active', true)
      .not('company_id', 'is', null)
    if (enabledErr) throw enabledErr
    const storeEnabledCompanyIds = [...new Set((enabledLocs || []).map((r: any) => String(r.company_id)))]

    if (storeEnabledCompanyIds.length === 0) {
      return json({
        ok: true,
        data: {
          showcase: null,
          warehouse: null,
          companies: [],
          balances: [],
          warehouseItems: [],
          pendingRequests: [],
          selectedCompanyId: null,
        },
      })
    }

    const companiesQuery = supabase
      .from('companies')
      .select('id, name, code')
      .eq('show_in_structure', true)
      .in('id', storeEnabledCompanyIds)
      .order('name')
    if (companyScope.allowedCompanyIds) companiesQuery.in('id', companyScope.allowedCompanyIds)
    const { data: companies } = await companiesQuery

    let companyId = url.searchParams.get('company_id') || null
    if (!companyId) companyId = (companies || [])[0]?.id || null
    if (!companyId) {
      return json({
        ok: true,
        data: {
          showcase: null,
          warehouse: null,
          companies: companies || [],
          balances: [],
          warehouseItems: [],
          pendingRequests: [],
          selectedCompanyId: null,
        },
      })
    }

    if (!storeEnabledCompanyIds.includes(companyId)) {
      return json({ error: 'store-not-enabled-for-company' }, 400)
    }

    if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
      if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
    }

    const [warehouseLoc, showcaseLoc, catalogLoc] = await Promise.all([
      ensureCompanyLocation(supabase, companyId, 'warehouse'),
      ensureCompanyLocation(supabase, companyId, 'point_display'),
      ensureCompanyLocation(supabase, companyId, 'catalog_total'),
    ])

    const { data: balanceRows, error: balErr } = await supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, sale_price, low_stock_threshold, category_id, category:category_id(id, name))')
      .in('location_id', [catalogLoc.id, warehouseLoc.id, showcaseLoc.id])
    if (balErr) throw balErr

    // v2: showcase читается напрямую из point_display.
    // Старая формула catalog - warehouse оставлена в полях для совместимости с UI,
    // которые могут показывать catalog/warehouse отдельно.
    const byItem = new Map<string, any>()
    for (const row of balanceRows || []) {
      const itemId = row.item_id
      if (!itemId) continue
      let bucket = byItem.get(itemId)
      if (!bucket) {
        bucket = {
          item_id: itemId,
          item: row.item,
          catalog_quantity: 0,
          warehouse_quantity: 0,
          point_display_quantity: 0,
          updated_at: row.updated_at,
        }
        byItem.set(itemId, bucket)
      }
      if (row.location_id === catalogLoc.id) bucket.catalog_quantity = Number(row.quantity) || 0
      else if (row.location_id === warehouseLoc.id) bucket.warehouse_quantity = Number(row.quantity) || 0
      else if (row.location_id === showcaseLoc.id) bucket.point_display_quantity = Number(row.quantity) || 0
      if (row.updated_at > bucket.updated_at) bucket.updated_at = row.updated_at
    }

    const balances = Array.from(byItem.values())
      .map((b) => {
        // v2: читаем напрямую из point_display
        const showcase = Number(b.point_display_quantity || 0)
        return {
          ...b,
          showcase_quantity: showcase,
          quantity: showcase, // back-compat: UI reads b.quantity as showcase
        }
      })
      .filter((b) => b.showcase_quantity > 0 || b.warehouse_quantity > 0)
      .sort((a, b) => b.showcase_quantity - a.showcase_quantity)

    // Items available in warehouse for request dropdown
    const warehouseItemsList = Array.from(byItem.values())
      .filter((b) => b.warehouse_quantity > 0)
      .map((b) => ({
        item_id: b.item_id,
        item: b.item,
        quantity: b.warehouse_quantity,
      }))

    const { data: pendingRequests } = await supabase
      .from('inventory_requests')
      .select('id, status, created_at, comment, items:inventory_request_items(id, item_id, requested_qty, approved_qty, item:item_id(id, name))')
      .eq('requesting_company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(20)

    return json({
      ok: true,
      data: {
        showcase: showcaseLoc,
        warehouse: warehouseLoc,
        companies: companies || [],
        balances,
        warehouseItems: warehouseItemsList,
        pendingRequests: pendingRequests || [],
        selectedCompanyId: companyId,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/showcase.GET', message: error?.message })
    return json({ error: humanizeDbError(error, 'Ошибка загрузки витрины') }, 500)
  }
}

// ─── POST: create request / return to warehouse ───────────────────────────────

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
            requested_qty: normalizeQty(i.requested_qty),
            comment: i.comment ? String(i.comment).trim() : null,
          }))
          .filter((i: any) => i.item_id && i.requested_qty > 0)

      if (items.length === 0) return json({ error: 'items-required' }, 400)

      // Source = warehouse, target = point_display.
      const [warehouseLoc, showcaseLoc] = await Promise.all([
        ensureCompanyLocation(supabase, companyId, 'warehouse'),
        ensureCompanyLocation(supabase, companyId, 'point_display'),
      ])

      const actorUserId = access.staffMember?.id || null

      const result = await createInventoryRequest(supabase, {
        source_location_id: warehouseLoc.id,
        target_location_id: showcaseLoc.id,
        requesting_company_id: companyId,
        comment: String(body.comment || '').trim() || null,
        created_by: actorUserId,
        items,
      })

      void (async () => {
        try {
          const { data: company } = await supabase
            .from('companies')
            .select('name')
            .eq('id', companyId)
            .maybeSingle()

          const itemIds = items.map((i) => i.item_id)
          const { data: itemRows } = await supabase
            .from('inventory_items')
            .select('id, name, unit')
            .in('id', itemIds)
          const itemMap: Record<string, { name: string; unit: string }> = {}
          for (const r of itemRows || []) itemMap[r.id] = { name: r.name, unit: r.unit }

          const { data: staffRows } = await supabase
            .from('staff')
            .select('telegram_chat_id, full_name')
            .eq('company_id', companyId)
            .in('role', ['owner', 'manager'])
            .not('telegram_chat_id', 'is', null)

          const createdByName = access.staffMember
            ? (access.staffMember as any).full_name || (access.staffMember as any).name || null
            : null

          const chatIds = [
            ...(staffRows || []).map((s: any) => String(s.telegram_chat_id)),
            process.env.TELEGRAM_ADMIN_CHAT_ID,
          ].filter(Boolean) as string[]

          const uniqueChatIds = [...new Set(chatIds)]

          await notifyInventoryRequestCreated({
            requestId: result,
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

    // ── returnToWarehouse: move stock showcase -> warehouse ────────────────────
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

      const [showcaseLoc, warehouseLoc, catalogLoc] = await Promise.all([
        ensureCompanyLocation(supabase, companyId, 'point_display'),
        ensureCompanyLocation(supabase, companyId, 'warehouse'),
        ensureCompanyLocation(supabase, companyId, 'catalog_total'),
      ])

      const actorUserId = access.staffMember?.id || null
      const now = new Date().toISOString()

      for (const item of items) {
        // catalog_total model: showcase = max(0, catalog - warehouse). Return shifts stock from витрина → склад by incrementing warehouse only (catalog unchanged).
        const { data: cBal } = await supabase
          .from('inventory_balances')
          .select('quantity')
          .eq('location_id', catalogLoc.id)
          .eq('item_id', item.item_id)
          .maybeSingle()
        const { data: wBal } = await supabase
          .from('inventory_balances')
          .select('quantity')
          .eq('location_id', warehouseLoc.id)
          .eq('item_id', item.item_id)
          .maybeSingle()
        const catalogQty = Number(cBal?.quantity || 0)
        const warehouseQty = Number(wBal?.quantity || 0)
        const showcaseQty = Math.max(0, catalogQty - warehouseQty)
        if (item.quantity > showcaseQty) {
          return json({ error: 'showcase-insufficient', item_id: item.item_id, showcase: showcaseQty, requested: item.quantity }, 400)
        }

        const newWarehouse = warehouseQty + item.quantity
        await supabase
          .from('inventory_balances')
          .upsert({ location_id: warehouseLoc.id, item_id: item.item_id, quantity: newWarehouse, updated_at: now }, { onConflict: 'location_id,item_id' })

        await supabase.from('inventory_movements').insert({
          item_id: item.item_id,
          from_location_id: showcaseLoc.id,
          to_location_id: warehouseLoc.id,
          quantity: item.quantity,
          movement_type: 'transfer',
          reference_type: 'return_to_warehouse',
          comment: String(body.comment || '').trim() || 'Возврат с витрины на склад',
          created_by: actorUserId,
          created_at: now,
        })
      }

      return json({ ok: true, data: { returned: items.length } })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/showcase.POST', message: error?.message })
    return json({ error: humanizeDbError(error, 'Ошибка') }, 500)
  }
}
