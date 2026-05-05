import { NextResponse } from 'next/server'

import { getRequestCustomerContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))]
}

/** Read-only витрина: товары организаций, к чьим точкам привязан гость. Остатки — витрина = catalog - warehouse по компании. */
export async function GET(request: Request) {
  try {
    const context = await getRequestCustomerContext(request)
    if ('response' in context) return context.response

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'client-api-requires-admin-credentials' }, 503)
    }

    const url = new URL(request.url)
    const requestedCompany = url.searchParams.get('companyId')?.trim() || null
    const linkedCompanyIds = uniqueStrings(context.linkedCompanyIds)

    if (requestedCompany && !linkedCompanyIds.includes(requestedCompany)) {
      return json({ error: 'company-not-in-profile' }, 400)
    }

    const companyIds = requestedCompany ? [requestedCompany] : linkedCompanyIds
    if (!companyIds.length) {
      return json({ ok: true, label: 'Orda Market', companies: [], items: [] })
    }

    const admin = createAdminSupabaseClient()

    const { data: companyRows, error: companiesError } = await admin
      .from('companies')
      .select('id, name, organization_id')
      .in('id', companyIds)

    if (companiesError) throw companiesError

    const companies = (companyRows || []).map((c: any) => ({
      id: String(c.id),
      name: String(c.name || 'Точка'),
      organization_id: c.organization_id ? String(c.organization_id) : null,
    }))

    const orgIds = uniqueStrings(
      companies.map((c) => c.organization_id).filter((id): id is string => Boolean(id)),
    )
    if (!orgIds.length) {
      return json({ ok: true, label: 'Orda Market', companies, items: [] })
    }

    const { data: itemRows, error: itemsError } = await admin
      .from('inventory_items')
      .select(
        'id, name, barcode, sale_price, unit, item_type, organization_id, category:inventory_categories(id, name)',
      )
      .in('organization_id', orgIds)
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (itemsError) throw itemsError

    // v2: витрина читается напрямую из point_display, без формулы.
    const { data: locRows, error: locError } = await admin
      .from('inventory_locations')
      .select('id, company_id, location_type')
      .in('company_id', companyIds)
      .eq('location_type', 'point_display')
      .eq('is_active', true)

    if (locError) throw locError

    const showcaseLocIds: string[] = (locRows || []).map((r: any) => String(r.id)).filter(Boolean)
    const qtyByItem: Record<string, number> = {}

    if (showcaseLocIds.length) {
      const { data: balRows, error: balError } = await admin
        .from('inventory_balances')
        .select('item_id, quantity')
        .in('location_id', showcaseLocIds)

      if (balError) throw balError

      for (const row of balRows || []) {
        const itemId = String((row as any).item_id || '')
        const qty = Number((row as any).quantity || 0)
        if (!itemId || qty <= 0) continue
        qtyByItem[itemId] = (qtyByItem[itemId] || 0) + qty
      }
    }

    const orgToCompanies = new Map<string, string[]>()
    for (const c of companies) {
      if (!c.organization_id) continue
      const list = orgToCompanies.get(c.organization_id) || []
      list.push(c.name)
      orgToCompanies.set(c.organization_id, list)
    }

    const items = (itemRows || []).map((row: any) => {
      const cat = Array.isArray(row.category) ? row.category[0] || null : row.category || null
      const oid = row.organization_id ? String(row.organization_id) : ''
      return {
        id: String(row.id),
        name: String(row.name || ''),
        barcode: String(row.barcode || ''),
        sale_price: Number(row.sale_price || 0),
        unit: String(row.unit || 'шт'),
        item_type: String(row.item_type || 'product'),
        organization_id: oid || null,
        company_hint: oid ? (orgToCompanies.get(oid) || []).join(' · ') || null : null,
        category: cat ? { id: String(cat.id), name: String(cat.name || '') } : null,
        qty_on_display: Math.round((qtyByItem[String(row.id)] || 0) * 1000) / 1000,
      }
    })

    return json({
      ok: true,
      label: 'Orda Market',
      companies: companies.map(({ id, name }) => ({ id, name })),
      items,
    })
  } catch (error: any) {
    return json({ error: error?.message || 'client-catalog-failed' }, 500)
  }
}
