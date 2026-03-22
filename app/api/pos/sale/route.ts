import { NextResponse } from 'next/server'

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

type SaleRequestBody = {
  company_id: string
  location_id: string
  items: Array<{ item_id: string; quantity: number; unit_price: number }>
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

    const items = Array.isArray(body.items)
      ? body.items
          .map((item) => ({
            item_id: String(item.item_id || '').trim(),
            quantity: normalizeQty(item.quantity),
            unit_price: normalizeMoney(item.unit_price),
          }))
          .filter((item) => item.item_id && item.quantity > 0)
      : []

    if (items.length === 0) return json({ error: 'items-required' }, 400)

    const cashAmount = normalizeMoney(body.cash_amount)
    const kaspiAmount = normalizeMoney(body.kaspi_amount)
    const onlineAmount = normalizeMoney(body.online_amount)
    const cardAmount = normalizeMoney(body.card_amount)
    const customerId = body.customer_id?.trim() || null
    const discountId = body.discount_id?.trim() || null
    const discountPercent = Math.max(0, Math.min(99, Number(body.discount_percent || 0)))
    const loyaltyPointsSpent = Math.max(0, Math.floor(Number(body.loyalty_points_spent || 0)))

    const supabase = createAdminSupabaseClient()

    // Fetch loyalty config if needed
    let loyaltyConfig: any = null
    if (customerId || loyaltyPointsSpent > 0) {
      const { data } = await supabase.from('loyalty_config').select('*').eq('company_id', companyId).maybeSingle()
      loyaltyConfig = data
    }

    // Fetch discount if discount_id provided
    let discountRow: any = null
    if (discountId) {
      const { data } = await supabase
        .from('discounts')
        .select('id, name, type, value, min_order_amount')
        .eq('id', discountId)
        .eq('is_active', true)
        .maybeSingle()
      discountRow = data
    }

    // Calculate subtotal from items
    const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)

    // Calculate discount amount
    let discountAmount = 0
    if (discountRow) {
      if (discountRow.type === 'percent') {
        discountAmount = Math.round((subtotal * discountRow.value) / 100 * 100) / 100
      } else if (discountRow.type === 'fixed') {
        discountAmount = Math.min(subtotal, normalizeMoney(discountRow.value))
      }
    } else if (discountPercent > 0) {
      discountAmount = Math.round((subtotal * discountPercent) / 100 * 100) / 100
    }

    // Calculate loyalty discount
    let loyaltyDiscountAmount = 0
    let loyaltyPointsEarned = 0
    if (loyaltyConfig && loyaltyConfig.is_active) {
      const tengePerPoint = Number(loyaltyConfig.tenge_per_point || 0)
      const pointsPer100 = Number(loyaltyConfig.points_per_100_tenge || 0)

      if (loyaltyPointsSpent > 0 && tengePerPoint > 0) {
        loyaltyDiscountAmount = loyaltyPointsSpent * tengePerPoint
        // Cap at max_redeem_percent of subtotal
        const maxRedeem = loyaltyConfig.max_redeem_percent
          ? (subtotal * Number(loyaltyConfig.max_redeem_percent)) / 100
          : loyaltyDiscountAmount
        loyaltyDiscountAmount = Math.min(loyaltyDiscountAmount, maxRedeem)
        loyaltyDiscountAmount = Math.round(loyaltyDiscountAmount * 100) / 100
      }

      if (pointsPer100 > 0) {
        const afterDiscount = Math.max(0, subtotal - discountAmount - loyaltyDiscountAmount)
        loyaltyPointsEarned = Math.floor((afterDiscount / 100) * pointsPer100)
      }
    }

    const totalAmount = Math.max(0, subtotal - discountAmount - loyaltyDiscountAmount)
    const saleDate = new Date().toISOString().split('T')[0]

    // Insert point_sale
    const { data: saleRow, error: saleError } = await supabase
      .from('point_sales')
      .insert({
        company_id: companyId,
        location_id: locationId,
        operator_id: access.staffMember?.id || null,
        sale_date: saleDate,
        cash_amount: cashAmount,
        kaspi_amount: kaspiAmount,
        online_amount: onlineAmount,
        card_amount: cardAmount,
        total_amount: totalAmount,
        customer_id: customerId,
        discount_id: discountId,
        discount_amount: discountAmount,
        loyalty_points_earned: loyaltyPointsEarned,
        loyalty_points_spent: loyaltyPointsSpent,
        loyalty_discount_amount: loyaltyDiscountAmount,
        note: body.note?.trim() || null,
        source: 'web-pos',
      })
      .select('id')
      .single()

    if (saleError) throw saleError
    const saleId = saleRow.id

    // Insert sale items
    const saleItemRows = items.map((item) => ({
      sale_id: saleId,
      item_id: item.item_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: Math.round(item.unit_price * item.quantity * 100) / 100,
    }))

    const { error: itemsError } = await supabase.from('point_sale_items').insert(saleItemRows)
    if (itemsError) throw itemsError

    // Apply inventory balance delta for each item
    for (const item of items) {
      await supabase.rpc('inventory_apply_balance_delta', {
        p_location_id: locationId,
        p_item_id: item.item_id,
        p_delta: -item.quantity,
      })
    }

    // Update customer loyalty points and stats
    if (customerId) {
      const { error: loyaltyRpcError } = await supabase.rpc('increment_customer_loyalty', {
        p_customer_id: customerId,
        p_points_earned: loyaltyPointsEarned,
        p_points_spent: loyaltyPointsSpent,
        p_sale_total: totalAmount,
      })

      if (loyaltyRpcError) {
        // Fallback: manual update if RPC doesn't exist
        const { data: customerRow } = await supabase
          .from('customers')
          .select('loyalty_points')
          .eq('id', customerId)
          .maybeSingle()

        if (customerRow) {
          const newPoints = Math.max(0, (customerRow.loyalty_points || 0) - loyaltyPointsSpent + loyaltyPointsEarned)
          await supabase
            .from('customers')
            .update({ loyalty_points: newPoints })
            .eq('id', customerId)
        }
      }
    }

    // Increment discount usage count
    if (discountId) {
      // Try using RPC first, fall back to raw SQL increment via update
      const { error: discountRpcError } = await supabase.rpc('increment_discount_usage', {
        p_discount_id: discountId,
      })

      if (discountRpcError) {
        // Fallback: fetch current count and increment manually
        const { data: discountRow } = await supabase
          .from('discounts')
          .select('usage_count')
          .eq('id', discountId)
          .maybeSingle()

        if (discountRow) {
          await supabase
            .from('discounts')
            .update({ usage_count: (discountRow.usage_count || 0) + 1 })
            .eq('id', discountId)
        }
      }
    }

    // Trigger low stock check in background (don't await)
    const soldItemIds = items.map((i) => i.item_id)
    checkAndNotifyLowStock(soldItemIds, locationId).catch(() => null)

    // Fetch full receipt data
    const { data: receiptSale } = await supabase
      .from('point_sales')
      .select('*, items:point_sale_items(id, item_id, quantity, unit_price, total_price)')
      .eq('id', saleId)
      .maybeSingle()

    return json({
      ok: true,
      data: {
        sale_id: saleId,
        receipt_data: {
          sale_id: saleId,
          sale_date: saleDate,
          company_id: companyId,
          location_id: locationId,
          items: saleItemRows,
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
    return json({ error: error?.message || 'Не удалось провести продажу' }, 500)
  }
}
