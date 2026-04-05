import { NextResponse } from 'next/server'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
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

    if (saleId) {
      query = query.eq('id', saleId)
    } else if (shortId) {
      query = query.ilike('id', `%${shortId}`)
    } else {
      return json({ error: 'sale_id or short_id required' }, 400)
    }

    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ error: 'Чек не найден' }, 404)
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error
    if (!data) return json({ error: 'Чек не найден' }, 404)

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/pos/return.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
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

    // Fetch original sale
    const { data: originalSale, error: saleError } = await supabase
      .from('point_sales')
      .select('id, company_id, location_id, total_amount, items:point_sale_items(id, item_id, quantity, unit_price)')
      .eq('id', sale_id)
      .maybeSingle()

    if (saleError) throw saleError
    if (!originalSale) return json({ error: 'Чек не найден' }, 404)
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0 || !companyScope.allowedCompanyIds.includes(String(originalSale.company_id || ''))) {
        return json({ error: 'Чек не найден' }, 404)
      }
    }

    // Validate return items (can't return more than sold)
    const soldMap = new Map((originalSale.items || []).map((i: any) => [i.item_id, Number(i.quantity)]))
    let returnTotal = 0
    for (const item of items) {
      const soldQty = soldMap.get(item.item_id) || 0
      if (item.quantity > soldQty) {
        return json({ error: `Количество возврата превышает проданное для товара ${item.item_id}` }, 400)
      }
      returnTotal += item.quantity * item.unit_price
    }

    // Insert return record
    const { data: returnRow, error: returnError } = await supabase
      .from('point_sale_returns')
      .insert({
        sale_id,
        company_id: originalSale.company_id,
        location_id: originalSale.location_id,
        operator_id: access.staffMember?.id || null,
        return_amount: Math.round(returnTotal * 100) / 100,
        reason: reason?.trim() || null,
        return_date: new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single()

    if (returnError) {
      // Table might not exist yet — return graceful error
      if (returnError.code === '42P01') {
        return json({ error: 'Таблица возвратов не создана — примените миграцию' }, 500)
      }
      throw returnError
    }

    // Return inventory back to location
    for (const item of items) {
      await supabase.rpc('inventory_apply_balance_delta', {
        p_location_id: originalSale.location_id,
        p_item_id: item.item_id,
        p_delta: item.quantity,
      })
    }

    return json({ ok: true, data: { return_id: returnRow.id, return_amount: returnTotal } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/pos/return.POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка возврата' }, 500)
  }
}
