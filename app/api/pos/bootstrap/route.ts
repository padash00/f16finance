import { NextResponse } from 'next/server'

import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { getRequestAccessContext } from '@/lib/server/request-auth'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const supabase = createAdminSupabaseClient()
    const today = new Date().toISOString().split('T')[0]

    const [
      { data: companies, error: companiesError },
      { data: locations, error: locationsError },
      { data: items, error: itemsError },
      { data: balances, error: balancesError },
      { data: customers, error: customersError },
      { data: discounts, error: discountsError },
      { data: loyaltyConfig, error: loyaltyConfigError },
    ] = await Promise.all([
      supabase.from('companies').select('id, name, code').order('name'),
      supabase
        .from('inventory_locations')
        .select('id, name, company_id, location_type')
        .eq('location_type', 'point_display')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('inventory_items')
        .select('id, name, barcode, sale_price, unit, category:category_id(id, name)')
        .eq('is_active', true)
        .order('name'),
      supabase.from('inventory_balances').select('item_id, location_id, quantity'),
      supabase.from('customers').select('id, name, phone, card_number, loyalty_points').order('name'),
      supabase
        .from('discounts')
        .select('id, name, type, value, promo_code, min_order_amount, valid_from, valid_to')
        .eq('is_active', true),
      supabase.from('loyalty_config').select('*').limit(1).maybeSingle(),
    ])

    if (companiesError) throw companiesError
    if (locationsError) throw locationsError
    if (itemsError) throw itemsError
    if (balancesError) throw balancesError
    if (customersError) throw customersError
    if (discountsError) throw discountsError
    if (loyaltyConfigError) throw loyaltyConfigError

    // Build balance maps for all point displays and for each specific location.
    const balanceMap = new Map<string, number>()
    const locationBalanceMap = new Map<string, Record<string, number>>()
    const pointDisplayLocationIds = new Set((locations || []).map((l: any) => l.id))
    for (const b of balances || []) {
      if (!pointDisplayLocationIds.has(b.location_id)) continue
      const current = balanceMap.get(b.item_id) || 0
      const quantity = Number(b.quantity || 0)
      balanceMap.set(b.item_id, current + quantity)

      const byLocation = locationBalanceMap.get(b.item_id) || {}
      byLocation[b.location_id] = quantity
      locationBalanceMap.set(b.item_id, byLocation)
    }

    // Map items with category_name and total_balance
    const mappedItems = (items || []).map((item: any) => {
      const category = Array.isArray(item.category) ? item.category[0] : item.category
      return {
        id: item.id,
        name: item.name,
        barcode: item.barcode,
        sale_price: item.sale_price,
        unit: item.unit,
        category_name: category?.name || null,
        total_balance: balanceMap.get(item.id) || 0,
        location_balances: locationBalanceMap.get(item.id) || {},
      }
    })

    // Filter discounts: valid today
    const activeDiscounts = (discounts || []).filter((d: any) => {
      if (d.valid_from && d.valid_from > today) return false
      if (d.valid_to && d.valid_to < today) return false
      return true
    }).map((d: any) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      value: d.value,
      promo_code: d.promo_code,
      min_order_amount: d.min_order_amount,
    }))

    return json({
      ok: true,
      data: {
        companies: companies || [],
        locations: locations || [],
        items: mappedItems,
        customers: (customers || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          card_number: c.card_number,
          loyalty_points: c.loyalty_points || 0,
        })),
        discounts: activeDiscounts,
        loyalty_config: loyaltyConfig || null,
      },
    })
  } catch (error: any) {
    console.error('[pos/bootstrap]', error)
    return json({ error: error?.message || 'Не удалось загрузить данные кассы' }, 500)
  }
}
