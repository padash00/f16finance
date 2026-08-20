/**
 * Заявка устройства на наблюдение за станцией.
 *
 * Регистрация НЕ даёт права писать данные. Она создаёт заявку, которую должен
 * подтвердить человек. Причина в среде: клиентские компьютеры бездисковые и
 * грузятся с общего образа, поэтому общий ключ регистрации неизбежно окажется
 * доступен любому, кто сидит за игровым компьютером. Пусть максимум, что он
 * сможет, — попроситься в очередь.
 *
 * Станцию устройство себе не выбирает. Оно сообщает, что о себе знает, а
 * привязку создаёт человек при подтверждении. Никакого сопоставления по
 * номерам: имена станций у клуба идут диапазонами (111, 666, 801–805), и
 * правило «имя равно номеру рабочей станции» дало бы уверенно неверную
 * привязку на трети парка.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ARENA_PROTOCOL_VERSION, ARENA_SCHEMA_VERSION, HEARTBEAT_INTERVAL_SEC } from '@/lib/domain/arena-runtime/config'
import { normalizeMac, verifyBootstrapKey } from '@/lib/server/arena-runtime/auth'
import { writeSystemErrorLogSafe, describeError } from '@/lib/server/audit'
import { checkRateLimit } from '@/lib/server/rate-limit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const Body = z.object({
  bootstrapKey: z.string().min(1),
  projectId: z.string().uuid(),
  /** Устойчивый идентификатор экземпляра — по нему повторная заявка не плодит строки. */
  deviceInstanceId: z.string().min(1).max(200),
  hostname: z.string().max(200).optional().nullable(),
  mac: z.string().max(64).optional().nullable(),
  /** Номер рабочей станции в SENET, если устройство смогло его получить. */
  senetWsNum: z.number().int().min(0).max(100000).optional().nullable(),
  /** Что устройство думает о своём имени станции. Справочно. */
  stationName: z.string().max(120).optional().nullable(),
  agentVersion: z.string().max(60).optional().nullable(),
})

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

    // Ограничение частоты по адресу: даже с украденным общим ключом нельзя
    // наплодить тысячи заявок и забить экран подтверждения.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const limited = checkRateLimit(`arena-agent-register:${ip}`, 20, 60_000)
    if (!limited.allowed) return json({ error: 'rate-limited' }, 429)

    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return json({ error: 'invalid-payload', details: parsed.error.flatten() }, 400)

    const body = parsed.data

    if (!verifyBootstrapKey(body.bootstrapKey)) {
      return json({ error: 'invalid-bootstrap-key' }, 401)
    }

    const supabase = createAdminSupabaseClient()

    // Проект обязан существовать: заявка в никуда бесполезна и засоряет базу.
    const { data: project } = await supabase
      .from('point_projects')
      .select('id')
      .eq('id', body.projectId)
      .maybeSingle()
    if (!project) return json({ error: 'unknown-project' }, 404)

    const mac = normalizeMac(body.mac)

    // Повторная заявка с той же машины обновляет существующую строку. Иначе
    // после каждой перезагрузки бездискового клиента появлялась бы новая
    // заявка, и через неделю в списке было бы их несколько сотен.
    const { data: existing } = await supabase
      .from('arena_station_devices')
      .select('id, status, station_id')
      .eq('point_project_id', body.projectId)
      .eq('device_instance_id', body.deviceInstanceId)
      .maybeSingle()

    const observed = {
      reported_hostname: body.hostname || null,
      reported_mac: mac,
      reported_senet_ws_num: body.senetWsNum ?? null,
      reported_station_name: body.stationName || null,
      agent_version: body.agentVersion || null,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      // Отозванное устройство само себя не воскрешает — это делает человек.
      if (existing.status === 'revoked') {
        return json({ error: 'device-revoked', deviceId: existing.id }, 403)
      }

      await supabase.from('arena_station_devices').update(observed).eq('id', existing.id)

      return json({
        ok: true,
        deviceId: existing.id,
        status: existing.status,
        protocolVersion: ARENA_PROTOCOL_VERSION,
        schemaVersion: ARENA_SCHEMA_VERSION,
        heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
        serverTime: new Date().toISOString(),
      })
    }

    const { data: created, error } = await supabase
      .from('arena_station_devices')
      .insert([
        {
          point_project_id: body.projectId,
          device_type: 'arena_agent',
          status: 'pending',
          device_instance_id: body.deviceInstanceId,
          ...observed,
        },
      ])
      .select('id, status')
      .single()

    if (error) throw error

    return json(
      {
        ok: true,
        deviceId: created.id,
        status: created.status,
        protocolVersion: ARENA_PROTOCOL_VERSION,
        schemaVersion: ARENA_SCHEMA_VERSION,
        heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
        serverTime: new Date().toISOString(),
        // Устройству полезно знать, что дальше от него ничего не зависит.
        message: 'Заявка принята. Данные можно отправлять после подтверждения администратором.',
      },
      201,
    )
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/arena-agent/register',
      message: describeError(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
