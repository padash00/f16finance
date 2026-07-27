import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { requireCapability } from '@/lib/server/capabilities'
import { createPointInventorySale } from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveCompanyOrganizationId } from '@/lib/server/point-devices'
import { requireCurrentOpenShiftId } from '@/lib/server/point-shifts'
import { checkAndNotifyLowStock } from '@/lib/server/low-stock-notifier'
import {
  applyCustomerSaleEffects,
  buildAuthoritativeSaleLines,
  fetchAllPages,
  fetchShowcaseBalances,
  normalizeMoney,
  normalizePoints,
  normalizeQty,
  resolveCustomerSaleContext,
  resolvePointSaleLocation,
  resolveStockLocations,
} from '@/lib/server/point-sales-core'

/**
 * Веб-касса ВЛАДЕЛЬЦА (Q6) — каталог витрины и продажа по выбранной точке.
 *
 * Тот же контур, что у оператора (`/api/operator/inventory-sales`) и десктопа:
 * пишет в point_sales текущей открытой смены точки. Отличия: точку выбирает
 * владелец (company_id, проверяется на принадлежность его орг), продажа идёт
 * «от владельца» (operator_id = null, source='owner-web'). Без открытой смены — 409.
 */

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function assertCompanyInScope(access: any, companyId: string) {
  await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    requestedCompanyId: companyId,
    isSuperAdmin: access.isSuperAdmin,
  })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'pos.view')
    if (denied) return denied
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const companyId = String(new URL(request.url).searchParams.get('company_id') || '').trim()
    if (!companyId) return json({ error: 'company-required' }, 400)
    try {
      await assertCompanyInScope(access, companyId)
    } catch {
      return json({ error: 'company-out-of-scope' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const [location, stock, catalogOrgId, company] = await Promise.all([
      resolvePointSaleLocation(supabase, companyId),
      resolveStockLocations(supabase, companyId),
      resolveCompanyOrganizationId(supabase, companyId),
      supabase.from('companies').select('id, name, code').eq('id', companyId).maybeSingle(),
    ])

    const [items, showcaseMap, { data: sales, error: salesError }, { data: loyaltyConfig }] =
      await Promise.all([
        fetchAllPages((from, to) =>
          supabase
            .from('inventory_items')
            .select('id, name, barcode, unit, sale_price, item_type, image_url, category:category_id(id, name)')
            .eq('organization_id', catalogOrgId)
            .eq('is_active', true)
            .neq('item_type', 'consumable')
            .order('name', { ascending: true })
            .order('id')
            .range(from, to),
        ),
        fetchShowcaseBalances({
          supabase,
          catalogId: stock.catalogId,
          warehouseId: stock.warehouseId,
          showcaseId: stock.showcaseId,
        }),
        supabase
          .from('point_sales')
          .select(
            'id, sale_date, shift, payment_method, cash_amount, kaspi_amount, total_amount, comment, sold_at, items:point_sale_items(id, universal_name, quantity, unit_price, total_price, item:item_id(id, name, barcode))',
          )
          .eq('location_id', location.id)
          .order('sold_at', { ascending: false })
          .limit(20),
        supabase.from('loyalty_config').select('*').eq('company_id', companyId).maybeSingle(),
      ])

    if (salesError) throw salesError

    return json({
      ok: true,
      data: {
        company: {
          id: companyId,
          name: (company as any)?.data?.name || 'Точка',
          code: (company as any)?.data?.code ?? null,
        },
        location,
        items: (items || []).map((item: any) => ({ ...item, display_qty: showcaseMap.get(item.id) || 0 })),
        sales: sales || [],
        loyalty_config: (loyaltyConfig as any) || null,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'admin-pos-inventory-sales:get', message: error?.message || 'error' })
    return json({ error: humanizeDbError(error, 'Не удалось загрузить каталог точки') }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const body = (await request.json().catch(() => null)) as any
    if (!body || (body.action && body.action !== 'createSale')) return json({ error: 'invalid-action' }, 400)

    const companyId = String(body?.payload?.company_id || body?.company_id || '').trim()
    if (!companyId) return json({ error: 'company-required' }, 400)
    try {
      await assertCompanyInScope(access, companyId)
    } catch {
      return json({ error: 'company-out-of-scope' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const p = body.payload || {}

    const saleDate = String(p.sale_date || '').trim()
    const shift = p.shift
    if (!saleDate) return json({ error: 'sale-date-required' }, 400)
    if (shift !== 'day' && shift !== 'night') return json({ error: 'sale-shift-invalid' }, 400)
    if (!['cash', 'kaspi', 'mixed'].includes(String(p.payment_method || ''))) {
      return json({ error: 'sale-payment-method-invalid' }, 400)
    }

    const requestedItems = Array.isArray(p.items)
      ? p.items
          .map((item: any) => ({
            item_id: String(item.item_id || '').trim() || null,
            universal_name: String(item.universal_name || '').trim() || null,
            unit_price: normalizeMoney(item.unit_price || 0),
            quantity: normalizeQty(item.quantity),
            comment: item.comment?.trim() || null,
          }))
          .filter((item: any) => (item.item_id || item.universal_name) && item.quantity > 0)
      : []
    if (requestedItems.length === 0) return json({ error: 'point-sale-items-required' }, 400)

    const cashAmount = normalizeMoney(p.cash_amount)
    const kaspiAmount = normalizeMoney(p.kaspi_amount)
    const kaspiBefore = normalizeMoney(p.kaspi_before_midnight_amount)
    const kaspiAfter = normalizeMoney(p.kaspi_after_midnight_amount)
    const paymentTotal = normalizeMoney(cashAmount + kaspiAmount)
    const customerId = String(p.customer_id || '').trim() || null
    const loyaltyPointsSpent = normalizePoints(p.loyalty_points_spent)
    const discountAmount = normalizeMoney(p.discount_amount)
    const loyaltyDiscountAmount = normalizeMoney(p.loyalty_discount_amount)

    if (paymentTotal <= 0) return json({ error: 'sale-payment-total-invalid' }, 400)
    if (Math.abs(kaspiAmount - (kaspiBefore + kaspiAfter)) > 0.01) return json({ error: 'sale-kaspi-split-mismatch' }, 400)

    const shiftIdAttach = await requireCurrentOpenShiftId(supabase, companyId)
    if (!shiftIdAttach) {
      return json({ error: 'point-shift-no-open', message: 'Сначала откройте смену на этой точке.' }, 409)
    }

    const location = await resolvePointSaleLocation(supabase, companyId)
    const stock = await resolveStockLocations(supabase, companyId)
    const itemIds: string[] = [
      ...new Set((requestedItems as any[]).map((i) => String(i.item_id || '')).filter((id) => !!id)),
    ]

    const [{ data: dbItems, error: itemError }, showcaseBalances, customerContext] = await Promise.all([
      resolveCompanyOrganizationId(supabase, companyId).then((orgId) =>
        supabase.from('inventory_items').select('id, name, sale_price, is_active, item_type').eq('organization_id', orgId).in('id', itemIds),
      ),
      fetchShowcaseBalances({ supabase, catalogId: stock.catalogId, warehouseId: stock.warehouseId, showcaseId: stock.showcaseId, itemIds }),
      resolveCustomerSaleContext({ supabase, companyId, customerId, loyaltyPointsSpent }),
    ])
    if (itemError) throw itemError

    const items = buildAuthoritativeSaleLines({ requestedItems, dbItems: dbItems || [], showcaseBalances, paymentTotal })

    const localRef = p.local_ref?.trim() || null
    if (localRef) {
      const { data: existing } = await supabase
        .from('point_sales')
        .select('id, total_amount')
        .eq('company_id', companyId)
        .eq('local_ref', localRef)
        .maybeSingle()
      if (existing) return json({ ok: true, data: { sale_id: existing.id, total_amount: existing.total_amount, idempotent: true } })
    }

    const sale = await createPointInventorySale(supabase, {
      company_id: companyId,
      location_id: location.id,
      point_device_id: null,
      operator_id: null, // владелец
      sale_date: saleDate,
      shift,
      payment_method: p.payment_method,
      cash_amount: cashAmount,
      kaspi_amount: kaspiAmount,
      kaspi_before_midnight_amount: kaspiBefore,
      kaspi_after_midnight_amount: kaspiAfter,
      comment: p.comment?.trim() || 'Владелец / администрация',
      source: 'owner-web',
      local_ref: localRef,
      items,
    })

    let loyaltyResult: { pointsEarned: number; pointsSpent: number; customerId: string | null } | null = null
    try {
      loyaltyResult = await applyCustomerSaleEffects({
        supabase,
        saleId: String(sale?.sale_id || ''),
        companyId,
        customer: customerContext.customer,
        loyaltyConfig: customerContext.loyaltyConfig,
        loyaltyPointsSpent,
        totalAmount: paymentTotal,
        discountAmount,
        loyaltyDiscountAmount,
      })
    } catch (e: any) {
      await writeSystemErrorLogSafe({ scope: 'server', area: 'admin-pos-inventory-sales:customer-sync', message: e?.message || 'error' })
    }

    if (sale?.sale_id) {
      await supabase.from('point_sales').update({ shift_id: shiftIdAttach }).eq('id', sale.sale_id)
    }

    const { data: savedSale } = await supabase.from('point_sales').select('id, sold_at').eq('id', String(sale?.sale_id || '')).maybeSingle()

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'point-sale',
      entityId: String(sale?.sale_id || ''),
      action: 'create',
      payload: { company_id: companyId, operator_id: null, location_id: location.id, shift, sale_date: saleDate, payment_method: p.payment_method, total_amount: sale?.total_amount || 0, item_count: items.length, source: 'owner-web' },
    })

    const soldItemIds = items.map((i) => i.item_id).filter((id): id is string => !!id)
    if (stock.showcaseId && soldItemIds.length > 0) checkAndNotifyLowStock(soldItemIds, stock.showcaseId).catch(() => null)

    return json({
      ok: true,
      data: {
        sale_id: sale?.sale_id || null,
        total_amount: sale?.total_amount || 0,
        sold_at: savedSale?.sold_at || null,
        customer_id: loyaltyResult?.customerId || null,
        loyalty_points_earned: loyaltyResult?.pointsEarned || 0,
        loyalty_points_spent: loyaltyResult?.pointsSpent || 0,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'admin-pos-inventory-sales:post', message: error?.message || 'error' })
    return json({ error: humanizeDbError(error, 'Не удалось провести продажу') }, 500)
  }
}
