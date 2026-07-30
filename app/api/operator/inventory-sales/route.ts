import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { createPointInventorySale } from '@/lib/server/repositories/inventory'
import { requireOperator } from '@/lib/server/operator-context'
import { resolveCompanyOrganizationId } from '@/lib/server/point-devices'
import { buildSaleReceiptUrl } from '@/lib/server/sale-receipt'
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
 * Веб-касса оператора — каталог витрины и проведение продажи.
 *
 * Тонкий клиент над тем же контуром, что и десктоп (`/api/point/inventory-sales`):
 * та же смена `point_shifts`, те же `point_sales`, то же ядро расчёта. Разница —
 * только транспорт: здесь Supabase-сессия оператора (`requireOperator`) вместо
 * device-токена. Продажа всегда падает в текущую открытую смену точки; нет
 * открытой смены → 409 (продавать без смены нельзя).
 */

type CreateSaleBody = {
  action?: 'createSale'
  payload: {
    sale_date: string
    shift: 'day' | 'night'
    payment_method: 'cash' | 'kaspi' | 'mixed'
    cash_amount?: number | null
    kaspi_amount?: number | null
    kaspi_before_midnight_amount?: number | null
    kaspi_after_midnight_amount?: number | null
    customer_id?: string | null
    loyalty_points_spent?: number | null
    discount_amount?: number | null
    loyalty_discount_amount?: number | null
    comment?: string | null
    local_ref?: string | null
    items: Array<{
      item_id?: string | null
      universal_name?: string | null
      quantity: number
      unit_price?: number
      comment?: string | null
    }>
  }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const ctx = await requireOperator(request)
    if ('response' in ctx) return ctx.response
    const { supabase, companyId, operatorId } = ctx

    const [location, stock, company] = await Promise.all([
      resolvePointSaleLocation(supabase, companyId),
      resolveStockLocations(supabase, companyId),
      supabase.from('companies').select('id, name, code, organization_id, store_enabled').eq('id', companyId).maybeSingle(),
    ])
    // Точка-магазин → каталог только своей точки; обычная точка → весь орг-каталог.
    const catalogOrgId = (company as any)?.data?.organization_id || (await resolveCompanyOrganizationId(supabase, companyId))
    const isStore = (company as any)?.data?.store_enabled === true

    const [items, showcaseMap, { data: sales, error: salesError }, { data: loyaltyConfig }] =
      await Promise.all([
        fetchAllPages((from, to) => {
          let q = supabase
            .from('inventory_items')
            .select('id, name, barcode, unit, sale_price, item_type, image_url, category:category_id(id, name)')
            .eq('is_active', true)
            .neq('item_type', 'consumable')
          if (isStore) q = q.eq('company_id', companyId)
          else q = q.eq('organization_id', catalogOrgId)
          return q.order('name', { ascending: true }).order('id').range(from, to)
        }),
        fetchShowcaseBalances({
          supabase,
          catalogId: stock.catalogId,
          warehouseId: stock.warehouseId,
          showcaseId: stock.showcaseId,
        }),
        supabase
          .from('point_sales')
          .select(
            'id, sale_date, shift, payment_method, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount, total_amount, comment, sold_at, items:point_sale_items(id, universal_name, quantity, unit_price, total_price, item:item_id(id, name, barcode))',
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
          name: (company as any)?.data?.name || (company as any)?.name || 'Точка',
          code: (company as any)?.data?.code ?? (company as any)?.code ?? null,
        },
        location,
        items: (items || []).map((item: any) => ({
          ...item,
          display_qty: showcaseMap.get(item.id) || 0,
        })),
        sales: sales || [],
        loyalty_config: (loyaltyConfig as any) || null,
        operator_id: operatorId,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'operator-inventory-sales:get',
      message: error?.message || 'Operator inventory sales GET error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось загрузить продажи точки') }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOperator(request)
    if ('response' in ctx) return ctx.response
    const { supabase, companyId, operatorId } = ctx

    const body = (await request.json().catch(() => null)) as CreateSaleBody | null
    if (!body || (body.action && body.action !== 'createSale')) {
      return json({ error: 'invalid-action' }, 400)
    }

    const saleDate = String(body.payload?.sale_date || '').trim()
    const shift = body.payload?.shift
    if (!saleDate) return json({ error: 'sale-date-required' }, 400)
    if (shift !== 'day' && shift !== 'night') return json({ error: 'sale-shift-invalid' }, 400)

    const paymentMethod = body.payload?.payment_method
    if (!['cash', 'kaspi', 'mixed'].includes(String(paymentMethod || ''))) {
      return json({ error: 'sale-payment-method-invalid' }, 400)
    }

    const requestedItems = Array.isArray(body.payload?.items)
      ? body.payload.items
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

    const cashAmount = normalizeMoney(body.payload?.cash_amount)
    const kaspiAmount = normalizeMoney(body.payload?.kaspi_amount)
    const kaspiBeforeMidnightAmount = normalizeMoney(body.payload?.kaspi_before_midnight_amount)
    const kaspiAfterMidnightAmount = normalizeMoney(body.payload?.kaspi_after_midnight_amount)
    const paymentTotal = normalizeMoney(cashAmount + kaspiAmount)
    const customerId = String(body.payload?.customer_id || '').trim() || null
    const loyaltyPointsSpent = normalizePoints(body.payload?.loyalty_points_spent)
    const discountAmount = normalizeMoney(body.payload?.discount_amount)
    const loyaltyDiscountAmount = normalizeMoney(body.payload?.loyalty_discount_amount)

    if (paymentTotal <= 0) return json({ error: 'sale-payment-total-invalid' }, 400)
    if (Math.abs(kaspiAmount - (kaspiBeforeMidnightAmount + kaspiAfterMidnightAmount)) > 0.01) {
      return json({ error: 'sale-kaspi-split-mismatch' }, 400)
    }

    // Гейт смены: без открытой смены на точке продавать нельзя.
    const shiftIdAttach = await requireCurrentOpenShiftId(supabase, companyId)
    if (!shiftIdAttach) {
      return json(
        { error: 'point-shift-no-open', message: 'Сначала откройте смену и укажите старт кассы.' },
        409,
      )
    }

    const location = await resolvePointSaleLocation(supabase, companyId)
    const stock = await resolveStockLocations(supabase, companyId)
    const itemIds = [...new Set(requestedItems.map((item) => item.item_id).filter((id): id is string => !!id))]

    const [{ data: dbItems, error: itemError }, showcaseBalances, customerContext] = await Promise.all([
      resolveCompanyOrganizationId(supabase, companyId).then((orgId) =>
        supabase
          .from('inventory_items')
          .select('id, name, sale_price, is_active, item_type')
          .eq('organization_id', orgId)
          .in('id', itemIds),
      ),
      fetchShowcaseBalances({
        supabase,
        catalogId: stock.catalogId,
        warehouseId: stock.warehouseId,
        showcaseId: stock.showcaseId,
        itemIds,
      }),
      resolveCustomerSaleContext({ supabase, companyId, customerId, loyaltyPointsSpent }),
    ])

    if (itemError) throw itemError

    const items = buildAuthoritativeSaleLines({
      requestedItems,
      dbItems: dbItems || [],
      showcaseBalances,
      paymentTotal,
    })

    // Идемпотентность: если продажа с этим local_ref уже создавалась — вернём её.
    const localRef = body.payload?.local_ref?.trim() || null
    if (localRef) {
      const { data: existing } = await supabase
        .from('point_sales')
        .select('id, total_amount')
        .eq('company_id', companyId)
        .eq('local_ref', localRef)
        .maybeSingle()
      if (existing) {
        return json({ ok: true, data: { sale_id: existing.id, total_amount: existing.total_amount, idempotent: true } })
      }
    }

    const sale = await createPointInventorySale(supabase, {
      company_id: companyId,
      location_id: location.id,
      point_device_id: null,
      operator_id: operatorId,
      sale_date: saleDate,
      shift,
      payment_method: paymentMethod,
      cash_amount: cashAmount,
      kaspi_amount: kaspiAmount,
      kaspi_before_midnight_amount: kaspiBeforeMidnightAmount,
      kaspi_after_midnight_amount: kaspiAfterMidnightAmount,
      comment: body.payload?.comment?.trim() || null,
      source: 'operator-web',
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
    } catch (customerError: any) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'operator-inventory-sales:customer-sync',
        message: customerError?.message || 'Operator inventory sale customer sync error',
      })
    }

    if (sale?.sale_id) {
      await supabase.from('point_sales').update({ shift_id: shiftIdAttach }).eq('id', sale.sale_id)
    }

    const { data: savedSale } = await supabase
      .from('point_sales')
      .select('id, sold_at')
      .eq('id', String(sale?.sale_id || ''))
      .maybeSingle()

    await writeAuditLog(supabase, {
      entityType: 'point-sale',
      entityId: String(sale?.sale_id || ''),
      action: 'create',
      payload: {
        company_id: companyId,
        operator_id: operatorId,
        location_id: location.id,
        shift,
        sale_date: saleDate,
        payment_method: paymentMethod,
        total_amount: sale?.total_amount || 0,
        item_count: items.length,
        customer_id: loyaltyResult?.customerId || null,
        source: 'operator-web',
      },
    })

    const soldItemIds = items.map((i) => i.item_id).filter((id): id is string => !!id)
    if (stock.showcaseId && soldItemIds.length > 0) {
      checkAndNotifyLowStock(soldItemIds, stock.showcaseId).catch(() => null)
    }

    const receiptUrl = sale?.sale_id
      ? await buildSaleReceiptUrl(supabase, companyId, String(sale.sale_id)).catch(() => null)
      : null

    return json({
      ok: true,
      data: {
        sale_id: sale?.sale_id || null,
        total_amount: sale?.total_amount || 0,
        sold_at: savedSale?.sold_at || null,
        receipt_url: receiptUrl,
        customer_id: loyaltyResult?.customerId || null,
        loyalty_points_earned: loyaltyResult?.pointsEarned || 0,
        loyalty_points_spent: loyaltyResult?.pointsSpent || 0,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'operator-inventory-sales:post',
      message: error?.message || 'Operator inventory sales POST error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось провести продажу') }, 500)
  }
}
