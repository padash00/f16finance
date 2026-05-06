import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

type Body = { reason?: string | null }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-billing.write_off_debt')
    if (denied) return denied as any
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const body = (await request.json().catch(() => null)) as Body | null
    const reason = String(body?.reason || '').trim() || null

    let debtQuery: any = supabase
      .from('supplier_debts')
      .select('id, status, organization_id, total_amount, supplier_id, receipt_id')
      .eq('id', id)
      .limit(1)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      debtQuery = debtQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: debt, error: debtError } = await debtQuery.maybeSingle()
    if (debtError) throw debtError
    if (!debt?.id) return json({ error: 'Долг не найден' }, 404)
    if (debt.status === 'paid') return json({ error: 'Оплаченный долг нельзя списать' }, 409)
    if (debt.status === 'written_off') return json({ error: 'Долг уже списан' }, 409)

    const { error: updateError } = await supabase
      .from('supplier_debts')
      .update({
        status: 'written_off',
        payment_comment: reason,
      })
      .eq('id', debt.id)
    if (updateError) throw updateError

    await supabase
      .from('supplier_debt_payments')
      .insert([{
        debt_id: debt.id,
        organization_id: debt.organization_id || null,
        comment: reason,
        event_type: 'write_off',
        event_payload: { total: Number(debt.total_amount || 0) },
        created_by: access.user?.id || null,
      }])
      .then(() => null, () => null)

    await writeAuditLog(supabase as any, {
      action: 'supplier_debt.write_off',
      entityType: 'supplier_debt',
      entityId: debt.id,
      actorUserId: access.user?.id || null,
      payload: {
        organization_id: debt.organization_id || null,
        receipt_id: debt.receipt_id,
        supplier_id: debt.supplier_id,
        total: Number(debt.total_amount || 0),
        reason,
      },
    })

    return json({ ok: true, data: { id: debt.id } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось списать долг' }, 500)
  }
}
