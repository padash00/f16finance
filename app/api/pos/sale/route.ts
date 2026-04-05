import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkAndNotifyLowStock } from '@/lib/server/low-stock-notifier'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeMoney(value: unknown): number {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function normalizeQty(value: unknown): number {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

function getLocalSaleContext(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Qyzylorda',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '00'
  const saleDate = `${part('year')}-${part('month')}-${part('day')}`
  const hour = Number(part('hour'))
  const shift = hour >= 20 || hour < 8 ? 'night' : 'day'

  return { saleDate, hour, shift }
}

function derivePaymentMethod(amounts: {
  cash: number
  kaspi: number
  card: number
  online: number
}): 'cash' | 'kaspi' | 'card' | 'online' | 'mixed' {
  const positive = Object.entries(amounts).filter(([, value]) => value > 0.009)
  if (positive.length === 0) {
    throw new Error('pos-payment-empty')
  }
  if (positive.length > 1) return 'mixed'
  return positive[0][0] as 'cash' | 'kaspi' | 'card' | 'online'
}

type SaleRequestBody = {
  company_id: string
  location_id: string
  items: Array<{ item_id: string; quantity: number }>
  cash_amount: number
  kaspi_amount: number
  online_amount: number
  card_amount: number
  customer_id?: string | null
  discount_id?: string | null
  discount_percent?: number
  loyalty_points_spent?: number
  note?: string | null
}

type PricedItem = {
  item_id: string
  name: string
  quantity: number
  unit_price: number
  total_price: number
}

async function runLegacyFallback(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  companyId: string
  locationId: string
  operatorId: string | null
  saleDate: string
  shift: string
  paymentMethod: 'cash' | 'kaspi' | 'mixed'
  cashAmount: number
  kaspiAmount: number
  kaspiBeforeMidnightAmount: number
  kaspiAfterMidnightAmount: number
  comment: string | null
  pricedItems: PricedItem[]
}) {
  const { data, error } = await params.supabase.rpc('inventory_create_point_sale', {
    p_company_id: params.companyId,
    p_location_id: params.locationId,
    p_point_device_id: null,
    p_operator_id: params.operatorId,
    p_sale_date: params.saleDate,
    p_shift: params.shift,
    p_payment_method: params.paymentMethod,
    p_cash_amount: params.cashAmount,
    p_kaspi_amount: params.kaspiAmount,
    p_kaspi_before_midnight_amount: params.kaspiBeforeMidnightAmount,
    p_kaspi_after_midnight_amount: params.kaspiAfterMidnightAmount,
    p_comment: params.comment,
    p_source: 'web-pos',
    p_local_ref: null,
    p_items: params.pricedItems.map((item) => ({
      item_id: item.item_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
    })),
  })

  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.sale_id) throw new Error('pos-sale-fallback-failed')

  return { saleId: row.sale_id as string }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as SaleRequestBody | null
    if (!body) return json({ error: 'invalid-body' }, 400)

    const companyId = String(body.company_id || '').trim()
    const locationId = String(body.location_id || '').trim()
    if (!companyId) return json({ error: 'company_id-required' }, 400)
    if (!locationId) return json({ error: 'location_id-required' }, 400)
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds && companyScope.allowedCompanyIds.length === 0 && !access.isSuperAdmin) {
      return json({ error: 'forbidden-company' }, 403)
    }

    const requestedItems = Array.isArray(body.items)
      ? body.items
          .map((item) => ({
            item_id: String(item.item_id || '').trim(),
            quantity: normalizeQty(item.quantity),
          }))
          .filter((item) => item.item_id && item.quantity > 0)
      : []

    if (requestedItems.length === 0) return json({ error: 'items-required' }, 400)

    const cashAmount = normalizeMoney(body.cash_amount)
    const kaspiAmount = normalizeMoney(body.kaspi_amount)
    const onlineAmount = normalizeMoney(body.online_amount)
    const cardAmount = normalizeMoney(body.card_amount)
    const customerId = body.customer_id?.trim() || null
    const discountId = body.discount_id?.trim() || null
    const discountPercent = Math.max(0, Math.min(99, Number(body.discount_percent || 0)))
    const loyaltyPointsSpent = Math.max(0, Math.floor(Number(body.loyalty_points_spent || 0)))
    const comment = body.note?.trim() || null

    const supabase = createAdminSupabaseClient()

    const itemIds = [...new Set(requestedItems.map((item) => item.item_id))]
    const [{ data: locationRow, error: locationError }, { data: itemRows, error: itemError }, { data: balanceRows, error: balanceError }] =
      await Promise.all([
        supabase
          .from('inventory_locations')
          .select('id, company_id, location_type, name')
          .eq('id', locationId)
          .maybeSingle(),
        supabase
          .from('inventory_items')
          .select('id, name, sale_price, is_active')
          .in('id', itemIds),
        supabase
          .from('inventory_balances')
          .select('item_id, quantity')
          .eq('location_id', locationId)
          .in('item_id', itemIds),
      ])

      if (locationError) throw locationError
    if (itemError) throw itemError
    if (balanceError) throw balanceError

    if (!locationRow || locationRow.company_id !== companyId || locationRow.location_type !== 'point_display') {
      return json({ error: 'invalid-location' }, 400)
    }

    const itemMap = new Map((itemRows || []).map((row: any) => [row.id, row]))
    const balanceMap = new Map((balanceRows || []).map((row: any) => [row.item_id, Number(row.quantity || 0)]))

    const pricedItems: PricedItem[] = []
    for (const item of requestedItems) {
      const dbItem = itemMap.get(item.item_id)
      if (!dbItem || !dbItem.is_active) {
        return json({ error: `item-not-found:${item.item_id}` }, 400)
      }

      const available = balanceMap.get(item.item_id) || 0
      if (item.quantity > available + 0.0001) {
        return json({ error: `Недостаточно остатка на витрине для товара «${dbItem.name}»` }, 400)
      }

      const unitPrice = normalizeMoney(dbItem.sale_price)
      pricedItems.push({
        item_id: item.item_id,
        name: dbItem.name,
        quantity: item.quantity,
        unit_price: unitPrice,
        total_price: normalizeMoney(unitPrice * item.quantity),
      })
    }

    const subtotal = normalizeMoney(pricedItems.reduce((sum, item) => sum + item.total_price, 0))

    let discountRow: any = null
    if (discountId) {
      const { data, error } = await supabase
        .from('discounts')
        .select('id, name, type, value, min_order_amount')
        .eq('id', discountId)
        .eq('is_active', true)
        .maybeSingle()
      if (error) throw error
      discountRow = data
      if (!discountRow) return json({ error: 'discount-not-found' }, 400)
      if (Number(discountRow.min_order_amount || 0) > subtotal) {
        return json({ error: 'Минимальная сумма для этой скидки ещё не достигнута' }, 400)
      }
    }

    let discountAmount = 0
    if (discountRow) {
      if (discountRow.type === 'percent') {
        discountAmount = normalizeMoney((subtotal * Number(discountRow.value || 0)) / 100)
      } else if (discountRow.type === 'fixed') {
        discountAmount = Math.min(subtotal, normalizeMoney(discountRow.value))
      }
    } else if (discountPercent > 0) {
      discountAmount = normalizeMoney((subtotal * discountPercent) / 100)
    }

    let loyaltyConfig: any = null
    let customerRow: any = null
    if (customerId || loyaltyPointsSpent > 0) {
      const [{ data: config, error: configError }, { data: customer, error: customerError }] = await Promise.all([
        supabase.from('loyalty_config').select('*').eq('company_id', companyId).maybeSingle(),
        customerId
          ? supabase.from('customers').select('id, loyalty_points, name').eq('id', customerId).maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
      ])
      if (configError) throw configError
      if (customerError) throw customerError
      loyaltyConfig = config
      customerRow = customer
    }

    if (customerId && !customerRow) {
      return json({ error: 'customer-not-found' }, 400)
    }

    let loyaltyDiscountAmount = 0
    let loyaltyPointsEarned = 0
    if (loyaltyConfig?.is_active) {
      const tengePerPoint = Number(loyaltyConfig.tenge_per_point || 0)
      const pointsPer100 = Number(loyaltyConfig.points_per_100_tenge || 0)
      const maxRedeemPercent = Number(loyaltyConfig.max_redeem_percent || 0)

      if (loyaltyPointsSpent > 0) {
        if (!customerRow) return json({ error: 'customer-required-for-loyalty' }, 400)
        if (loyaltyPointsSpent > Number(customerRow.loyalty_points || 0)) {
          return json({ error: 'Недостаточно бонусных баллов у клиента' }, 400)
        }

        loyaltyDiscountAmount = normalizeMoney(loyaltyPointsSpent * tengePerPoint)
        const maxRedeem = maxRedeemPercent > 0 ? normalizeMoney((subtotal * maxRedeemPercent) / 100) : loyaltyDiscountAmount
        loyaltyDiscountAmount = Math.min(loyaltyDiscountAmount, maxRedeem, subtotal - discountAmount)
      }

      if (pointsPer100 > 0) {
        const afterDiscount = Math.max(0, subtotal - discountAmount - loyaltyDiscountAmount)
        loyaltyPointsEarned = Math.floor((afterDiscount / 100) * pointsPer100)
      }
    } else if (loyaltyPointsSpent > 0) {
      return json({ error: 'loyalty-not-active' }, 400)
    }

    const totalAmount = normalizeMoney(Math.max(0, subtotal - discountAmount - loyaltyDiscountAmount))
    const paymentTotal = normalizeMoney(cashAmount + kaspiAmount + cardAmount + onlineAmount)
    if (paymentTotal <= 0) {
      return json({ error: 'payment-required' }, 400)
    }
    if (Math.abs(paymentTotal - totalAmount) > 0.01) {
      return json({ error: 'Сумма способов оплаты должна совпадать с итогом чека' }, 400)
    }

    const { saleDate, hour, shift } = getLocalSaleContext()
    const paymentMethod = derivePaymentMethod({
      cash: cashAmount,
      kaspi: kaspiAmount,
      card: cardAmount,
      online: onlineAmount,
    })

    const kaspiBeforeMidnightAmount = shift === 'night' && hour >= 20 ? kaspiAmount : 0
    const kaspiAfterMidnightAmount = shift === 'night' && hour < 8 ? kaspiAmount : 0

    let saleId = ''

    const rpcResult = await supabase.rpc('inventory_create_pos_sale', {
      p_company_id: companyId,
      p_location_id: locationId,
      p_operator_id: access.staffMember?.id || null,
      p_sale_date: saleDate,
      p_shift: shift,
      p_payment_method: paymentMethod,
      p_cash_amount: cashAmount,
      p_kaspi_amount: kaspiAmount,
      p_kaspi_before_midnight_amount: kaspiBeforeMidnightAmount,
      p_kaspi_after_midnight_amount: kaspiAfterMidnightAmount,
      p_card_amount: cardAmount,
      p_online_amount: onlineAmount,
      p_customer_id: customerId,
      p_discount_id: discountId,
      p_discount_amount: discountAmount,
      p_loyalty_points_earned: loyaltyPointsEarned,
      p_loyalty_points_spent: loyaltyPointsSpent,
      p_loyalty_discount_amount: loyaltyDiscountAmount,
      p_comment: comment,
      p_source: 'web-pos',
      p_items: pricedItems.map((item) => ({
        item_id: item.item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    })

    if (rpcResult.error) {
      const message = String(rpcResult.error.message || '')
      const rpcMissing =
        message.includes('inventory_create_pos_sale') ||
        message.includes('function public.inventory_create_pos_sale') ||
        rpcResult.error.code === '42883'

      if (!rpcMissing) throw rpcResult.error

      if (
        cardAmount > 0 ||
        onlineAmount > 0 ||
        customerId ||
        discountId ||
        discountAmount > 0 ||
        loyaltyDiscountAmount > 0 ||
        loyaltyPointsEarned > 0 ||
        loyaltyPointsSpent > 0
      ) {
        return json({ error: 'Для этой кассы нужно применить новую миграцию POS в базе данных' }, 500)
      }

      if (paymentMethod === 'card' || paymentMethod === 'online') {
        return json({ error: 'Для оплаты картой и онлайн нужно обновить базу данных POS' }, 500)
      }

      const fallback = await runLegacyFallback({
        supabase,
        companyId,
        locationId,
        operatorId: access.staffMember?.id || null,
        saleDate,
        shift,
        paymentMethod: paymentMethod as 'cash' | 'kaspi' | 'mixed',
        cashAmount,
        kaspiAmount,
        kaspiBeforeMidnightAmount,
        kaspiAfterMidnightAmount,
        comment,
        pricedItems,
      })
      saleId = fallback.saleId
    } else {
      const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data
      saleId = String(row?.sale_id || '')
    }

    if (!saleId) throw new Error('pos-sale-save-failed')

    checkAndNotifyLowStock(itemIds, locationId).catch(() => null)

    const { data: receiptSale, error: receiptError } = await supabase
      .from('point_sales')
      .select(
        'id, sold_at, sale_date, shift, payment_method, cash_amount, kaspi_amount, card_amount, online_amount, total_amount, comment, customer_id, discount_id, discount_amount, loyalty_points_earned, loyalty_points_spent, loyalty_discount_amount, items:point_sale_items(id, item_id, quantity, unit_price, total_price)',
      )
      .eq('id', saleId)
      .maybeSingle()

    if (receiptError) throw receiptError

    return json({
      ok: true,
      data: {
        sale_id: saleId,
        receipt_data: {
          sale_id: saleId,
          sale_date: saleDate,
          company_id: companyId,
          location_id: locationId,
          items: pricedItems,
          subtotal,
          discount_amount: discountAmount,
          loyalty_discount_amount: loyaltyDiscountAmount,
          total_amount: totalAmount,
          cash_amount: cashAmount,
          kaspi_amount: kaspiAmount,
          online_amount: onlineAmount,
          card_amount: cardAmount,
          customer_id: customerId,
          loyalty_points_earned: loyaltyPointsEarned,
          loyalty_points_spent: loyaltyPointsSpent,
          sale: receiptSale,
        },
      },
    })
  } catch (error: any) {
    console.error('[pos/sale]', error)
    return json({ error: error?.message || 'РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕРІРµСЃС‚Рё РїСЂРѕРґР°Р¶Сѓ' }, 500)
  }
}
