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
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

/**
 * DELETE /api/admin/store/debts/[id]
 * Полное удаление записи о долге (для ошибочных/тестовых записей).
 * Сначала чистим дочерние события оплат, затем сам долг.
 * Связанный приход (receipt) и расход (expense) НЕ удаляются.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    // Удаление — деструктивная операция; используем то же право, что и списание.
    const denied = await requireCapability(access, 'store-billing.write_off_debt')
    if (denied) return denied as any
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

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

    // Чистим дочерние события оплат (FK debt_id), best-effort.
    await supabase
      .from('supplier_debt_payments')
      .delete()
      .eq('debt_id', debt.id)
      .then(() => null, () => null)

    const { error: deleteError } = await supabase
      .from('supplier_debts')
      .delete()
      .eq('id', debt.id)
    if (deleteError) throw deleteError

    await writeAuditLog(supabase as any, {
      action: 'supplier_debt.delete',
      entityType: 'supplier_debt',
      entityId: debt.id,
      actorUserId: access.user?.id || null,
      payload: {
        organization_id: debt.organization_id || null,
        receipt_id: debt.receipt_id,
        supplier_id: debt.supplier_id,
        status: debt.status,
        total: Number(debt.total_amount || 0),
      },
    })

    return json({ ok: true, data: { id: debt.id } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось удалить долг' }, 500)
  }
}
