import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canViewHistory(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canViewHistory(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const customerId = url.searchParams.get('customer_id')?.trim()
    if (!customerId) return json({ error: 'customer_id-required' }, 400)

    const supabase = createAdminSupabaseClient()
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, company_id')
      .eq('id', customerId)
      .maybeSingle()
    if (customerError) throw customerError
    if (!customer) return json({ error: 'customer-not-found' }, 404)
    if (customer.company_id) {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId: String(customer.company_id),
      })
    }

    // Fetch sales with items using Supabase query builder
    let salesQuery = supabase
      .from('point_sales')
      .select(`
        id,
        sale_date,
        total_amount,
        discount_amount,
        cash_amount,
        kaspi_amount,
        card_amount,
        online_amount,
        loyalty_points_earned,
        loyalty_points_spent,
        created_at,
        items:point_sale_items (
          quantity,
          unit_price,
          total_price,
          item:inventory_items ( name )
        )
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (companyScope.allowedCompanyIds) {
      salesQuery = salesQuery.in('company_id', companyScope.allowedCompanyIds)
    }
    const { data: sales, error } = await salesQuery

    if (error) throw error

    // Transform items to match the expected shape
    const transformedSales = (sales || []).map((sale) => ({
      id: sale.id,
      sale_date: sale.sale_date,
      total_amount: sale.total_amount,
      discount_amount: sale.discount_amount,
      cash_amount: sale.cash_amount,
      kaspi_amount: sale.kaspi_amount,
      card_amount: sale.card_amount,
      online_amount: sale.online_amount,
      loyalty_points_earned: sale.loyalty_points_earned,
      loyalty_points_spent: sale.loyalty_points_spent,
      created_at: sale.created_at,
      items: (sale.items || []).map((si: any) => ({
        name: si.item?.name || 'Неизвестный товар',
        quantity: si.quantity,
        unit_price: si.unit_price,
        total_price: si.total_price,
      })),
    }))

    return json({ sales: transformedSales })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить историю покупок' }, 500)
  }
}
