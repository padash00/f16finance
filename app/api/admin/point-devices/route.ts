import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type PointFeatureFlags = {
  shift_report: boolean
  income_report: boolean
  debt_report: boolean
}

type Body =
  | {
      action: 'createDevice'
      payload: {
        company_id: string
        name: string
        point_mode: string
        shift_report_chat_id?: string | null
        notes?: string | null
        feature_flags?: Partial<PointFeatureFlags> | null
      }
    }
  | {
      action: 'updateDevice'
      deviceId: string
      payload: {
        company_id: string
        name: string
        point_mode: string
        shift_report_chat_id?: string | null
        notes?: string | null
        feature_flags?: Partial<PointFeatureFlags> | null
      }
    }
  | {
      action: 'toggleDeviceActive'
      deviceId: string
      is_active: boolean
    }
  | {
      action: 'rotateDeviceToken'
      deviceId: string
    }
  | {
      action: 'deleteDevice'
      deviceId: string
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function badRequest(message: string) {
  return json({ error: message }, 400)
}

function normalizeFlags(input: Partial<PointFeatureFlags> | null | undefined): PointFeatureFlags {
  return {
    shift_report: input?.shift_report !== false,
    income_report: input?.income_report !== false,
    debt_report: input?.debt_report === true,
  }
}

function normalizeShiftReportChatId(value: string | null | undefined) {
  const chatId = String(value || '').trim()
  if (!chatId) return null
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error('Неверный формат Telegram chat ID')
  }
  return chatId
}

function mapDeviceRow(row: any) {
  const company = Array.isArray(row.company) ? row.company[0] || null : row.company || null
  return {
    ...row,
    company,
    feature_flags: normalizeFlags(row.feature_flags),
  }
}

async function getContext(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access

  if (!access.isSuperAdmin && access.staffRole !== 'owner') {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return access
}

export async function GET(request: Request) {
  try {
    const access = await getContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const [{ data: companies, error: companiesError }, { data: devices, error: devicesError }] = await Promise.all([
      supabase.from('companies').select('id, name, code').order('name', { ascending: true }),
      supabase
        .from('point_devices')
        .select('id, company_id, name, device_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, last_seen_at, created_at, updated_at, company:company_id(id, name, code)')
        .order('created_at', { ascending: false }),
    ])

    if (companiesError) throw companiesError
    if (devicesError) throw devicesError

    return json({
      ok: true,
      data: {
        companies: companies || [],
        devices: ((devices || []) as any[]).map(mapDeviceRow),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/point-devices:get',
      message: error?.message || 'Point devices GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить устройства точек' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const body = (await request.json().catch(() => null)) as Body | null
    if (!body?.action) return badRequest('Неверный формат запроса')

    if (body.action === 'createDevice') {
      if (!body.payload.company_id?.trim()) return badRequest('Нужно выбрать точку')
      if (!body.payload.name?.trim()) return badRequest('Название устройства обязательно')
      if (!body.payload.point_mode?.trim()) return badRequest('Режим точки обязателен')

      // Генерируем токен с 256 бит энтропии на сервере
      const initialToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const { data, error } = await supabase
        .from('point_devices')
        .insert([
          {
            company_id: body.payload.company_id,
            name: body.payload.name.trim(),
            shift_report_chat_id: normalizeShiftReportChatId(body.payload.shift_report_chat_id),
            point_mode: body.payload.point_mode.trim(),
            notes: body.payload.notes?.trim() || null,
            feature_flags: normalizeFlags(body.payload.feature_flags),
            device_token: initialToken,
          },
        ])
        .select('id, company_id, name, device_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, last_seen_at, created_at, updated_at, company:company_id(id, name, code)')
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'point-device',
        entityId: String(data.id),
        action: 'create',
        payload: {
          company_id: data.company_id,
          name: data.name,
          shift_report_chat_id: data.shift_report_chat_id || null,
          point_mode: data.point_mode,
          feature_flags: normalizeFlags(data.feature_flags),
        },
      })

      return json({ ok: true, data: mapDeviceRow(data) })
    }

    if (!body.deviceId?.trim()) return badRequest('deviceId обязателен')

    if (body.action === 'updateDevice') {
      if (!body.payload.company_id?.trim()) return badRequest('Нужно выбрать точку')
      if (!body.payload.name?.trim()) return badRequest('Название устройства обязательно')
      if (!body.payload.point_mode?.trim()) return badRequest('Режим точки обязателен')

      const { data, error } = await supabase
        .from('point_devices')
        .update({
          company_id: body.payload.company_id,
          name: body.payload.name.trim(),
          shift_report_chat_id: normalizeShiftReportChatId(body.payload.shift_report_chat_id),
          point_mode: body.payload.point_mode.trim(),
          notes: body.payload.notes?.trim() || null,
          feature_flags: normalizeFlags(body.payload.feature_flags),
        })
        .eq('id', body.deviceId)
        .select('id, company_id, name, device_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, last_seen_at, created_at, updated_at, company:company_id(id, name, code)')
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'point-device',
        entityId: String(data.id),
        action: 'update',
        payload: {
          company_id: data.company_id,
          name: data.name,
          shift_report_chat_id: data.shift_report_chat_id || null,
          point_mode: data.point_mode,
          feature_flags: normalizeFlags(data.feature_flags),
        },
      })

      return json({ ok: true, data: mapDeviceRow(data) })
    }

    if (body.action === 'toggleDeviceActive') {
      const { data, error } = await supabase
        .from('point_devices')
        .update({ is_active: body.is_active })
        .eq('id', body.deviceId)
        .select('id, company_id, name, device_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, last_seen_at, created_at, updated_at, company:company_id(id, name, code)')
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'point-device',
        entityId: String(data.id),
        action: body.is_active ? 'activate' : 'deactivate',
        payload: {
          name: data.name,
          company_id: data.company_id,
        },
      })

      return json({ ok: true, data: mapDeviceRow(data) })
    }

    if (body.action === 'rotateDeviceToken') {
      // 256 бит энтропии вместо ~122 бит UUID v4
      const nextToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const { data, error } = await supabase
        .from('point_devices')
        .update({ device_token: nextToken })
        .eq('id', body.deviceId)
        .select('id, company_id, name, device_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, last_seen_at, created_at, updated_at, company:company_id(id, name, code)')
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'point-device',
        entityId: String(data.id),
        action: 'rotate-token',
        payload: {
          name: data.name,
          company_id: data.company_id,
        },
      })

      return json({ ok: true, data: mapDeviceRow(data) })
    }

    const { error } = await supabase.from('point_devices').delete().eq('id', body.deviceId)
    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId,
      entityType: 'point-device',
      entityId: body.deviceId,
      action: 'delete',
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/point-devices:post',
      message: error?.message || 'Point devices POST error',
    })
    return json({ error: error?.message || 'Не удалось сохранить устройство точки' }, 500)
  }
}
