import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { isAdminEmail } from '@/lib/server/admin'
import { requiredEnv } from '@/lib/server/env'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  email?: string
  password?: string
  action?: 'updateShiftReportChatId' | 'updateDeviceSettings'
  deviceId?: string
  shift_report_chat_id?: string | null
  feature_flags?: {
    kaspi_daily_split?: boolean
  } | null
}

function normalizeFlags(input: Record<string, unknown> | null | undefined) {
  return {
    shift_report: input?.shift_report !== false,
    income_report: input?.income_report !== false,
    debt_report: input?.debt_report === true,
    kaspi_daily_split: input?.kaspi_daily_split === true,
  }
}

function normalizeShiftReportChatId(value: string | null | undefined) {
  const chatId = String(value || '').trim()
  if (!chatId) return null
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error('invalid-shift-report-chat-id')
  }
  return chatId
}

async function requireSuperAdmin(email: string, password: string) {
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

  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    throw new Error('invalid-credentials')
  }

  if (!isAdminEmail(data.user.email)) {
    throw new Error('super-admin-only')
  }

  await authClient.auth.signOut().catch(() => null)
}

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'point-api-disabled' }, 503)
    }

    const body = (await request.json().catch(() => null)) as Body | null
    const email = String(body?.email || '').trim().toLowerCase()
    const password = String(body?.password || '').trim()

    if (!email) return json({ error: 'email-required' }, 400)
    if (!password) return json({ error: 'password-required' }, 400)

    await requireSuperAdmin(email, password)

    const supabase = createAdminSupabaseClient()

    if (body?.action === 'updateShiftReportChatId' || body?.action === 'updateDeviceSettings') {
      const deviceId = String(body.deviceId || '').trim()
      if (!deviceId) return json({ error: 'device-id-required' }, 400)

      const { data: existing, error: existingError } = await supabase
        .from('point_devices')
        .select('feature_flags')
        .eq('id', deviceId)
        .single()

      if (existingError) throw existingError

      const nextFlags = normalizeFlags((existing as any)?.feature_flags)
      if (body.feature_flags && typeof body.feature_flags.kaspi_daily_split === 'boolean') {
        nextFlags.kaspi_daily_split = body.feature_flags.kaspi_daily_split === true
      }

      const { data, error } = await supabase
        .from('point_devices')
        .update({
          shift_report_chat_id: normalizeShiftReportChatId(body.shift_report_chat_id),
          feature_flags: nextFlags,
        })
        .eq('id', deviceId)
        .select('id, company_id, name, device_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, last_seen_at, created_at, updated_at, company:company_id(id, name, code)')
        .single()

      if (error) throw error

      return json({
        ok: true,
        data: {
          device: {
            ...data,
            company: Array.isArray((data as any).company) ? (data as any).company[0] || null : (data as any).company || null,
            feature_flags: normalizeFlags((data as any).feature_flags),
          },
        },
      })
    }

    const { data, error } = await supabase
      .from('point_devices')
      .select('id, company_id, name, device_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, last_seen_at, created_at, updated_at, company:company_id(id, name, code)')
      .order('created_at', { ascending: false })

    if (error) throw error

    const devices = ((data || []) as any[]).map((row) => ({
      ...row,
      company: Array.isArray(row.company) ? row.company[0] || null : row.company || null,
      feature_flags: normalizeFlags(row.feature_flags),
    }))

    return json({
      ok: true,
      data: {
        devices,
      },
    })
  } catch (error: any) {
    const message = error?.message || 'Point admin devices error'
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-admin-devices',
      message,
    })
    if (message === 'invalid-shift-report-chat-id') return json({ error: message }, 400)
    if (message === 'invalid-credentials') return json({ error: message }, 401)
    if (message === 'super-admin-only') return json({ error: message }, 403)
    return json({ error: message || 'Не удалось загрузить устройства для super-admin' }, 500)
  }
}
