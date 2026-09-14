import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Отметки остатка денег для /cashflow (таблица cash_balance_anchors).
 *
 *   GET                      — отметки организации
 *   POST { company_id|null, as_of_date, cash_amount, cashless_amount, note }
 *   DELETE ?id=
 *
 * Менять остаток может владелец или управляющий: это цифра, от которой
 * считаются деньги на руках всей организации.
 */

export const dynamic = 'force-dynamic'

const MIGRATION_HINT = 'Остаток денег ещё не включён: примените миграцию 20260915_cash_balance_anchors.sql в SQL Editor.'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const isMissingTable = (error: any) => {
  const text = String(error?.message || '')
  return error?.code === '42P01' || text.includes('does not exist') || text.includes('Could not find the table') || text.includes('schema cache')
}

const canEdit = (access: { isSuperAdmin: boolean; staffRole?: string | null }) =>
  access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'cashflow.view')
    if (denied) return denied
    const organizationId = access.activeOrganization?.id || null
    if (!organizationId || !hasAdminSupabaseCredentials()) return json({ ok: true, data: { anchors: [], canEdit: false, available: false } })

    const supabase = createAdminSupabaseClient()
    const scope = await resolveCompanyScope({ activeOrganizationId: organizationId, isSuperAdmin: access.isSuperAdmin })
    const { data, error } = await supabase
      .from('cash_balance_anchors')
      .select('id, company_id, as_of_date, cash_amount, cashless_amount, note, created_at')
      .eq('organization_id', organizationId)
      .order('as_of_date', { ascending: false })
    if (error) {
      if (isMissingTable(error)) return json({ ok: true, data: { anchors: [], canEdit: false, available: false, hint: MIGRATION_HINT } })
      throw error
    }
    const anchors = ((data || []) as any[]).filter((a) => !a.company_id || !scope.allowedCompanyIds || scope.allowedCompanyIds.includes(String(a.company_id)))
    return json({ ok: true, data: { anchors, canEdit: canEdit(access), available: true } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/cashflow/balance GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Не удалось загрузить остатки' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'cashflow.view')
    if (denied) return denied
    if (!canEdit(access)) return json({ error: 'Остаток может указать владелец или управляющий' }, 403)
    const organizationId = access.activeOrganization?.id || null
    if (!organizationId) return json({ error: 'Нет активной организации' }, 400)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'no admin supabase' }, 500)

    const body = await req.json().catch(() => null)
    const companyId: string | null = body?.company_id || null
    const asOfDate = String(body?.as_of_date || '')
    const cash = Number(body?.cash_amount)
    const cashless = Number(body?.cashless_amount)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return json({ error: 'Укажите дату' }, 400)
    if (!Number.isFinite(cash) || !Number.isFinite(cashless)) return json({ error: 'Суммы должны быть числами' }, 400)

    if (companyId) {
      try {
        await resolveCompanyScope({ activeOrganizationId: organizationId, isSuperAdmin: access.isSuperAdmin, requestedCompanyId: companyId })
      } catch {
        return json({ error: 'forbidden' }, 403)
      }
    }

    const supabase = createAdminSupabaseClient()
    const row = {
      organization_id: organizationId,
      company_id: companyId,
      scope_key: companyId || 'all',
      as_of_date: asOfDate,
      cash_amount: Math.round(cash * 100) / 100,
      cashless_amount: Math.round(cashless * 100) / 100,
      note: String(body?.note || '').trim() || null,
      created_by: access.user?.id || null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase
      .from('cash_balance_anchors')
      .upsert(row, { onConflict: 'organization_id,scope_key,as_of_date' })
      .select('id, company_id, as_of_date, cash_amount, cashless_amount, note')
      .single()
    if (error) {
      if (isMissingTable(error)) return json({ error: MIGRATION_HINT }, 409)
      throw error
    }
    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      entityType: 'cash-balance',
      entityId: String((data as any).id),
      action: 'upsert',
      payload: { company_id: companyId, as_of_date: asOfDate, cash, cashless },
    })
    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/cashflow/balance POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Не удалось сохранить остаток' }, 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'cashflow.view')
    if (denied) return denied
    if (!canEdit(access)) return json({ error: 'Удалить остаток может владелец или управляющий' }, 403)
    const organizationId = access.activeOrganization?.id || null
    const id = new URL(req.url).searchParams.get('id')
    if (!organizationId || !id) return json({ error: 'id required' }, 400)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'no admin supabase' }, 500)

    const supabase = createAdminSupabaseClient()
    const { error } = await supabase.from('cash_balance_anchors').delete().eq('id', id).eq('organization_id', organizationId)
    if (error) throw error
    await writeAuditLog(supabase as any, { actorUserId: access.user?.id || null, entityType: 'cash-balance', entityId: id, action: 'delete', payload: {} })
    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/cashflow/balance DELETE', message: error?.message || 'error' })
    return json({ error: error?.message || 'Не удалось удалить' }, 500)
  }
}
