import { NextResponse } from 'next/server'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
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
    // Скоуп по точкам вешаем на КАЖДЫЙ источник, а не только на финальную
    // выборку смен: иначе admin-клиент (в обход RLS) читал смены и продажи
    // оператора, работавшего когда-то в другой организации.
    let directShiftsQuery = supabase
      .from('point_shifts')
      .select('id')
      .in('operator_id', opMatchIds)
      .limit(500)
    if (scope.allowedCompanyIds) directShiftsQuery = directShiftsQuery.in('company_id', scope.allowedCompanyIds)
    const { data: directShifts } = await directShiftsQuery
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
    let saleShiftsQuery = supabase
      .from('point_sales')
      .select('shift_id')
      .eq('operator_id', operatorId)
      .not('shift_id', 'is', null)
      .limit(2000)
    if (scope.allowedCompanyIds) saleShiftsQuery = saleShiftsQuery.in('company_id', scope.allowedCompanyIds)
    const { data: saleShifts } = await saleShiftsQuery
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
      // Точку для записи истории берём только из своих: без фильтра в
      // operator_work_history попадала (и отдавалась клиентом вместе с именем)
      // компания другой организации.
      let primaryAssignQuery = supabase
        .from('operator_company_assignments')
        .select('company_id')
        .eq('operator_id', operatorId)
        .eq('is_active', true)
      if (scope.allowedCompanyIds) primaryAssignQuery = primaryAssignQuery.in('company_id', scope.allowedCompanyIds)
      const { data: primaryAssign } = await primaryAssignQuery
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
    // PATCH — операция ЗАПИСИ (telegram_chat_id + профиль), а право спрашивалось
    // на чтение: сотрудник «только смотреть» правил чужие карточки.
    const denied = await requireStaffCapability(access, 'operators.edit')
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

/**
 * Записи в карточке оператора: документы, заметки, история работы.
 *
 * Всё это страница делала сама, запросами в Supabase из браузера: заводила
 * документ, отмечала его проверенным, удаляла, писала заметку о человеке,
 * добавляла период работы. Право на такие действия не спрашивалось — их
 * пропускала база, а не роут; принадлежность оператора организации проверялась
 * там же, то есть на стороне, которой нельзя доверять.
 *
 * Здесь одно место на все записи: право на каждое действие своё, оператор
 * обязан принадлежать организации, каждое действие пишется в журнал.
 */
export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const body = (await req.json().catch(() => null)) as Record<string, any> | null
    const action = String(body?.action || '')
    const operatorId = String(body?.operator_id || '').trim()

    // Право спрашиваем по действию: завести документ, удалить его и написать
    // заметку о человеке — решения разного веса.
    const capabilityByAction: Record<string, string> = {
      addDocument: 'operators.document_upload',
      verifyDocument: 'operators.edit',
      deleteDocument: 'operators.delete',
      addNote: 'operators.edit',
      addWorkHistory: 'operators.edit',
      endWorkHistory: 'operators.edit',
    }
    const capability = capabilityByAction[action]
    if (!capability) return json({ error: 'Неизвестное действие' }, 400)
    const denied = await requireStaffCapability(access, capability as any)
    if (denied) return denied

    if (!operatorId) return json({ error: 'operator_id required' }, 400)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
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
    const actorUserId = access.user?.id || null

    /** Документ или запись должны принадлежать этому же оператору. */
    const belongsToOperator = async (table: string, id: string) => {
      const { data } = await supabase.from(table).select('operator_id').eq('id', id).maybeSingle()
      return String((data as any)?.operator_id || '') === operatorId
    }

    if (action === 'addDocument') {
      const { data, error } = await supabase
        .from('operator_documents')
        .insert({
          operator_id: operatorId,
          document_type: body?.document_type || null,
          document_name: body?.document_name || null,
          document_url: body?.document_url || null,
          document_number: body?.document_number || null,
          issue_date: body?.issue_date || null,
          expiry_date: body?.expiry_date || null,
          is_verified: false,
        })
        .select()
        .single()
      if (error) throw error
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'operator-document',
        entityId: String(data.id),
        action: 'create',
        payload: { operator_id: operatorId, document_type: body?.document_type || null },
      })
      return json({ ok: true, data })
    }

    if (action === 'verifyDocument' || action === 'deleteDocument') {
      const documentId = String(body?.document_id || '').trim()
      if (!documentId) return json({ error: 'document_id required' }, 400)
      // Чужой документ по своему оператору не проведёшь: id приходит из тела.
      if (!(await belongsToOperator('operator_documents', documentId))) {
        return json({ error: 'Документ не найден' }, 404)
      }

      if (action === 'verifyDocument') {
        const { error } = await supabase
          .from('operator_documents')
          .update({ is_verified: true, verified_at: new Date().toISOString() })
          .eq('id', documentId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('operator_documents').delete().eq('id', documentId)
        if (error) throw error
      }

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'operator-document',
        entityId: documentId,
        action: action === 'verifyDocument' ? 'verify' : 'delete',
        payload: { operator_id: operatorId },
      })
      return json({ ok: true })
    }

    if (action === 'addNote') {
      const note = String(body?.note || '').trim()
      if (!note) return json({ error: 'Заметка пустая' }, 400)
      const { data, error } = await supabase
        .from('operator_notes')
        .insert({
          operator_id: operatorId,
          note,
          note_type: body?.note_type || 'general',
          // Автора ставит сервер: раньше браузер присылал его сам, то есть
          // подписаться можно было кем угодно.
          created_by: actorUserId,
        })
        .select()
        .single()
      if (error) throw error
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'operator-note',
        entityId: String(data.id),
        action: 'create',
        payload: { operator_id: operatorId, note_type: body?.note_type || 'general' },
      })
      return json({ ok: true, data })
    }

    if (action === 'addWorkHistory') {
      const payload: Record<string, unknown> = {
        operator_id: operatorId,
        company_id: body?.company_id || null,
        position: body?.position || null,
        start_date: body?.start_date || null,
        is_current: body?.is_current === true,
        salary: body?.salary ?? null,
        salary_type: body?.salary_type || null,
        responsibilities: body?.responsibilities || null,
        achievements: body?.achievements || null,
      }
      if (body?.is_current !== true && body?.end_date) payload.end_date = body.end_date

      const { data, error } = await supabase
        .from('operator_work_history')
        .insert(payload)
        .select('*, companies:company_id(name, code)')
        .single()
      if (error) throw error
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'operator-work-history',
        entityId: String(data.id),
        action: 'create',
        payload: { operator_id: operatorId },
      })
      return json({ ok: true, data })
    }

    if (action === 'endWorkHistory') {
      const workId = String(body?.work_id || '').trim()
      if (!workId) return json({ error: 'work_id required' }, 400)
      if (!(await belongsToOperator('operator_work_history', workId))) {
        return json({ error: 'Запись не найдена' }, 404)
      }
      const endDate = new Date().toISOString().slice(0, 10)
      const { error } = await supabase
        .from('operator_work_history')
        .update({ is_current: false, end_date: endDate })
        .eq('id', workId)
      if (error) throw error
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'operator-work-history',
        entityId: workId,
        action: 'end',
        payload: { operator_id: operatorId, end_date: endDate },
      })
      return json({ ok: true, end_date: endDate })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/operators/profile POST',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
