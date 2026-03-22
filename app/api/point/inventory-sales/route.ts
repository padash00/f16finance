import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createPointInventorySale } from '@/lib/server/repositories/inventory'
import { requirePointDevice } from '@/lib/server/point-devices'

type SaleBody = {
  action: 'createSale'
  payload: {
    sale_date: string
    shift: 'day' | 'night'
    payment_method: 'cash' | 'kaspi' | 'mixed'
    cash_amount?: number | null
    kaspi_amount?: number | null
    kaspi_before_midnight_amount?: number | null
    kaspi_after_midnight_amount?: number | null
    comment?: string | null
    local_ref?: string | null
    items: Array<{
      item_id: string
      quantity: number
      unit_price: number
      comment?: string | null
    }>
  }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canUseInventorySales(pointMode: string | null | undefined) {
  const normalized = String(pointMode || '').trim().toLowerCase()
  return new Set(['cash-desk', 'universal', 'debts']).has(normalized)
}

function normalizeMoney(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function normalizeQty(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

async function resolvePointSaleLocation(supabase: any, companyId: string) {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, name, code, location_type')
    .eq('company_id', companyId)
    .eq('location_type', 'point_display')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('inventory-sale-location-not-found')
  return data
}

async function resolveActor(params: {
  request: Request
  supabase: any
  companyId: string
}) {
  const operatorId = params.request.headers.get('x-point-operator-id')?.trim() || null
  const operatorAuthId = params.request.headers.get('x-point-operator-auth-id')?.trim() || null
  if (!operatorId || !operatorAuthId) return { operatorId: null, actorUserId: null }

  const { data, error } = await params.supabase
    .from('operator_company_assignments')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) return { operatorId: null, actorUserId: null }
  return { operatorId, actorUserId: operatorAuthId }
}

async function fetchShiftSummary(params: {
  supabase: any
  locationId: string
  saleDate: string
  shift: 'day' | 'night'
}) {
  const [
    { data: sales, error: salesError },
    { data: saleItems, error: saleItemsError },
    { data: returns, error: returnsError },
    { data: returnItems, error: returnItemsError },
  ] = await Promise.all([
    params.supabase
      .from('point_sales')
      .select('id, total_amount, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount')
      .eq('location_id', params.locationId)
      .eq('sale_date', params.saleDate)
      .eq('shift', params.shift),
    params.supabase
      .from('point_sale_items')
      .select('sale_id, quantity')
      .in(
        'sale_id',
        (
          await params.supabase
            .from('point_sales')
            .select('id')
            .eq('location_id', params.locationId)
            .eq('sale_date', params.saleDate)
            .eq('shift', params.shift)
        ).data?.map((row: any) => row.id) || ['00000000-0000-0000-0000-000000000000'],
      ),
    params.supabase
      .from('point_returns')
      .select('id, total_amount, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount')
      .eq('location_id', params.locationId)
      .eq('return_date', params.saleDate)
      .eq('shift', params.shift),
    params.supabase
      .from('point_return_items')
      .select('return_id, quantity')
      .in(
        'return_id',
        (
          await params.supabase
            .from('point_returns')
            .select('id')
            .eq('location_id', params.locationId)
            .eq('return_date', params.saleDate)
            .eq('shift', params.shift)
        ).data?.map((row: any) => row.id) || ['00000000-0000-0000-0000-000000000000'],
      ),
  ])

  if (salesError) throw salesError
  if (saleItemsError) throw saleItemsError
  if (returnsError) throw returnsError
  if (returnItemsError) throw returnItemsError

  const list = sales || []
  const items = saleItems || []
  const returnsList = returns || []
  const returnRows = returnItems || []

  const saleCashAmount = list.reduce((sum: number, row: any) => sum + normalizeMoney(row.cash_amount), 0)
  const saleKaspiAmount = list.reduce((sum: number, row: any) => sum + normalizeMoney(row.kaspi_amount), 0)
  const saleKaspiBeforeMidnightAmount = list.reduce(
    (sum: number, row: any) => sum + normalizeMoney(row.kaspi_before_midnight_amount),
    0,
  )
  const saleKaspiAfterMidnightAmount = list.reduce(
    (sum: number, row: any) => sum + normalizeMoney(row.kaspi_after_midnight_amount),
    0,
  )
  const returnCashAmount = returnsList.reduce((sum: number, row: any) => sum + normalizeMoney(row.cash_amount), 0)
  const returnKaspiAmount = returnsList.reduce((sum: number, row: any) => sum + normalizeMoney(row.kaspi_amount), 0)
  const returnKaspiBeforeMidnightAmount = returnsList.reduce(
    (sum: number, row: any) => sum + normalizeMoney(row.kaspi_before_midnight_amount),
    0,
  )
  const returnKaspiAfterMidnightAmount = returnsList.reduce(
    (sum: number, row: any) => sum + normalizeMoney(row.kaspi_after_midnight_amount),
    0,
  )
  const saleTotalAmount = list.reduce((sum: number, row: any) => sum + normalizeMoney(row.total_amount), 0)
  const returnTotalAmount = returnsList.reduce((sum: number, row: any) => sum + normalizeMoney(row.total_amount), 0)

  return {
    sale_count: list.length,
    item_count: items.reduce((sum: number, row: any) => sum + normalizeQty(row.quantity), 0),
    return_count: returnsList.length,
    return_item_count: returnRows.reduce((sum: number, row: any) => sum + normalizeQty(row.quantity), 0),
    sale_total_amount: saleTotalAmount,
    return_total_amount: returnTotalAmount,
    total_amount: saleTotalAmount - returnTotalAmount,
    cash_amount: saleCashAmount - returnCashAmount,
    kaspi_amount: saleKaspiAmount - returnKaspiAmount,
    kaspi_before_midnight_amount: saleKaspiBeforeMidnightAmount - returnKaspiBeforeMidnightAmount,
    kaspi_after_midnight_amount: saleKaspiAfterMidnightAmount - returnKaspiAfterMidnightAmount,
    sale_cash_amount: saleCashAmount,
    sale_kaspi_amount: saleKaspiAmount,
    sale_kaspi_before_midnight_amount: saleKaspiBeforeMidnightAmount,
    sale_kaspi_after_midnight_amount: saleKaspiAfterMidnightAmount,
    return_cash_amount: returnCashAmount,
    return_kaspi_amount: returnKaspiAmount,
    return_kaspi_before_midnight_amount: returnKaspiBeforeMidnightAmount,
    return_kaspi_after_midnight_amount: returnKaspiAfterMidnightAmount,
  }
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canUseInventorySales(device.point_mode)) {
      return json({ error: 'inventory-sales-disabled-for-device' }, 403)
    }

    const location = await resolvePointSaleLocation(supabase, device.company_id)
    const url = new URL(request.url)
    const view = url.searchParams.get('view')

    if (view === 'shift-summary') {
      const saleDate = String(url.searchParams.get('date') || '').trim()
      const shift = String(url.searchParams.get('shift') || '').trim() as 'day' | 'night'
      if (!saleDate) return json({ error: 'date-required' }, 400)
      if (shift !== 'day' && shift !== 'night') return json({ error: 'shift-required' }, 400)

      const summary = await fetchShiftSummary({
        supabase,
        locationId: location.id,
        saleDate,
        shift,
      })

      return json({
        ok: true,
        data: {
          date: saleDate,
          shift,
          ...summary,
        },
      })
    }

    const [{ data: items, error: itemsError }, { data: balances, error: balancesError }, { data: sales, error: salesError }] =
      await Promise.all([
        supabase
          .from('inventory_items')
          .select('id, name, barcode, unit, sale_price, category:category_id(id, name)')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('inventory_balances')
          .select('item_id, quantity')
          .eq('location_id', location.id),
        supabase
          .from('point_sales')
          .select(
            'id, sale_date, shift, payment_method, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount, total_amount, comment, sold_at, items:point_sale_items(id, quantity, unit_price, total_price, item:item_id(id, name, barcode))',
          )
          .eq('location_id', location.id)
          .order('sold_at', { ascending: false })
          .limit(20),
      ])

    if (itemsError) throw itemsError
    if (balancesError) throw balancesError
    if (salesError) throw salesError

    const balanceMap = new Map<string, number>((balances || []).map((row: any) => [row.item_id, Number(row.quantity || 0)]))

    return json({
      ok: true,
      data: {
        company: {
          id: device.company_id,
          name: device.company?.name || 'Точка',
          code: device.company?.code || null,
        },
        location,
        items: (items || []).map((item: any) => ({
          ...item,
          display_qty: balanceMap.get(item.id) || 0,
        })),
        sales: sales || [],
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-inventory-sales:get',
      message: error?.message || 'Point inventory sales GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить продажи точки' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canUseInventorySales(device.point_mode)) {
      return json({ error: 'inventory-sales-disabled-for-device' }, 403)
    }

    const body = (await request.json().catch(() => null)) as SaleBody | null
    if (body?.action !== 'createSale') return json({ error: 'invalid-action' }, 400)

    const location = await resolvePointSaleLocation(supabase, device.company_id)
    const actor = await resolveActor({ request, supabase, companyId: device.company_id })

    const saleDate = String(body.payload?.sale_date || '').trim()
    const shift = body.payload?.shift
    if (!saleDate) return json({ error: 'sale-date-required' }, 400)
    if (shift !== 'day' && shift !== 'night') return json({ error: 'sale-shift-invalid' }, 400)

    const paymentMethod = body.payload?.payment_method
    if (!['cash', 'kaspi', 'mixed'].includes(String(paymentMethod || ''))) {
      return json({ error: 'sale-payment-method-invalid' }, 400)
    }

    const items = Array.isArray(body.payload?.items)
      ? body.payload.items
          .map((item) => ({
            item_id: String(item.item_id || '').trim(),
            quantity: normalizeQty(item.quantity),
            unit_price: normalizeMoney(item.unit_price),
            comment: item.comment?.trim() || null,
          }))
          .filter((item) => item.item_id && item.quantity > 0)
      : []

    if (items.length === 0) return json({ error: 'point-sale-items-required' }, 400)

    const cashAmount = normalizeMoney(body.payload?.cash_amount)
    const kaspiAmount = normalizeMoney(body.payload?.kaspi_amount)
    const kaspiBeforeMidnightAmount = normalizeMoney(body.payload?.kaspi_before_midnight_amount)
    const kaspiAfterMidnightAmount = normalizeMoney(body.payload?.kaspi_after_midnight_amount)

    const sale = await createPointInventorySale(supabase, {
      company_id: device.company_id,
      location_id: location.id,
      point_device_id: device.id,
      operator_id: actor.operatorId,
      sale_date: saleDate,
      shift,
      payment_method: paymentMethod,
      cash_amount: cashAmount,
      kaspi_amount: kaspiAmount,
      kaspi_before_midnight_amount: kaspiBeforeMidnightAmount,
      kaspi_after_midnight_amount: kaspiAfterMidnightAmount,
      comment: body.payload?.comment?.trim() || null,
      source: 'point-client',
      local_ref: body.payload?.local_ref?.trim() || null,
      items,
    })

    await writeAuditLog(supabase, {
      actorUserId: actor.actorUserId,
      entityType: 'point-sale',
      entityId: String(sale?.sale_id || ''),
      action: 'create',
      payload: {
        point_device_id: device.id,
        company_id: device.company_id,
        operator_id: actor.operatorId,
        location_id: location.id,
        shift,
        sale_date: saleDate,
        payment_method: paymentMethod,
        total_amount: sale?.total_amount || 0,
        item_count: items.length,
      },
    })

    return json({
      ok: true,
      data: {
        sale_id: sale?.sale_id || null,
        total_amount: sale?.total_amount || 0,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-inventory-sales:post',
      message: error?.message || 'Point inventory sales POST error',
    })
    return json({ error: error?.message || 'Не удалось провести продажу' }, 500)
  }
}
