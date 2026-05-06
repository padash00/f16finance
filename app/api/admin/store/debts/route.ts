import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-billing.view')
    if (denied) return denied as any
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const statusParam = String(url.searchParams.get('status') || 'all')
    const includeReceipts = url.searchParams.get('include_receipts') === '1'

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let debtsQuery: any = supabase
      .from('supplier_debts')
      .select(
        `id, receipt_id, supplier_id, company_id, organization_id,
         total_amount, status, due_date, is_consignment,
         payment_paid_at, payment_cash_amount, payment_kaspi_amount,
         payment_receipt_file_url, payment_comment, expense_id,
         created_at, updated_at,
         supplier:supplier_id(id, name, bin_iin, organization_name),
         company:company_id(id, name, code),
         receipt:receipt_id(id, received_at, invoice_number, invoice_file_url, total_amount,
           location:location_id(id, name, code, location_type),
           items:inventory_receipt_items(id, quantity, unit_cost, total_cost,
             item:item_id(id, name, barcode, unit)))`,
      )
      .order('created_at', { ascending: false })
      .limit(500)

    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      debtsQuery = debtsQuery.eq('organization_id', access.activeOrganization.id)
    }
    if (statusParam === 'open' || statusParam === 'paid' || statusParam === 'written_off') {
      debtsQuery = debtsQuery.eq('status', statusParam)
    } else if (statusParam === 'open_or_partial') {
      debtsQuery = debtsQuery.eq('status', 'open')
    }

    const { data: debts, error: debtsError } = await debtsQuery
    if (debtsError) throw debtsError

    let receipts: any[] = []
    if (includeReceipts) {
      let receiptsQuery: any = supabase
        .from('inventory_receipts')
        .select(
          `id, received_at, invoice_number, invoice_file_url, total_amount, comment, created_at,
           supplier:supplier_id(id, name, bin_iin, organization_name),
           location:location_id(id, name, code, location_type, organization_id, company_id),
           items:inventory_receipt_items(id, quantity, unit_cost, total_cost,
             item:item_id(id, name, barcode, unit))`,
        )
        .order('received_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      const { data: receiptRows, error: receiptsError } = await receiptsQuery
      if (receiptsError) throw receiptsError
      const allowedCompany = new Set(
        (companyScope.allowedCompanyIds || []).filter(Boolean).map((value) => String(value)),
      )
      receipts = (receiptRows || []).filter((row: any) => {
        if (access.isSuperAdmin) return true
        const orgId = row?.location?.organization_id
        if (orgId && access.activeOrganization?.id && String(orgId) === access.activeOrganization.id) return true
        const companyId = row?.location?.company_id
        if (companyId && allowedCompany.has(String(companyId))) return true
        return false
      })
    }

    return json({ ok: true, data: { debts: debts || [], receipts } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить долги' }, 500)
  }
}
