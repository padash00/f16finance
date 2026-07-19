import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { createInventoryRequest } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { notifyInventoryRequestCreated } from '@/lib/server/telegram'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

function canCreateRequest(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

function normalizeQty(v: unknown) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0
}

// PostgREST молча режет ответ до 1000 строк — большие выборки забираем постранично.
const PAGE_SIZE = 1000
async function fetchAllPages<T = any>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

async function ensureCompanyLocation(
  supabase: any,
  companyId: string,
  locationType: 'warehouse' | 'point_display',
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
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

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

    const [warehouseLoc, showcaseLoc] = await Promise.all([
      ensureCompanyLocation(supabase, companyId, 'warehouse'),
      ensureCompanyLocation(supabase, companyId, 'point_display'),
    ])

    // Каталог точки может быть >1000 позиций — постранично, иначе PostgREST молча обрежет остатки.
    const balanceRows = await fetchAllPages((from, to) =>
      supabase
        .from('inventory_balances')
        .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, sale_price, default_purchase_price, low_stock_threshold, category_id, category:category_id(id, name))')
        .in('location_id', [warehouseLoc.id, showcaseLoc.id])
        .order('item_id', { ascending: true })
        .order('location_id', { ascending: true })
        .range(from, to),
    )

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
          warehouse_quantity: 0,
          point_display_quantity: 0,
          updated_at: row.updated_at,
        }
        byItem.set(itemId, bucket)
      }
      if (row.location_id === warehouseLoc.id) bucket.warehouse_quantity = Number(row.quantity) || 0
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
      // Страница витрины показывает только товары, которые есть на витрине
      .filter((b) => b.showcase_quantity > 0)
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
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'action-required' }, 400)

    // ── setShowcase: установить точный остаток витрины (карандашик, как на складе) ──
    if (body.action === 'setShowcase') {
      // Отдельного кода права на витрину нет — правка остатков закрыта тем же
      // store-warehouse.edit, что и карандашик подсобки на складе.
      const capDenied = await requireStaffCapability(access, 'store-warehouse.edit')
      if (capDenied) return capDenied
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      const itemId = String(body.item_id || '').trim()
      if (!itemId) return json({ error: 'item-id-required' }, 400)
      const qty = normalizeQty(body.quantity)
      if (qty < 0) return json({ error: 'quantity-invalid' }, 400)

      const showcaseLoc = await ensureCompanyLocation(supabase, companyId, 'point_display')
      const actorUserId = access.staffMember?.id || null
      const now = new Date().toISOString()

      const { data: beforeRow } = await supabase
        .from('inventory_balances')
        .select('quantity')
        .eq('location_id', showcaseLoc.id)
        .eq('item_id', itemId)
        .maybeSingle()
      const beforeQty = Number((beforeRow as any)?.quantity) || 0

      const { error: upsertErr } = await supabase
        .from('inventory_balances')
        .upsert({ location_id: showcaseLoc.id, item_id: itemId, quantity: qty, updated_at: now }, { onConflict: 'location_id,item_id' })
      if (upsertErr) throw upsertErr

      const delta = qty - beforeQty
      if (Math.abs(delta) > 0.0005) {
        const { error: mErr } = await supabase.from('inventory_movements').insert({
          item_id: itemId,
          movement_type: 'inventory_adjustment',
          quantity: Math.abs(delta),
          from_location_id: delta < 0 ? showcaseLoc.id : null,
          to_location_id: delta > 0 ? showcaseLoc.id : null,
          reference_type: 'showcase_set',
          reference_id: null,
          comment: String(body.comment || '').trim() || 'Установка остатка витрины',
          actor_user_id: actorUserId,
          created_at: now,
        })
        if (mErr) await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/showcase.setShowcase:movement', message: mErr.message })
      }

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'inventory-showcase-alloc',
        entityId: showcaseLoc.id,
        action: 'set_showcase',
        payload: { company_id: companyId, item_id: itemId, quantity: qty },
      })

      return json({ ok: true })
    }

    if (body.action === 'createRequest') {
      const capDenied = await requireStaffCapability(access, 'store-showcase.move')
      if (capDenied) return capDenied
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

          // staff не имеет company_id — скоуп по организации компании (была ошибка 42703).
          const { data: orgRow } = await supabase.from('companies').select('organization_id').eq('id', companyId).maybeSingle()
          let staffQuery = supabase
            .from('staff')
            .select('telegram_chat_id, full_name')
            .in('role', ['owner', 'manager'])
            .not('telegram_chat_id', 'is', null)
          if (orgRow?.organization_id) staffQuery = staffQuery.eq('organization_id', orgRow.organization_id)
          const { data: staffRows } = await staffQuery

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
      const capDenied = await requireStaffCapability(access, 'store-showcase.return_to_warehouse')
      if (capDenied) return capDenied
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

      const [showcaseLoc, warehouseLoc] = await Promise.all([
        ensureCompanyLocation(supabase, companyId, 'point_display'),
        ensureCompanyLocation(supabase, companyId, 'warehouse'),
      ])

      const actorUserId = access.staffMember?.id || null

      // Атомарно: -витрина, +склад, +движение для всех товаров в одной транзакции
      // (SQL-функция). Раньше был цикл из отдельных RPC без транзакции — при сбое
      // посреди операции терялся остаток.
      const { data: returnedCount, error: returnErr } = await supabase.rpc('inventory_return_to_warehouse', {
        p_showcase_location_id: showcaseLoc.id,
        p_warehouse_location_id: warehouseLoc.id,
        p_items: items,
        p_comment: String(body.comment || '').trim() || 'Возврат с витрины на склад',
        p_actor_user_id: actorUserId,
      })

      if (returnErr) {
        const msg = String(returnErr.message || '')
        if (msg.includes('inventory-showcase-insufficient')) {
          // формат: inventory-showcase-insufficient:<item_id>:<showcase>:<requested>
          const [, itemId, showcase, requested] = msg.split(':')
          return json({ error: 'showcase-insufficient', item_id: itemId, showcase: Number(showcase) || 0, requested: Number(requested) || 0 }, 400)
        }
        throw returnErr
      }

      return json({ ok: true, data: { returned: Number(returnedCount) || items.length } })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/showcase.POST', message: error?.message })
    return json({ error: humanizeDbError(error, 'Ошибка') }, 500)
  }
}
