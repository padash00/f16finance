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

    let query: any = supabase
      .from('supplier_debt_payments')
      .select('id, debt_id, paid_at, cash_amount, kaspi_amount, receipt_file_url, comment, expense_id, event_type, event_payload, created_at')
      .eq('debt_id', id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      query = query.eq('organization_id', access.activeOrganization.id)
    }

    const { data, error } = await query
    if (error) throw error
    return json({ ok: true, data: { events: data || [] } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить историю долга' }, 500)
  }
}
