import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createPointInventorySale } from '@/lib/server/repositories/inventory'
import { requirePointDevice } from '@/lib/server/point-devices'
import { checkAndNotifyLowStock } from '@/lib/server/low-stock-notifier'

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
    customer_id?: string | null
    loyalty_points_spent?: number | null
    discount_amount?: number | null
    loyalty_discount_amount?: number | null
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

function normalizePoints(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.max(0, Math.floor(amount))
}

function roundLineTotal(quantity: number, unitPrice: number) {
  return normalizeMoney(quantity * unitPrice)
}

function buildAuthoritativeSaleLines(params: {
  requestedItems: Array<{ item_id: string; quantity: number; comment?: string | null }>
  dbItems: Array<{ id: string; name: string; sale_price: number; is_active: boolean; item_type?: string | null }>
  balances: Array<{ item_id: string; quantity: number }>
  paymentTotal: number
}) {
  const itemMap = new Map(params.dbItems.map((row) => [row.id, row]))
  const balanceMap = new Map(params.balances.map((row) => [row.item_id, Number(row.quantity || 0)]))

  const baseLines = params.requestedItems.map((item) => {
    const dbItem = itemMap.get(item.item_id)
    if (!dbItem || !dbItem.is_active) {
      throw new Error(`Товар недоступен для продажи: ${item.item_id}`)
    }
    if (String(dbItem.item_type || 'product') === 'consumable') {
      throw new Error(`Расходник нельзя продать через кассу: ${dbItem.name}`)
    }

    const available = Number(balanceMap.get(item.item_id) || 0)
    if (item.quantity > available + 0.0001) {
      throw new Error(`Недостаточно остатка на витрине для товара «${dbItem.name}»`)
    }

    const unitPrice = normalizeMoney(dbItem.sale_price)
    return {
      item_id: item.item_id,
      quantity: item.quantity,
      base_unit_price: unitPrice,
      base_total: roundLineTotal(item.quantity, unitPrice),
      comment: item.comment?.trim() || null,
    }
  })

  const subtotal = normalizeMoney(baseLines.reduce((sum, line) => sum + line.base_total, 0))
  if (subtotal <= 0) throw new Error('Сумма продажи должна быть больше нуля')
  if (params.paymentTotal - subtotal > 0.01) {
    throw new Error('Сумма оплаты не может быть больше суммы товаров')
  }

  if (Math.abs(subtotal - params.paymentTotal) <= 0.01) {
    return baseLines.map((line) => ({
      item_id: line.item_id,
      quantity: line.quantity,
      unit_price: line.base_unit_price,
      comment: line.comment,
    }))
  }

  const lines = baseLines.map((line) => ({
    item_id: line.item_id,
    quantity: line.quantity,
    unit_price: line.base_unit_price,
    comment: line.comment,
  }))

  const subtotalWithoutLast = normalizeMoney(
    baseLines.slice(0, -1).reduce((sum, line) => sum + line.base_total, 0),
  )

  let runningTotal = 0
  for (let index = 0; index < lines.length; index += 1) {
    const isLast = index === lines.length - 1
    const baseLine = baseLines[index]
    if (!baseLine) continue

    if (isLast) {
      const remainder = normalizeMoney(params.paymentTotal - runningTotal)
      lines[index].unit_price = normalizeMoney(remainder / baseLine.quantity)
    } else {
      const targetLineTotal =
        subtotalWithoutLast <= 0
          ? 0
          : normalizeMoney((baseLine.base_total / subtotal) * params.paymentTotal)
      lines[index].unit_price = normalizeMoney(targetLineTotal / baseLine.quantity)
      runningTotal = normalizeMoney(runningTotal + roundLineTotal(baseLine.quantity, lines[index].unit_price))
    }
  }

  let computedTotal = normalizeMoney(
    lines.reduce((sum, line) => sum + roundLineTotal(line.quantity, line.unit_price), 0),
  )

  if (Math.abs(computedTotal - params.paymentTotal) > 0.01) {
    const lastIndex = lines.length - 1
    const basePrice = lines[lastIndex].unit_price
    let matched = false
    for (let offset = -200; offset <= 200; offset += 1) {
      const candidatePrice = normalizeMoney(basePrice + offset / 100)
      if (candidatePrice < 0) continue
      const candidateLines = [...lines]
      candidateLines[lastIndex] = { ...candidateLines[lastIndex], unit_price: candidatePrice }
      const candidateTotal = normalizeMoney(
        candidateLines.reduce((sum, line) => sum + roundLineTotal(line.quantity, line.unit_price), 0),
      )
      if (Math.abs(candidateTotal - params.paymentTotal) <= 0.01) {
        lines[lastIndex] = { ...lines[lastIndex], unit_price: candidatePrice }
        computedTotal = candidateTotal
        matched = true
        break
      }
    }
    if (!matched) {
      throw new Error('Не удалось согласовать сумму продажи со скидкой')
    }
  }

  return lines
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

async function resolveCustomerSaleContext(params: {
  supabase: any
  companyId: string
  customerId: string | null
  loyaltyPointsSpent: number
}) {
  if (!params.customerId) {
    if (params.loyaltyPointsSpent > 0) {
      throw new Error('Для списания бонусов нужно выбрать клиента')
    }
    return { customer: null, loyaltyConfig: null }
  }

  const [{ data: customer, error: customerError }, { data: loyaltyConfig, error: configError }] = await Promise.all([
    params.supabase
      .from('customers')
      .select('id, name, loyalty_points, total_spent, visits_count')
      .eq('id', params.customerId)
      .eq('company_id', params.companyId)
      .maybeSingle(),
    params.supabase
      .from('loyalty_config')
      .select('*')
      .eq('company_id', params.companyId)
      .maybeSingle(),
  ])

  if (customerError) throw customerError
  if (configError) throw configError
  if (!customer) throw new Error('customer-not-found')
  if (params.loyaltyPointsSpent > 0 && !loyaltyConfig?.is_active) {
    throw new Error('loyalty-not-active')
  }
  if (params.loyaltyPointsSpent > Number(customer.loyalty_points || 0)) {
    throw new Error('Недостаточно бонусных баллов у клиента')
  }

  return { customer, loyaltyConfig }
}

async function applyCustomerSaleEffects(params: {
  supabase: any
  saleId: string
  companyId: string
  customer: { id: string; loyalty_points: number; total_spent: number; visits_count: number } | null
  loyaltyConfig: any
  loyaltyPointsSpent: number
  totalAmount: number
  discountAmount: number
  loyaltyDiscountAmount: number
}) {
  if (!params.customer) return { pointsEarned: 0, pointsSpent: 0, customerId: null as string | null }

  const pointsPerHundred = params.loyaltyConfig?.is_active ? Number(params.loyaltyConfig?.points_per_100_tenge || 1) : 0
  const pointsSpent = normalizePoints(params.loyaltyPointsSpent)
  const pointsEarned = Math.max(0, Math.floor((params.totalAmount / 100) * pointsPerHundred))
  const newPoints = Math.max(0, Number(params.customer.loyalty_points || 0) + pointsEarned - pointsSpent)
  const newTotalSpent = normalizeMoney(Number(params.customer.total_spent || 0) + params.totalAmount)
  const newVisits = Number(params.customer.visits_count || 0) + 1

  const { error: updateCustomerError } = await params.supabase
    .from('customers')
    .update({
      loyalty_points: newPoints,
      total_spent: newTotalSpent,
      visits_count: newVisits,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.customer.id)
    .eq('company_id', params.companyId)

  if (updateCustomerError) throw updateCustomerError

  const { error: updateSaleError } = await params.supabase
    .from('point_sales')
    .update({
      customer_id: params.customer.id,
      discount_amount: params.discountAmount,
      loyalty_points_earned: pointsEarned,
      loyalty_points_spent: pointsSpent,
      loyalty_discount_amount: params.loyaltyDiscountAmount,
    })
    .eq('id', params.saleId)

  if (updateSaleError) throw updateSaleError

  return { pointsEarned, pointsSpent, customerId: params.customer.id }
}

async function fetchShiftSummary(params: {
  supabase: any
  locationId: string
  saleDate: string
  shift: 'day' | 'night'
}) {
  const [{ data: sales, error: salesError }, { data: returns, error: returnsError }] = await Promise.all([
    params.supabase
      .from('point_sales')
      .select('id, total_amount, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount')
      .eq('location_id', params.locationId)
      .eq('sale_date', params.saleDate)
      .eq('shift', params.shift),
    params.supabase
      .from('point_returns')
      .select('id, total_amount, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount')
      .eq('location_id', params.locationId)
      .eq('return_date', params.saleDate)
      .eq('shift', params.shift),
  ])

  if (salesError) throw salesError
  if (returnsError) throw returnsError

  const saleIds = (sales || []).map((row: any) => row.id)
  const returnIds = (returns || []).map((row: any) => row.id)

  const [{ data: saleItems, error: saleItemsError }, { data: returnItems, error: returnItemsError }] = await Promise.all([
    saleIds.length
      ? params.supabase.from('point_sale_items').select('sale_id, quantity').in('sale_id', saleIds)
      : Promise.resolve({ data: [], error: null } as any),
    returnIds.length
      ? params.supabase.from('point_return_items').select('return_id, quantity').in('return_id', returnIds)
      : Promise.resolve({ data: [], error: null } as any),
  ])

  if (saleItemsError) throw saleItemsError
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
          .select('id, name, barcode, unit, sale_price, item_type, category:category_id(id, name)')
          .eq('is_active', true)
          .neq('item_type', 'consumable')
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

    const requestedItems = Array.isArray(body.payload?.items)
      ? body.payload.items
          .map((item) => ({
            item_id: String(item.item_id || '').trim(),
            quantity: normalizeQty(item.quantity),
            comment: item.comment?.trim() || null,
          }))
          .filter((item) => item.item_id && item.quantity > 0)
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

    const itemIds = [...new Set(requestedItems.map((item) => item.item_id))]
    const [{ data: dbItems, error: itemError }, { data: balances, error: balanceError }, customerContext] = await Promise.all([
      supabase
        .from('inventory_items')
        .select('id, name, sale_price, is_active, item_type')
        .in('id', itemIds),
      supabase
        .from('inventory_balances')
        .select('item_id, quantity')
        .eq('location_id', location.id)
        .in('item_id', itemIds),
      resolveCustomerSaleContext({
        supabase,
        companyId: device.company_id,
        customerId,
        loyaltyPointsSpent,
      }),
    ])

    if (itemError) throw itemError
    if (balanceError) throw balanceError

    const items = buildAuthoritativeSaleLines({
      requestedItems,
      dbItems: dbItems || [],
      balances: balances || [],
      paymentTotal,
    })

    const sale = await createPointInventorySale(supabase, {
      company_id: device.company_id,
      location_id: location.id,
      point_device_id: null,
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

    let loyaltyResult: { pointsEarned: number; pointsSpent: number; customerId: string | null } | null = null
    try {
      loyaltyResult = await applyCustomerSaleEffects({
        supabase,
        saleId: String(sale?.sale_id || ''),
        companyId: device.company_id,
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
        area: 'point-inventory-sales:customer-sync',
        message: customerError?.message || 'Point inventory sale customer sync error',
      })
    }

    const { data: savedSale } = await supabase
      .from('point_sales')
      .select('id, sold_at')
      .eq('id', String(sale?.sale_id || ''))
      .maybeSingle()

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
        customer_id: loyaltyResult?.customerId || null,
      },
    })

    // Trigger low stock check in background (don't await)
    const soldItemIds = items.map((i) => i.item_id)
    checkAndNotifyLowStock(soldItemIds, location.id).catch(() => null)

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
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-inventory-sales:post',
      message: error?.message || 'Point inventory sales POST error',
    })
    return json({ error: error?.message || 'Не удалось провести продажу' }, 500)
  }
}
