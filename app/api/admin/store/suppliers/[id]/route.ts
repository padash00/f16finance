import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    let supplierQuery: any = supabase
      .from('inventory_suppliers')
      .select('id, name, organization_name, bin_iin, contact_name, phone, notes, sales_rep_name, sales_rep_phone, lead_time_days, organization_id, preferred_expense_category_id, created_at')
      .eq('id', id)
      .limit(1)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      supplierQuery = supplierQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: supplier, error: supplierError } = await supplierQuery.maybeSingle()
    if (supplierError) throw supplierError
    if (!supplier?.id) return json({ error: 'Поставщик не найден' }, 404)

    const [receiptsRes, debtsRes, aliasesRes, preferredCategoryRes] = await Promise.all([
      supabase
        .from('inventory_receipts')
        .select('id, received_at, invoice_number, invoice_file_url, total_amount, comment, location:location_id(id, name, code, location_type), items:inventory_receipt_items(id)')
        .eq('supplier_id', id)
        .order('received_at', { ascending: false })
        .limit(200),
      supabase
        .from('supplier_debts')
        .select('id, receipt_id, total_amount, status, due_date, is_consignment, payment_paid_at, payment_cash_amount, payment_kaspi_amount, created_at')
        .eq('supplier_id', id)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('invoice_name_mappings')
        .select('id, invoice_name, item_id, last_unit_cost, last_sale_price, usage_count, last_seen_at, item:item_id(name, barcode)')
        .eq('supplier_id', id)
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(500),
      supplier.preferred_expense_category_id
        ? supabase
            .from('expense_categories')
            .select('id, name')
            .eq('id', supplier.preferred_expense_category_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    if (receiptsRes.error) throw receiptsRes.error
    if (debtsRes.error) throw debtsRes.error
    if (aliasesRes.error) throw aliasesRes.error

    const receipts = receiptsRes.data || []
    const debts = debtsRes.data || []
    const aliases = aliasesRes.data || []

    // Товары, закреплённые за этим поставщиком, с текущим остатком (сумма по всем локациям).
    const { data: productRows, error: productsError } = await supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, default_purchase_price, low_stock_threshold, is_active')
      .eq('primary_supplier_id', id)
      .order('name', { ascending: true })
    if (productsError) throw productsError
    const productItemIds = (productRows || []).map((p: any) => p.id)
    const stockByItem = new Map<string, number>()
    if (productItemIds.length > 0) {
      const { data: balanceRows, error: balanceError } = await supabase
        .from('inventory_balances')
        .select('item_id, quantity')
        .in('item_id', productItemIds)
      if (balanceError) throw balanceError
      for (const row of (balanceRows || []) as any[]) {
        const key = String(row.item_id)
        stockByItem.set(key, (stockByItem.get(key) || 0) + Number(row.quantity || 0))
      }
    }
    const products = (productRows || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      barcode: p.barcode,
      unit: p.unit,
      default_purchase_price: Number(p.default_purchase_price || 0),
      low_stock_threshold: p.low_stock_threshold != null ? Number(p.low_stock_threshold) : null,
      is_active: p.is_active !== false,
      stock: stockByItem.get(String(p.id)) || 0,
    }))

    const totalSpend = receipts.reduce((sum: number, r: any) => sum + Number(r.total_amount || 0), 0)
    const openDebtsSum = debts
      .filter((d: any) => d.status === 'open')
      .reduce((sum: number, d: any) => sum + Number(d.total_amount || 0), 0)
    const paidDebts = debts.filter((d: any) => d.status === 'paid' && d.payment_paid_at && d.created_at)
    const avgDaysToPay = paidDebts.length > 0
      ? Math.round(
          paidDebts.reduce((sum: number, d: any) => {
            const created = new Date(d.created_at).getTime()
            const paid = new Date(d.payment_paid_at).getTime()
            return sum + Math.max(0, (paid - created) / 86_400_000)
          }, 0) / paidDebts.length,
        )
      : null

    return json({
      ok: true,
      data: {
        supplier: {
          ...supplier,
          preferred_expense_category_name: (preferredCategoryRes as any)?.data?.name || null,
        },
        receipts,
        debts,
        aliases,
        products,
        stats: {
          totalSpend,
          openDebtsSum,
          openDebtsCount: debts.filter((d: any) => d.status === 'open').length,
          receiptsCount: receipts.length,
          aliasesCount: aliases.length,
          productsCount: products.length,
          avgDaysToPay,
        },
      },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить поставщика' }, 500)
  }
}
