import { NextResponse } from 'next/server'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope, listOrganizationOperatorIds } from '@/lib/server/organizations'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'operators.view')
    if (denied) return denied

    const url = new URL(req.url)
    const operatorId = url.searchParams.get('operator_id') || ''
    if (!operatorId) return json({ error: 'operator_id required' }, 400)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Operator must belong to the active organization's operators.
    if (scope.allowedCompanyIds) {
      const allowedOperatorIds = await listOrganizationOperatorIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        includeInactive: true,
      })
      if (allowedOperatorIds && !allowedOperatorIds.includes(operatorId)) {
        return json({ error: 'forbidden' }, 403)
      }
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const [
      { data: operator, error: operatorError },
      { data: profile },
      { data: workHistory },
      { data: documents },
      { data: notes },
      { data: account },
      { data: companies },
      { data: staffLinks },
    ] = await Promise.all([
      supabase.from('operators').select('*').eq('id', operatorId).maybeSingle(),
      supabase.from('operator_profiles').select('*').eq('operator_id', operatorId).maybeSingle(),
      supabase
        .from('operator_work_history')
        .select('*, companies:company_id(name, code)')
        .eq('operator_id', operatorId)
        .order('start_date', { ascending: false }),
      supabase
        .from('operator_documents')
        .select('*')
        .eq('operator_id', operatorId)
        .order('created_at', { ascending: false }),
      supabase
        .from('operator_notes')
        .select('*')
        .eq('operator_id', operatorId)
        .order('created_at', { ascending: false }),
      supabase.from('operator_auth').select('*').eq('operator_id', operatorId).maybeSingle(),
      (() => {
        let companiesQuery = supabase.from('companies').select('id, name, code').order('name')
        if (scope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)
        return companiesQuery
      })(),
      // Связь оператор→staff (point_shifts.operator_id ссылается на staff, не operators).
      supabase.from('operator_staff_links').select('staff_id').eq('operator_id', operatorId),
    ])

    if (operatorError) throw operatorError
    if (!operator) return json({ error: 'Оператор не найден' }, 404)

    // История выхода на смены. point_shifts.operator_id непостоянен: у кассира
    // это может быть operators.id, а может — staff.id (смена открыта под staff_id
    // через линк). Плюс бывает, что operator_id в смене пуст, а кассир записан
    // только в audit_log открытия или в продажах смены. Поэтому собираем shift_id
    // из трёх источников и объединяем — ровно как список /store/shifts (reports).
    const staffIds = Array.from(new Set((staffLinks || []).map((l: any) => String(l.staff_id)).filter(Boolean)))
    const opMatchIds = Array.from(new Set([operatorId, ...staffIds]))
    const shiftIdSet = new Set<string>()

    // 1) прямое совпадение operator_id (operators.id или staff.id)
    const { data: directShifts } = await supabase
      .from('point_shifts')
      .select('id')
      .in('operator_id', opMatchIds)
      .limit(500)
    for (const s of directShifts || []) {
      const id = String((s as any).id || '')
      if (id) shiftIdSet.add(id)
    }

    // 2) аудит-лог открытия смены (payload.operator_id = этот оператор)
    const { data: openLogs } = await supabase
      .from('audit_log')
      .select('entity_id')
      .eq('action', 'point_shift.open')
      .contains('payload', { operator_id: operatorId })
      .limit(500)
    for (const l of openLogs || []) {
      const id = String((l as any).entity_id || '')
      if (id) shiftIdSet.add(id)
    }

    // 3) продажи этого оператора → их смены (самый надёжный сигнал по кассиру)
    const { data: saleShifts } = await supabase
      .from('point_sales')
      .select('shift_id')
      .eq('operator_id', operatorId)
      .not('shift_id', 'is', null)
      .limit(2000)
    for (const r of saleShifts || []) {
      const id = String((r as any).shift_id || '')
      if (id) shiftIdSet.add(id)
    }

    let shifts: any[] = []
    const shiftIds = Array.from(shiftIdSet)
    if (shiftIds.length) {
      let shiftsQuery = supabase
        .from('point_shifts')
        .select('id, company_id, status, shift_type, opened_at, closed_at, closing_cash, closing_kaspi, company:company_id(name, code)')
        .in('id', shiftIds)
        .order('opened_at', { ascending: false })
        .limit(300)
      // Изоляция: смены только из компаний, доступных активной организации.
      if (scope.allowedCompanyIds) shiftsQuery = shiftsQuery.in('company_id', scope.allowedCompanyIds)
      const { data: sh } = await shiftsQuery
      shifts = sh || []
    }

    // Ленивый бэкфилл: если истории работы ещё нет, но известна дата устройства
    // (operator_profiles.hire_date) — создаём запись найма при первом открытии.
    // Самолечение для операторов, заведённых до авто-записи при найме.
    let workHistoryRows = (workHistory || []) as any[]
    const hireDate = (profile as any)?.hire_date
    if (workHistoryRows.length === 0 && hireDate) {
      const { data: primaryAssign } = await supabase
        .from('operator_company_assignments')
        .select('company_id')
        .eq('operator_id', operatorId)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle()
      const { data: inserted } = await supabase
        .from('operator_work_history')
        .insert({
          operator_id: operatorId,
          company_id: (primaryAssign as any)?.company_id || null,
          position: (operator as any).role || 'Оператор',
          start_date: hireDate,
          is_current: !!(operator as any).is_active,
        })
        .select('*, companies:company_id(name, code)')
        .maybeSingle()
      if (inserted) workHistoryRows = [inserted]
    }

    return json({
      ok: true,
      data: {
        operator,
        profile: profile || null,
        workHistory: workHistoryRows.map((w: any) => ({
          ...w,
          company_name: Array.isArray(w.companies) ? w.companies[0]?.name : w.companies?.name,
          company_code: Array.isArray(w.companies) ? w.companies[0]?.code : w.companies?.code,
        })),
        documents: documents || [],
        notes: notes || [],
        account: account || null,
        companies: companies || [],
        shifts: (shifts || []).map((s: any) => ({
          ...s,
          company_name: Array.isArray(s.company) ? s.company[0]?.name : s.company?.name,
        })),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/operators/profile GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'operators.view')
    if (denied) return denied

    const body = await req.json().catch(() => null)
    const operatorId = String(body?.operator_id || '').trim()
    if (!operatorId) return json({ error: 'operator_id required' }, 400)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Operator must belong to the active organization's operators.
    if (scope.allowedCompanyIds) {
      const allowedOperatorIds = await listOrganizationOperatorIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        includeInactive: true,
      })
      if (allowedOperatorIds && !allowedOperatorIds.includes(operatorId)) {
        return json({ error: 'forbidden' }, 403)
      }
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const profilePayload: Record<string, unknown> = body?.profile && typeof body.profile === 'object'
      ? { ...(body.profile as Record<string, unknown>) }
      : {}
    // also accept top-level photo_url (sent by AvatarUpload)
    if ('photo_url' in (body ?? {})) {
      profilePayload.photo_url = body.photo_url ?? null
    }
    delete profilePayload.id
    delete profilePayload.operator_id
    delete profilePayload.created_at

    const telegramChatId =
      typeof body?.telegram_chat_id === 'string' && body.telegram_chat_id.trim()
        ? body.telegram_chat_id.trim()
        : null

    const { error: operatorError } = await supabase
      .from('operators')
      .update({ telegram_chat_id: telegramChatId })
      .eq('id', operatorId)

    if (operatorError) throw operatorError

    const { error } = await supabase
      .from('operator_profiles')
      .upsert(
        {
          operator_id: operatorId,
          ...profilePayload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'operator_id' }
      )

    if (error) throw error

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/operators/profile PATCH', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
