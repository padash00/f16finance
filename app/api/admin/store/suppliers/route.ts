import { NextResponse } from 'next/server'

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
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    let query: any = supabase
      .from('inventory_suppliers')
      .select('id, name, organization_name, bin_iin, contact_name, phone, organization_id, preferred_expense_category_id, created_at')
      .order('name', { ascending: true })
      .limit(500)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      query = query.eq('organization_id', access.activeOrganization.id)
    }
    const { data: suppliers, error } = await query
    if (error) throw error

    const supplierIds = (suppliers || []).map((s: any) => s.id)
    let receiptStats = new Map<string, { count: number; total: number; last: string | null }>()
    let debtStats = new Map<string, { open: number; openSum: number }>()
    let aliasCounts = new Map<string, number>()

    if (supplierIds.length > 0) {
      const [receiptsRes, debtsRes, aliasesRes] = await Promise.all([
        supabase
          .from('inventory_receipts')
          .select('supplier_id, total_amount, received_at')
          .in('supplier_id', supplierIds),
        supabase
          .from('supplier_debts')
          .select('supplier_id, total_amount, status')
          .in('supplier_id', supplierIds),
        supabase
          .from('invoice_name_mappings')
          .select('supplier_id')
          .in('supplier_id', supplierIds),
      ])

      for (const row of (receiptsRes.data || []) as any[]) {
        const key = String(row.supplier_id)
        const cur = receiptStats.get(key) || { count: 0, total: 0, last: null }
        cur.count += 1
        cur.total += Number(row.total_amount || 0)
        if (!cur.last || (row.received_at && row.received_at > cur.last)) cur.last = row.received_at
        receiptStats.set(key, cur)
      }
      for (const row of (debtsRes.data || []) as any[]) {
        const key = String(row.supplier_id)
        const cur = debtStats.get(key) || { open: 0, openSum: 0 }
        if (row.status === 'open') {
          cur.open += 1
          cur.openSum += Number(row.total_amount || 0)
        }
        debtStats.set(key, cur)
      }
      for (const row of (aliasesRes.data || []) as any[]) {
        const key = String(row.supplier_id)
        aliasCounts.set(key, (aliasCounts.get(key) || 0) + 1)
      }
    }

    const enriched = (suppliers || []).map((s: any) => {
      const r = receiptStats.get(s.id) || { count: 0, total: 0, last: null }
      const d = debtStats.get(s.id) || { open: 0, openSum: 0 }
      return {
        ...s,
        receipts_count: r.count,
        receipts_total: r.total,
        last_receipt_date: r.last,
        open_debts_count: d.open,
        open_debts_sum: d.openSum,
        aliases_count: aliasCounts.get(s.id) || 0,
      }
    })

    return json({ ok: true, data: { suppliers: enriched } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить поставщиков' }, 500)
  }
}
