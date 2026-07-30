import 'server-only'

import { buildTenantUrl } from '@/lib/core/tenant-domain'

// Данные онлайн-чека продажи (публичная страница /r/[saleId], QR на чеке продажи).

export type SaleReceiptItem = { name: string; quantity: number; unitPrice: number; total: number }

export type SaleReceipt = {
  saleId: string
  saleNumber: number
  shiftNumber: number
  cashier: string
  soldAt: string | null
  pointName: string
  requisites: { name: string; bin: string; address: string }
  items: SaleReceiptItem[]
  total: number
  cash: number
  kaspi: number
  paymentMethod: string
  onlineUrl: string
}

export async function computeSaleReceipt(supabase: any, saleId: string): Promise<SaleReceipt | null> {
  const { data: sale } = await supabase
    .from('point_sales')
    .select('id, company_id, shift_id, operator_id, sale_date, sold_at, total_amount, cash_amount, kaspi_amount, payment_method')
    .eq('id', saleId)
    .maybeSingle()
  if (!sale) return null
  const companyId = String(sale.company_id)
  const soldAt = sale.sold_at || sale.sale_date || null

  const [{ data: rs }, { data: company }, saleNumRes, itemsRes] = await Promise.all([
    supabase.from('point_receipt_settings')
      .select('tax_payer_name, tax_payer_bin, point_address')
      .eq('company_id', companyId).maybeSingle(),
    supabase.from('companies').select('name, organization_id').eq('id', companyId).maybeSingle(),
    // Порядковый номер чека по точке = сколько продаж до этой включительно.
    supabase.from('point_sales').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).lte('sold_at', soldAt || new Date().toISOString()),
    supabase.from('point_sale_items')
      .select('universal_name, quantity, unit_price, total_price, item:item_id(name)')
      .eq('sale_id', saleId),
  ])
  const saleNumber = saleNumRes?.count || 1

  // Номер смены (порядковый по точке), если продажа привязана к смене.
  let shiftNumber = 0
  if (sale.shift_id) {
    const { data: sh } = await supabase.from('point_shifts').select('company_id, opened_at').eq('id', sale.shift_id).maybeSingle()
    if (sh?.opened_at) {
      const { count } = await supabase.from('point_shifts').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).lte('opened_at', sh.opened_at)
      shiftNumber = count || 0
    }
  }

  // Кассир
  let cashier = ''
  if (sale.operator_id) {
    const { data: op } = await supabase.from('operators').select('name, short_name').eq('id', sale.operator_id).maybeSingle()
    if (op) cashier = String((op as any).short_name || (op as any).name || '')
  }

  const items: SaleReceiptItem[] = (itemsRes.data || []).map((it: any) => {
    const item = Array.isArray(it.item) ? it.item[0] : it.item
    return {
      name: String(item?.name || it.universal_name || '—'),
      quantity: Number(it.quantity || 0),
      unitPrice: Number(it.unit_price || 0),
      total: Number(it.total_price || Number(it.quantity || 0) * Number(it.unit_price || 0)),
    }
  })

  const orgSlug = String((company as any)?.organization_id
    ? await getOrgSlug(supabase, String((company as any).organization_id))
    : '')
  const onlineUrl = `${buildTenantUrl(orgSlug)}/r/${saleId}`

  return {
    saleId: String(sale.id),
    saleNumber,
    shiftNumber,
    cashier,
    soldAt,
    pointName: String((company as any)?.name || ''),
    requisites: {
      name: String((rs as any)?.tax_payer_name || ''),
      bin: String((rs as any)?.tax_payer_bin || ''),
      address: String((rs as any)?.point_address || ''),
    },
    items,
    total: Number(sale.total_amount || 0),
    cash: Number(sale.cash_amount || 0),
    kaspi: Number(sale.kaspi_amount || 0),
    paymentMethod: String(sale.payment_method || ''),
    onlineUrl,
  }
}

async function getOrgSlug(supabase: any, orgId: string): Promise<string> {
  const { data } = await supabase.from('organizations').select('slug').eq('id', orgId).maybeSingle()
  return String((data as any)?.slug || '')
}

/** Только URL онлайн-чека продажи (для ответа POST продажи, без полного расчёта). */
export async function buildSaleReceiptUrl(supabase: any, companyId: string, saleId: string): Promise<string> {
  const { data: company } = await supabase.from('companies').select('organization_id').eq('id', companyId).maybeSingle()
  const orgSlug = (company as any)?.organization_id ? await getOrgSlug(supabase, String((company as any).organization_id)) : ''
  return `${buildTenantUrl(orgSlug)}/r/${saleId}`
}
