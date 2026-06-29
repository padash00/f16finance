import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { writeAuditLog } from '@/lib/server/audit'
import type { PointDeviceContext } from '@/lib/server/point-devices'

export type PointOperatorLoginBody = {
  ok: true
  must_change_password: boolean
  operator: {
    auth_id: string
    operator_id: string
    username: string
    name: string | null
    short_name: string | null
    full_name: string | null
    telegram_chat_id: string | null
    role_in_company: string
    is_primary: boolean
  }
  company: { id: string; name: string; code: string | null }
  allCompanies: Array<{
    id: string
    name: string
    code: string | null
    role_in_company: string
  }>
}

export async function resolvePointOperatorLoginForDevice(params: {
  supabase: SupabaseClient
  device: PointDeviceContext['device']
  authUserId: string
  audit: {
    method: 'password' | 'qr'
    enteredUsername?: string
  }
}): Promise<
  | { ok: true; body: PointOperatorLoginBody }
  | { ok: false; error: string; status: number }
> {
  const { supabase, device, authUserId, audit } = params

  const { data: operatorAuth, error: operatorAuthError } = await supabase
    .from('operator_auth')
    .select(
      'id, user_id, operator_id, username, role, is_active, must_change_password, operator:operator_id(id, name, short_name, telegram_chat_id, is_active, operator_profiles(*))',
    )
    .eq('user_id', authUserId)
    .eq('is_active', true)
    .maybeSingle()

  if (operatorAuthError) throw operatorAuthError
  if (!operatorAuth?.operator_id) {
    return { ok: false, error: 'operator-auth-not-found', status: 404 }
  }

  if (operatorAuth.user_id && operatorAuth.user_id !== authUserId) {
    return { ok: false, error: 'operator-auth-user-mismatch', status: 403 }
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from('operator_company_assignments')
    .select('id, company_id, role_in_company, is_primary, is_active')
    .eq('operator_id', operatorAuth.operator_id)
    .eq('is_active', true)

  if (assignmentError) throw assignmentError
  if (!assignments || assignments.length === 0) {
    return { ok: false, error: 'operator-not-assigned-to-any-point', status: 403 }
  }

  const companyIds = assignments.map((a: any) => a.company_id)
  const { data: companiesData } = await supabase.from('companies').select('id, name, code').in('id', companyIds)

  const companyMap: Record<string, { id: string; name: string; code: string | null }> = {}
  for (const c of companiesData || []) {
    companyMap[c.id] = c
  }

  const operator = Array.isArray((operatorAuth as any).operator)
    ? (operatorAuth as any).operator[0] || null
    : (operatorAuth as any).operator || null
  const profile = Array.isArray(operator?.operator_profiles) ? operator.operator_profiles[0] || null : null

  if (!operator || operator.is_active === false) {
    return { ok: false, error: 'operator-inactive', status: 403 }
  }

  const projectCompanyIds = new Set(device.company_ids)
  const projectAssignments =
    projectCompanyIds.size > 0 ? assignments.filter((a: any) => projectCompanyIds.has(a.company_id)) : assignments

  if (projectAssignments.length === 0) {
    return { ok: false, error: 'operator-not-assigned-to-any-point', status: 403 }
  }

  // Schedule enforcement: when this week's schedule is published AND at least one
  // shift slot already has operator_id set, only allow the scheduled operator to log in.
  const deviceCompanyIds = Array.from(projectCompanyIds)
  if (deviceCompanyIds.length > 0) {
    const nowKZ = new Date(Date.now() + 5 * 3600_000)
    const todayKZ = `${nowKZ.getUTCFullYear()}-${String(nowKZ.getUTCMonth() + 1).padStart(2, '0')}-${String(nowKZ.getUTCDate()).padStart(2, '0')}`

    const { data: publications } = await supabase
      .from('shift_week_publications')
      .select('id, company_id')
      .in('company_id', deviceCompanyIds)
      .lte('week_start', todayKZ)
      .gte('week_end', todayKZ)

    if (publications && publications.length > 0) {
      const publishedCompanyIds = (publications as Array<{ company_id: string }>).map((p) => p.company_id)

      // Сопоставляем смену как САМО расписание: по operator_id ИЛИ по имени
      // (shifts.operator_name). Раньше проверяли только operator_id — и если у строки
      // смены имя есть, а operator_id пустой/другой, оператора блокировало, хотя в
      // графике он стоит. Берём смены с заполненным id ИЛИ именем.
      const { data: todayShifts } = await supabase
        .from('shifts')
        .select('id, operator_id, operator_name')
        .in('company_id', publishedCompanyIds)
        .eq('date', todayKZ)

      const norm = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
      const opNames = [norm((operator as any)?.name), norm((operator as any)?.short_name)].filter((x) => x.length >= 3)
      const nameMatches = (shiftName: unknown) => {
        const n = norm(shiftName)
        if (n.length < 3) return false
        return opNames.some((c) => c === n || c.includes(n) || n.includes(c))
      }

      const scheduledShifts = (todayShifts || []).filter(
        (s: any) => s.operator_id != null || String(s.operator_name || '').trim().length > 0,
      )
      if (scheduledShifts.length > 0) {
        const isScheduled = scheduledShifts.some(
          (s: any) =>
            (s.operator_id && s.operator_id === operatorAuth.operator_id) || nameMatches(s.operator_name),
        )
        if (!isScheduled) {
          return { ok: false, error: 'operator-not-scheduled-today', status: 403 }
        }
      }
    }
  }

  /** Основная точка среди всех назначений оператора (не только в этом проекте). */
  const globalPrimaryCompanyId = (assignments.find((a: any) => a.is_primary === true) as { company_id?: string } | undefined)
    ?.company_id

  const sortedProjectAssignments = [...projectAssignments].sort((a: any, b: any) => {
    const aGlob = globalPrimaryCompanyId && a.company_id === globalPrimaryCompanyId ? 0 : 1
    const bGlob = globalPrimaryCompanyId && b.company_id === globalPrimaryCompanyId ? 0 : 1
    if (aGlob !== bGlob) return aGlob - bGlob
    const pa = a.is_primary ? 0 : 1
    const pb = b.is_primary ? 0 : 1
    if (pa !== pb) return pa - pb
    const na = companyMap[a.company_id]?.name || ''
    const nb = companyMap[b.company_id]?.name || ''
    return na.localeCompare(nb, 'ru')
  })

  const primaryAssignment = sortedProjectAssignments[0]

  const allCompanies = sortedProjectAssignments.map((a: any) => {
    const co = companyMap[a.company_id]
    return {
      id: a.company_id,
      name: co?.name || 'Точка',
      code: co?.code || null,
      role_in_company: a.role_in_company,
    }
  })

  const usernameForDisplay = operatorAuth.username || audit.enteredUsername || ''

  await writeAuditLog(supabase, {
    entityType: 'point-login',
    entityId: String(operatorAuth.id),
    action: 'login',
    payload: {
      point_device_id: device.id,
      point_device_name: device.name,
      company_ids: device.company_ids,
      operator_id: operatorAuth.operator_id,
      username: usernameForDisplay,
      entered_username: audit.enteredUsername ?? usernameForDisplay,
      role_in_company: primaryAssignment.role_in_company,
      all_company_count: allCompanies.length,
      method: audit.method,
    },
  })

  const primaryCo = companyMap[primaryAssignment.company_id]
  const primaryCompany = {
    id: primaryAssignment.company_id,
    name: primaryCo?.name || 'Точка',
    code: primaryCo?.code ?? null,
  }

  const body: PointOperatorLoginBody = {
    ok: true,
    must_change_password: operatorAuth.must_change_password === true,
    operator: {
      auth_id: operatorAuth.id,
      operator_id: operatorAuth.operator_id,
      username: usernameForDisplay,
      name: operator?.name || null,
      short_name: operator?.short_name || null,
      full_name: profile?.full_name || null,
      telegram_chat_id: operator?.telegram_chat_id || null,
      role_in_company: primaryAssignment.role_in_company,
      is_primary: !!primaryAssignment.is_primary,
    },
    company: primaryCompany,
    allCompanies,
  }

  return { ok: true, body }
}
