import { NextResponse } from 'next/server'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createPointInventoryReturn } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function roundMoney(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function roundQty(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

function lineKey(itemId: unknown, unitPrice: unknown) {
  return `${String(itemId || '')}:${roundMoney(unitPrice).toFixed(2)}`
}

async function attachReturnableQuantities(supabase: any, sale: any) {
  const items = Array.isArray(sale?.items) ? sale.items : []
  if (!sale?.id || items.length === 0) return { ...sale, items }

  const { data: returns, error: returnsError } = await supabase
    .from('point_returns')
    .select('id')
    .eq('sale_id', sale.id)

  if (returnsError) throw returnsError

  const returnIds = (returns || []).map((row: any) => row.id).filter(Boolean)
  const returnedByLine = new Map<string, number>()

  if (returnIds.length > 0) {
    const { data: returnItems, error: itemsError } = await supabase
      .from('point_return_items')
      .select('item_id, unit_price, quantity, return_id')
      .in('return_id', returnIds)

    if (itemsError) throw itemsError

    for (const item of returnItems || []) {
      const key = lineKey(item.item_id, item.unit_price)
      returnedByLine.set(key, roundQty((returnedByLine.get(key) || 0) + Number(item.quantity || 0)))
    }
  }

  return {
    ...sale,
    items: items.map((item: any) => {
      const returnedQty = returnedByLine.get(lineKey(item.item_id, item.unit_price)) || 0
      const quantity = Number(item.quantity || 0)
      return {
        ...item,
        returned_qty: returnedQty,
        returnable_qty: Math.max(0, roundQty(quantity - returnedQty)),
      }
    }),
  }
}

export async function GET(request: Request) {
  // Fetch original sale by ID or last 6 chars to pre-fill return form
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const saleId = url.searchParams.get('sale_id') || ''
    const shortId = url.searchParams.get('short_id') || ''
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('point_sales')
      .select('id, sale_date, sold_at, total_amount, payment_method, cash_amount, kaspi_amount, card_amount, online_amount, items:point_sale_items(id, item_id, quantity, unit_price, total_price, inventory_items(name))')

    if (!saleId && !shortId) {
      return json({ error: 'sale_id or short_id required' }, 400)
    }
    if (saleId) {
      query = query.eq('id', saleId)
    }

    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ error: 'Чек не найден' }, 404)
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    if (saleId) {
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      if (!data) return json({ error: 'Чек не найден' }, 404)
      return json({ ok: true, data: await attachReturnableQuantities(supabase, data) })
    }

    // UUID short search: avoid ILIKE on uuid column.
    const normalizedShort = String(shortId || '').trim().toLowerCase()
    if (!normalizedShort) return json({ error: 'short_id required' }, 400)

    const { data: rows, error } = await query.order('sold_at', { ascending: false }).limit(200)
    if (error) throw error
    const found =
      (rows || []).find((row: any) => String(row?.id || '').toLowerCase().endsWith(normalizedShort)) || null
    if (!found) return json({ error: 'Чек не найден' }, 404)

    return json({ ok: true, data: await attachReturnableQuantities(supabase, found) })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/pos/return.GET', message: error?.message || 'error' })
    return json({ error: humanizeDbError(error, 'Ошибка') }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const body = await request.json().catch(() => null)
    if (!body) return json({ error: 'invalid-body' }, 400)

    const { sale_id, items, reason } = body
    if (!sale_id || !Array.isArray(items) || items.length === 0) {
      return json({ error: 'sale_id and items required' }, 400)
    }

    const { data: originalSale, error: saleError } = await supabase
      .from('point_sales')
      .select('id, company_id, location_id, shift_id, sale_date, shift, payment_method, cash_amount, kaspi_amount, kaspi_before_midnight_amount, kaspi_after_midnight_amount, total_amount, items:point_sale_items(id, item_id, quantity, unit_price, total_price)')
      .eq('id', sale_id)
      .maybeSingle()

    if (saleError) throw saleError
    if (!originalSale) return json({ error: 'Чек не найден' }, 404)
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0 || !companyScope.allowedCompanyIds.includes(String(originalSale.company_id || ''))) {
        return json({ error: 'Чек не найден' }, 404)
      }
    }

    const paymentMethod = String(originalSale.payment_method || '')
    if (!['cash', 'kaspi', 'mixed'].includes(paymentMethod)) {
      return json({ error: 'Возврат по этому типу оплаты пока не поддержан в сменном контуре' }, 400)
    }

    const saleItems = Array.isArray(originalSale.items) ? originalSale.items : []
    const soldMap = new Map<string, { item_id: string; quantity: number; unit_price: number }>()
    for (const saleItem of saleItems) {
      const key = lineKey(saleItem.item_id, saleItem.unit_price)
      const current = soldMap.get(key)
      soldMap.set(key, {
        item_id: String(saleItem.item_id),
        quantity: roundQty((current?.quantity || 0) + Number(saleItem.quantity || 0)),
        unit_price: roundMoney(saleItem.unit_price),
      })
    }

    const saleWithReturnable = await attachReturnableQuantities(supabase, originalSale)
    const returnableMap = new Map<string, number>()
    for (const saleItem of saleWithReturnable.items || []) {
      returnableMap.set(lineKey(saleItem.item_id, saleItem.unit_price), Number(saleItem.returnable_qty || 0))
    }

    const normalizedItems: Array<{ item_id: string; quantity: number; unit_price: number; comment?: string | null }> = []
    let returnTotal = 0
    for (const item of items) {
      const itemId = String(item?.item_id || '').trim()
      const quantity = roundQty(item?.quantity)
      const unitPrice = roundMoney(item?.unit_price)
      const key = lineKey(itemId, unitPrice)
      const soldLine = soldMap.get(key)
      if (!itemId || quantity <= 0 || !soldLine) {
        return json({ error: 'В возврате есть товар, которого нет в чеке' }, 400)
      }
      const returnableQty = Number(returnableMap.get(key) || 0)
      if (quantity > returnableQty + 0.0001) {
        return json({ error: `Можно вернуть не больше ${returnableQty} шт. по товару ${itemId}` }, 400)
      }
      normalizedItems.push({
        item_id: itemId,
        quantity,
        unit_price: unitPrice,
        comment: item?.comment || null,
      })
      returnTotal += quantity * unitPrice
    }

    returnTotal = roundMoney(returnTotal)
    if (returnTotal <= 0) return json({ error: 'Сумма возврата должна быть больше нуля' }, 400)

    let cashAmount = 0
    let kaspiAmount = 0
    if (paymentMethod === 'cash') {
      cashAmount = returnTotal
    } else if (paymentMethod === 'kaspi') {
      kaspiAmount = returnTotal
    } else {
      const originalCash = roundMoney(originalSale.cash_amount)
      const originalKaspi = roundMoney(originalSale.kaspi_amount)
      const originalPaid = originalCash + originalKaspi
      cashAmount = originalPaid > 0 ? roundMoney((returnTotal * originalCash) / originalPaid) : 0
      kaspiAmount = roundMoney(returnTotal - cashAmount)
    }

    const originalKaspi = roundMoney(originalSale.kaspi_amount)
    const originalKaspiBefore = roundMoney(originalSale.kaspi_before_midnight_amount)
    const kaspiBeforeMidnight = originalKaspi > 0 ? roundMoney((kaspiAmount * originalKaspiBefore) / originalKaspi) : kaspiAmount
    const kaspiAfterMidnight = roundMoney(kaspiAmount - kaspiBeforeMidnight)

    const pointReturn = await createPointInventoryReturn(supabase as any, {
      company_id: originalSale.company_id,
      location_id: originalSale.location_id,
      point_device_id: null,
      operator_id: null,
      sale_id,
      return_date: new Date().toISOString().split('T')[0],
      shift: originalSale.shift === 'night' ? 'night' : 'day',
      payment_method: paymentMethod as 'cash' | 'kaspi' | 'mixed',
      cash_amount: cashAmount,
      kaspi_amount: kaspiAmount,
      kaspi_before_midnight_amount: kaspiBeforeMidnight,
      kaspi_after_midnight_amount: kaspiAfterMidnight,
      comment: reason?.trim() || null,
      source: 'web-pos',
      local_ref: null,
      items: normalizedItems,
    })

    if (pointReturn?.return_id && originalSale.shift_id) {
      await supabase
        .from('point_returns')
        .update({ shift_id: originalSale.shift_id })
        .eq('id', pointReturn.return_id)
    }

    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      entityType: 'point-return',
      entityId: String(pointReturn?.return_id || ''),
      action: 'create.web-pos',
      payload: {
        sale_id,
        company_id: originalSale.company_id,
        location_id: originalSale.location_id,
        shift_id: originalSale.shift_id || null,
        total_amount: returnTotal,
        item_count: normalizedItems.length,
      },
    })

    return json({ ok: true, data: { return_id: pointReturn?.return_id, return_amount: returnTotal } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/pos/return.POST', message: error?.message || 'error' })
    return json({ error: humanizeDbError(error, 'Ошибка возврата') }, 500)
  }
}
