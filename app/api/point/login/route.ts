import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { normalizeOperatorUsername, toOperatorAuthEmail } from '@/lib/core/auth'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { requirePointDevice } from '@/lib/server/point-devices'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

type LoginBody = {
  username?: string
  password?: string
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    // Rate limit: 20 login attempts per IP per minute
    const ip = getClientIp(request)
    const rl = checkRateLimit(`point-login:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      return json({ error: 'too-many-requests' }, 429)
    }

    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const body = (await request.json().catch(() => null)) as LoginBody | null
    const username = normalizeOperatorUsername(body?.username || '')
    const password = (body?.password || '').trim()

    if (!username) return json({ error: 'username-required' }, 400)
    if (!password) return json({ error: 'password-required' }, 400)

    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || requiredEnv('SUPABASE_URL'),
      requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )

    const { data: authData, error: signInError } = await authClient.auth.signInWithPassword({
      email: toOperatorAuthEmail(username),
      password,
    })

    if (signInError || !authData.user) {
      return json({ error: 'invalid-credentials' }, 401)
    }

    const { data: operatorAuth, error: operatorAuthError } = await supabase
      .from('operator_auth')
      .select('id, user_id, operator_id, username, role, is_active, must_change_password, operator:operator_id(id, name, short_name, telegram_chat_id, is_active, operator_profiles(*))')
      .eq('user_id', authData.user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (operatorAuthError) throw operatorAuthError
    if (!operatorAuth?.operator_id) {
      return json({ error: 'operator-auth-not-found' }, 404)
    }

    if (operatorAuth.user_id && operatorAuth.user_id !== authData.user.id) {
      return json({ error: 'operator-auth-user-mismatch' }, 403)
    }

    const { data: assignments, error: assignmentError } = await supabase
      .from('operator_company_assignments')
      .select('id, company_id, role_in_company, is_primary, is_active')
      .eq('operator_id', operatorAuth.operator_id)
      .eq('is_active', true)

    if (assignmentError) throw assignmentError
    if (!assignments || assignments.length === 0) {
      return json({ error: 'operator-not-assigned-to-any-point' }, 403)
    }

    const companyIds = assignments.map((a: any) => a.company_id)
    const { data: companiesData } = await supabase
      .from('companies')
      .select('id, name, code')
      .in('id', companyIds)

    const companyMap: Record<string, { id: string; name: string; code: string | null }> = {}
    for (const c of companiesData || []) {
      companyMap[c.id] = c
    }

    const operator = Array.isArray((operatorAuth as any).operator)
      ? (operatorAuth as any).operator[0] || null
      : (operatorAuth as any).operator || null
    const profile = Array.isArray(operator?.operator_profiles) ? operator.operator_profiles[0] || null : null

    // Filter operator's companies to only those in the project
    const projectCompanyIds = new Set(device.company_ids)
    const projectAssignments = projectCompanyIds.size > 0
      ? assignments.filter((a: any) => projectCompanyIds.has(a.company_id))
      : assignments

    if (projectAssignments.length === 0) {
      return json({ error: 'operator-not-assigned-to-any-point' }, 403)
    }

    const primaryAssignment =
      projectAssignments.find((a: any) => a.is_primary) ||
      projectAssignments[0]

    const allCompanies = projectAssignments.map((a: any) => {
      const co = companyMap[a.company_id]
      return {
        id: a.company_id,
        name: co?.name || 'Точка',
        code: co?.code || null,
        role_in_company: a.role_in_company,
      }
    })

    await writeAuditLog(supabase, {
      entityType: 'point-login',
      entityId: String(operatorAuth.id),
      action: 'login',
      payload: {
        point_device_id: device.id,
        point_device_name: device.name,
        company_ids: device.company_ids,
        operator_id: operatorAuth.operator_id,
        username: operatorAuth.username || username,
        entered_username: username,
        role_in_company: primaryAssignment.role_in_company,
        all_company_count: allCompanies.length,
      },
    })

    await authClient.auth.signOut().catch(() => null)

    const primaryCo = companyMap[primaryAssignment.company_id]
    const primaryCompany = {
      id: primaryAssignment.company_id,
      name: primaryCo?.name || 'Точка',
      code: primaryCo?.code ?? null,
    }

    return json({
      ok: true,
      must_change_password: operatorAuth.must_change_password === true,
      operator: {
        auth_id: operatorAuth.id,
        operator_id: operatorAuth.operator_id,
        username: operatorAuth.username || username,
        name: operator?.name || null,
        short_name: operator?.short_name || null,
        full_name: profile?.full_name || null,
        telegram_chat_id: operator?.telegram_chat_id || null,
        role_in_company: primaryAssignment.role_in_company,
        is_primary: !!primaryAssignment.is_primary,
      },
      company: primaryCompany,
      allCompanies,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-login',
      message: error?.message || 'Point login error',
    })
    return json({ error: error?.message || 'Не удалось выполнить вход в программу точки' }, 500)
  }
}
