import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createPointInventoryReturn } from '@/lib/server/repositories/inventory'
import { requirePointDevice } from '@/lib/server/point-devices'

type ReturnBody = {
  action: 'createReturn'
  payload: {
    sale_id: string
    return_date: string
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

function canUseInventoryReturns(pointMode: string | null | undefined) {
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

async function resolvePointLocation(supabase: any, companyId: string) {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, name, code, location_type')
    .eq('company_id', companyId)
    .eq('location_type', 'point_display')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('inventory-return-location-not-found')
  return data
}

async function fetchReturnsWithFallback(supabase: any, locationId: string) {
  const preferred = await supabase
    .from('point_returns')
    .select(
      'id, sale_id, return_date, shift, payment_method, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount, total_amount, comment, returned_at, items:point_return_items(id, sale_item_id, quantity, unit_price, total_price, item:item_id(id, name, barcode))',
    )
    .eq('location_id', locationId)
    .order('returned_at', { ascending: false })
    .limit(20)

  if (!preferred.error) return preferred

  const message = String(preferred.error?.message || '')
  if (!/sale_id|sale_item_id/i.test(message)) return preferred

  return await supabase
    .from('point_returns')
    .select(
      'id, return_date, shift, payment_method, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount, total_amount, comment, returned_at, items:point_return_items(id, quantity, unit_price, total_price, item:item_id(id, name, barcode))',
    )
    .eq('location_id', locationId)
    .order('returned_at', { ascending: false })
    .limit(20)
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

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canUseInventoryReturns(device.point_mode)) {
      return json({ error: 'inventory-returns-disabled-for-device' }, 403)
    }

    const location = await resolvePointLocation(supabase, device.company_id)
    const [returnsResult, salesResult] = await Promise.all([
      fetchReturnsWithFallback(supabase, location.id),
      supabase
        .from('point_sales')
        .select('id, sale_date, shift, payment_method, total_amount, sold_at, items:point_sale_items(id, quantity, unit_price, total_price, item:item_id(id, name, barcode))')
        .eq('location_id', location.id)
        .order('sold_at', { ascending: false })
        .limit(12),
    ])

    const returns = returnsResult.data
    const returnsError = returnsResult.error
    const sales = salesResult.data
    const salesError = salesResult.error

    if (returnsError) throw returnsError
    if (salesError) throw salesError
    const returnedBySaleLineKey = new Map<string, number>()

    for (const pointReturn of returns || []) {
      const saleId = String((pointReturn as any)?.sale_id || '').trim()
      if (!saleId) continue
      const returnItems = Array.isArray((pointReturn as any)?.items) ? (pointReturn as any).items : []
      for (const line of returnItems) {
        const itemId = String(line?.item?.id || line?.item_id || '').trim()
        const unitPrice = normalizeMoney(line?.unit_price)
        const quantity = normalizeQty(line?.quantity)
        if (!itemId || quantity <= 0) continue
        const key = `${saleId}:${itemId}:${unitPrice.toFixed(2)}`
        returnedBySaleLineKey.set(key, (returnedBySaleLineKey.get(key) || 0) + quantity)
      }
    }

    const normalizedSales = (sales || []).map((sale: any) => {
      const saleId = String(sale?.id || '').trim()
      const saleItems = Array.isArray(sale?.items) ? sale.items : []
      return {
        ...sale,
        items: saleItems.map((line: any) => {
          const itemId = String(line?.item?.id || '').trim()
          const unitPrice = normalizeMoney(line?.unit_price)
          const soldQty = normalizeQty(line?.quantity)
          const key = `${saleId}:${itemId}:${unitPrice.toFixed(2)}`
          const returnedQty = normalizeQty(returnedBySaleLineKey.get(key) || 0)
          return {
            ...line,
            returned_qty: returnedQty,
            returnable_qty: Math.max(0, soldQty - returnedQty),
          }
        }),
      }
    })

    return json({
      ok: true,
      data: {
        company: {
          id: device.company_id,
          name: device.company?.name || 'Точка',
          code: device.company?.code || null,
        },
        location,
        returns: returns || [],
        sales: normalizedSales,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-inventory-returns:get',
      message: error?.message || 'Point inventory returns GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить возвраты точки' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canUseInventoryReturns(device.point_mode)) {
      return json({ error: 'inventory-returns-disabled-for-device' }, 403)
    }

    const body = (await request.json().catch(() => null)) as ReturnBody | null
    if (body?.action !== 'createReturn') return json({ error: 'invalid-action' }, 400)

    const location = await resolvePointLocation(supabase, device.company_id)
    const actor = await resolveActor({ request, supabase, companyId: device.company_id })

    const returnDate = String(body.payload?.return_date || '').trim()
    const saleId = String(body.payload?.sale_id || '').trim()
    const shift = body.payload?.shift
    if (!saleId) return json({ error: 'sale-id-required' }, 400)
    if (!returnDate) return json({ error: 'return-date-required' }, 400)
    if (shift !== 'day' && shift !== 'night') return json({ error: 'return-shift-invalid' }, 400)

    const paymentMethod = body.payload?.payment_method
    if (!['cash', 'kaspi', 'mixed'].includes(String(paymentMethod || ''))) {
      return json({ error: 'return-payment-method-invalid' }, 400)
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

    if (items.length === 0) return json({ error: 'point-return-items-required' }, 400)

    const cashAmount = normalizeMoney(body.payload?.cash_amount)
    const kaspiAmount = normalizeMoney(body.payload?.kaspi_amount)
    const kaspiBeforeMidnightAmount = normalizeMoney(body.payload?.kaspi_before_midnight_amount)
    const kaspiAfterMidnightAmount = normalizeMoney(body.payload?.kaspi_after_midnight_amount)

    const pointReturn = await createPointInventoryReturn(supabase, {
      company_id: device.company_id,
      location_id: location.id,
      point_device_id: null,
      operator_id: actor.operatorId,
      sale_id: saleId,
      return_date: returnDate,
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
      entityType: 'point-return',
      entityId: String(pointReturn?.return_id || ''),
      action: 'create',
      payload: {
        point_device_id: device.id,
        company_id: device.company_id,
        operator_id: actor.operatorId,
        location_id: location.id,
        shift,
        return_date: returnDate,
        payment_method: paymentMethod,
        total_amount: pointReturn?.total_amount || 0,
        item_count: items.length,
      },
    })

    return json({
      ok: true,
      data: {
        return_id: pointReturn?.return_id || null,
        total_amount: pointReturn?.total_amount || 0,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-inventory-returns:post',
      message: error?.message || 'Point inventory returns POST error',
    })
    return json({ error: error?.message || 'Не удалось провести возврат' }, 500)
  }
}
