import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
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
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedCompanyIds = companyScope.allowedCompanyIds

    if (allowedCompanyIds !== null && allowedCompanyIds.length === 0) {
      return json({
        ok: true,
        data: {
          companies: [],
          locations: [],
          items: [],
          customers: [],
          discounts: [],
          loyalty_config: null,
        },
      })
    }

    let companiesQuery = supabase.from('companies').select('id, name, code').order('name')
    let locationsQuery = supabase
      .from('inventory_locations')
      .select('id, name, company_id, location_type')
      .eq('location_type', 'point_display')
      .eq('is_active', true)
      .order('name')
    let itemsQuery = supabase
      .from('inventory_items')
      .select('id, name, barcode, sale_price, unit, organization_id, category:category_id(id, name)')
      .eq('is_active', true)
      .order('name')
    let customersQuery = supabase
      .from('customers')
      .select('id, name, phone, card_number, loyalty_points, company_id')
      .order('name')

    if (allowedCompanyIds !== null) {
      companiesQuery = companiesQuery.in('id', allowedCompanyIds)
      locationsQuery = locationsQuery.in('company_id', allowedCompanyIds)
      customersQuery = customersQuery.in('company_id', allowedCompanyIds)
    }

    if (access.activeOrganization?.id && !access.isSuperAdmin) {
      itemsQuery = itemsQuery.or(`organization_id.eq.${access.activeOrganization.id},organization_id.is.null`)
    }

    const [
      { data: companies, error: companiesError },
      { data: locations, error: locationsError },
      { data: items, error: itemsError },
      { data: customers, error: customersError },
      { data: discounts, error: discountsError },
    ] = await Promise.all([
      companiesQuery,
      locationsQuery,
      itemsQuery,
      customersQuery,
      supabase
        .from('discounts')
        .select('id, name, type, value, promo_code, min_order_amount, valid_from, valid_to, company_id')
        .eq('is_active', true),
    ])

    if (companiesError) throw companiesError
    if (locationsError) throw locationsError
    if (itemsError) throw itemsError
    if (customersError) throw customersError
    if (discountsError) throw discountsError

    // v2: showcase читается напрямую из point_display.
    // pdLocIds — все активные локации витрин
    const pdLocIds = new Set((locations || []).map((l) => String(l.id)))
    const { data: balances, error: balancesError } =
      pdLocIds.size > 0
        ? await supabase
            .from('inventory_balances')
            .select('item_id, location_id, quantity')
            .in('location_id', Array.from(pdLocIds))
        : { data: [], error: null }
    if (balancesError) throw balancesError

    const loyaltyCompanyId = String(
      (locations || [])[0]?.company_id || (companies || [])[0]?.id || '',
    ).trim()
    const { data: loyaltyConfig, error: loyaltyConfigError } = loyaltyCompanyId
      ? await supabase.from('loyalty_config').select('*').eq('company_id', loyaltyCompanyId).maybeSingle()
      : { data: null, error: null }
    if (loyaltyConfigError) throw loyaltyConfigError

    const balanceMap = new Map<string, number>()
    const locationBalanceMap = new Map<string, Record<string, number>>()
    for (const b of balances || []) {
      if (!pdLocIds.has(String(b.location_id))) continue
      const qty = Number(b.quantity || 0)
      if (qty <= 0) continue
      const current = balanceMap.get(b.item_id) || 0
      balanceMap.set(b.item_id, current + qty)
      const byLocation = locationBalanceMap.get(b.item_id) || {}
      byLocation[b.location_id] = qty
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
      if (allowedCompanyIds !== null && d.company_id && !allowedCompanyIds.includes(String(d.company_id))) return false
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
