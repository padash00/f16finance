import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
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

type Body = { due_date?: string | null; reason?: string | null }

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const body = (await request.json().catch(() => null)) as Body | null
    const newDueDate = String(body?.due_date || '').trim() || null
    const reason = String(body?.reason || '').trim() || null

    let debtQuery: any = supabase
      .from('supplier_debts')
      .select('id, status, organization_id, due_date, supplier_id, receipt_id')
      .eq('id', id)
      .limit(1)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      debtQuery = debtQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: debt, error: debtError } = await debtQuery.maybeSingle()
    if (debtError) throw debtError
    if (!debt?.id) return json({ error: 'Долг не найден' }, 404)
    if (debt.status !== 'open') return json({ error: 'Срок переносится только у открытых долгов' }, 409)

    const previous = debt.due_date

    const { error: updateError } = await supabase
      .from('supplier_debts')
      .update({ due_date: newDueDate })
      .eq('id', debt.id)
    if (updateError) throw updateError

    await supabase
      .from('supplier_debt_payments')
      .insert([{
        debt_id: debt.id,
        organization_id: debt.organization_id || null,
        comment: reason,
        event_type: 'due_date_change',
        event_payload: { previous_due_date: previous, new_due_date: newDueDate },
        created_by: access.user?.id || null,
      }])
      .then(() => null, () => null)

    await writeAuditLog(supabase as any, {
      action: 'supplier_debt.due_date_change',
      entityType: 'supplier_debt',
      entityId: debt.id,
      actorUserId: access.user?.id || null,
      payload: {
        organization_id: debt.organization_id || null,
        receipt_id: debt.receipt_id,
        supplier_id: debt.supplier_id,
        previous_due_date: previous,
        new_due_date: newDueDate,
        reason,
      },
    })

    return json({ ok: true, data: { id: debt.id, due_date: newDueDate } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось перенести срок' }, 500)
  }
}
