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
      .select('id, user_id, operator_id, username, role, is_active, operator:operator_id(id, name, short_name, telegram_chat_id, is_active, operator_profiles(*))')
      .eq('username', username)
      .eq('is_active', true)
      .maybeSingle()

    if (operatorAuthError) throw operatorAuthError
    if (!operatorAuth?.operator_id) {
      return json({ error: 'operator-auth-not-found' }, 404)
    }

    if (operatorAuth.user_id && operatorAuth.user_id !== authData.user.id) {
      return json({ error: 'operator-auth-user-mismatch' }, 403)
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from('operator_company_assignments')
      .select('id, company_id, role_in_company, is_primary, is_active')
      .eq('operator_id', operatorAuth.operator_id)
      .eq('company_id', device.company_id)
      .eq('is_active', true)
      .maybeSingle()

    if (assignmentError) throw assignmentError
    if (!assignment) {
      return json({ error: 'operator-not-assigned-to-device-point' }, 403)
    }

    const operator = Array.isArray((operatorAuth as any).operator)
      ? (operatorAuth as any).operator[0] || null
      : (operatorAuth as any).operator || null
    const profile = Array.isArray(operator?.operator_profiles) ? operator.operator_profiles[0] || null : null

    await writeAuditLog(supabase, {
      entityType: 'point-login',
      entityId: String(operatorAuth.id),
      action: 'login',
      payload: {
        point_device_id: device.id,
        point_device_name: device.name,
        company_id: device.company_id,
        operator_id: operatorAuth.operator_id,
        username,
        role_in_company: assignment.role_in_company,
      },
    })

    await authClient.auth.signOut().catch(() => null)

    return json({
      ok: true,
      operator: {
        auth_id: operatorAuth.id,
        operator_id: operatorAuth.operator_id,
        username,
        name: operator?.name || null,
        short_name: operator?.short_name || null,
        full_name: profile?.full_name || null,
        telegram_chat_id: operator?.telegram_chat_id || null,
        role_in_company: assignment.role_in_company,
        is_primary: !!assignment.is_primary,
      },
      company: {
        id: device.company_id,
        name: device.company?.name || 'Точка',
        code: device.company?.code || null,
      },
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
