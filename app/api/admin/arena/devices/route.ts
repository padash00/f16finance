/**
 * Подтверждение и отзыв наблюдающих устройств.
 *
 * Это та самая дверь, ради которой общий ключ регистрации не даёт права
 * писать. Пока человек не нажал «Подтвердить», устройство не может прислать
 * ни одного наблюдения.
 *
 * Станцию выбирает человек. Никакого сопоставления по номерам: у клуба имена
 * станций идут диапазонами (111, 666, 801–805), и правило «имя равно номеру
 * рабочей станции» дало бы уверенно неверную привязку на трети парка.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { generateSecret, sha256 } from '@/lib/server/arena-runtime/auth'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), deviceId: z.string().uuid(), stationId: z.string().uuid() }),
  z.object({ action: z.literal('revoke'), deviceId: z.string().uuid(), reason: z.string().max(300).optional() }),
  z.object({ action: z.literal('reopen'), deviceId: z.string().uuid() }),
])

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'stations.manage_agent_binding')
    if (denied) return denied

    if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return json({ error: 'invalid-payload' }, 400)

    const body = parsed.data
    const supabase = createAdminSupabaseClient()

    const { data: device } = await supabase
      .from('arena_station_devices')
      .select('id, point_project_id, company_id, station_id, status, reported_hostname, reported_senet_ws_num')
      .eq('id', body.deviceId)
      .maybeSingle()
    if (!device) return json({ error: 'device-not-found' }, 404)

    // ── Отзыв ─────────────────────────────────────────────────────────────
    if (body.action === 'revoke') {
      await supabase
        .from('arena_station_devices')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoke_reason: body.reason || null,
          // Учётные данные стираем: отозванное устройство не должно иметь
          // возможности вернуться, если кто-то восстановит его файл настроек.
          device_token_hash: null,
          client_secret_hash: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', device.id)

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'arena_agent.revoke',
        entityType: 'arena-station-device',
        entityId: String(device.id),
        organizationId: access.activeOrganization?.id || null,
        payload: { station_id: device.station_id, reason: body.reason || null },
      })

      return json({ ok: true, status: 'revoked' })
    }

    // ── Возврат отозванного в заявки ──────────────────────────────────────
    // Отозвать — решение человека, и вернуть тоже. Само устройство воскреснуть
    // не может: иначе отзыв ничего не значил бы, ведь достаточно перезапустить
    // программу. Но и тупика быть не должно — отклонили по ошибке, вернули.
    if (body.action === 'reopen') {
      await supabase
        .from('arena_station_devices')
        .update({
          status: 'pending',
          station_id: null,
          revoked_at: null,
          revoke_reason: null,
          approved_at: null,
          approved_by: null,
          device_token_hash: null,
          client_secret_hash: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', device.id)

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'arena_agent.reopen',
        entityType: 'arena-station-device',
        entityId: String(device.id),
        organizationId: access.activeOrganization?.id || null,
        payload: { previous_status: device.status },
      })

      return json({ ok: true, status: 'pending' })
    }

    // ── Подтверждение ─────────────────────────────────────────────────────
    const { data: station } = await supabase
      .from('arena_stations')
      .select('id, name, point_project_id, company_id')
      .eq('id', body.stationId)
      .maybeSingle()
    if (!station) return json({ error: 'station-not-found' }, 404)

    // Устройство одного проекта не привязывается к станции другого — это была
    // бы прямая утечка между арендаторами.
    if (String(station.point_project_id) !== String(device.point_project_id)) {
      return json({ error: 'project-mismatch' }, 403)
    }

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (
      companyScope.allowedCompanyIds &&
      station.company_id &&
      !companyScope.allowedCompanyIds.includes(String(station.company_id))
    ) {
      return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)
    }

    // Захват занятой станции запрещён. Заменить наблюдателя можно только
    // осознанно: сначала отозвать старого, потом подтвердить нового.
    const { data: occupied } = await supabase
      .from('arena_station_devices')
      .select('id')
      .eq('station_id', station.id)
      .eq('status', 'active')
      .neq('id', device.id)
      .maybeSingle()
    if (occupied) {
      return json(
        {
          error: 'station-already-bound',
          message: 'У станции уже есть активное устройство. Сначала отзовите его.',
          activeDeviceId: occupied.id,
        },
        409,
      )
    }

    // Секрет показывается ровно один раз. Повторно его получить нельзя — можно
    // только отозвать устройство и подтвердить заново.
    const deviceToken = generateSecret()
    const clientSecret = generateSecret()
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('arena_station_devices')
      .update({
        status: 'active',
        station_id: station.id,
        company_id: station.company_id,
        device_token_hash: sha256(deviceToken),
        client_secret_hash: sha256(clientSecret),
        approved_at: now,
        approved_by: access.user?.id || null,
        revoked_at: null,
        revoke_reason: null,
        updated_at: now,
      })
      .eq('id', device.id)
    if (error) throw error

    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      action: 'arena_agent.approve',
      entityType: 'arena-station-device',
      entityId: String(device.id),
      organizationId: access.activeOrganization?.id || null,
      payload: {
        station_id: String(station.id),
        station_name: String(station.name),
        reported_hostname: device.reported_hostname,
        reported_senet_ws_num: device.reported_senet_ws_num,
      },
    })

    return json({
      ok: true,
      status: 'active',
      stationId: String(station.id),
      stationName: String(station.name),
      // Единственный раз, когда эти значения покидают сервер.
      credentials: { deviceToken, clientSecret },
      warning: 'Секрет показывается один раз. Скопируйте его сейчас — восстановить нельзя.',
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/arena/devices POST',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
