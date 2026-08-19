/**
 * Живая картина арены для экрана мониторинга.
 *
 * Один запрос отдаёт готовое представление: браузеру не приходится склеивать
 * несколько таблиц и выводить состояние самому. Состояние выводится здесь,
 * ровно один раз, тем же кодом, что и везде.
 *
 * Главное, что здесь происходит: станции без наблюдателя **не считаются
 * свободными**. Они выделены отдельно. Показать такую зелёной значит соврать
 * убедительно — на экране «свободно», а за компьютером может сидеть человек.
 */

import { NextResponse } from 'next/server'

import { HEARTBEAT_INTERVAL_SEC, OFFLINE_AFTER_SEC, ARENA_STATE_VERSION } from '@/lib/domain/arena-runtime/config'
import { classifyProcess } from '@/lib/domain/arena-runtime/process-classification'
import { isCommerciallyOccupied, isObserved, resolveStationState } from '@/lib/domain/arena-runtime/state'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'stations.view_live')
    if (denied) return denied

    const url = new URL(request.url)
    const projectId = url.searchParams.get('project_id')
    if (!projectId) return json({ error: 'project-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Изоляция арендаторов: чужой проект не должен читаться даже по прямой
    // ссылке. Скоуп компаний тот же, что и у остальной арены.
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: url.searchParams.get('company_id') || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let stationsQuery = supabase
      .from('arena_stations')
      .select('id, name, zone_id, company_id, is_active, order_index')
      .eq('point_project_id', projectId)
      .eq('is_active', true)
      .order('order_index')
      .order('name')

    if (companyScope.allowedCompanyIds) {
      stationsQuery = stationsQuery.in('company_id', companyScope.allowedCompanyIds)
    }

    const [{ data: stations, error: stationsError }, { data: zones }, { data: devices }, { data: runtimes }] =
      await Promise.all([
        stationsQuery,
        supabase.from('arena_zones').select('id, name').eq('point_project_id', projectId),
        supabase
          .from('arena_station_devices')
          .select('id, station_id, status, last_seen_at, agent_version, reported_hostname, reported_senet_ws_num, requested_at, device_instance_id, reported_mac')
          .eq('point_project_id', projectId),
        supabase
          .from('arena_station_runtime')
          .select('station_id, observed_user_kind, observed_user_kind_at, observed_game_process, observed_game_path, observed_game_at, observed_state_hint, last_boot_at, last_heartbeat_at, agent_version')
          .eq('point_project_id', projectId),
      ])

    if (stationsError) throw stationsError

    const zoneById = new Map((zones || []).map((z: any) => [String(z.id), String(z.name)]))
    const runtimeByStation = new Map((runtimes || []).map((r: any) => [String(r.station_id), r]))

    // Только активные устройства участвуют в выводе состояния. Заявка не
    // наблюдатель: она ничего не может прислать, пока её не подтвердили.
    const activeDeviceByStation = new Map<string, any>()
    for (const device of devices || []) {
      if (device.status === 'active' && device.station_id) {
        activeDeviceByStation.set(String(device.station_id), device)
      }
    }

    const now = new Date()

    const rows = (stations || []).map((station: any) => {
      const stationId = String(station.id)
      const device = activeDeviceByStation.get(stationId) || null
      const runtime = runtimeByStation.get(stationId) || null

      const resolved = resolveStationState({
        device: device
          ? { id: String(device.id), status: device.status, last_seen_at: device.last_seen_at, agent_version: device.agent_version }
          : null,
        runtime,
        now,
      })

      // Игру показываем только пока сигнал свежий. Иначе получилось бы
      // «станция офлайн и играет в CS2» — утверждение, которое не может быть
      // правдой одновременно.
      const liveProcess = resolved.freshness === 'fresh' ? (runtime?.observed_game_process ?? null) : null

      return {
        id: stationId,
        name: String(station.name),
        zone: station.zone_id ? zoneById.get(String(station.zone_id)) ?? null : null,
        companyId: station.company_id ? String(station.company_id) : null,
        state: resolved.state,
        freshness: resolved.freshness,
        lastSeenSecondsAgo: resolved.lastSeenSecondsAgo,
        process: liveProcess
          ? { name: liveProcess, classification: classifyProcess(liveProcess) }
          : null,
        lastKnown:
          resolved.freshness === 'fresh'
            ? null
            : resolved.lastKnown && (resolved.lastKnown.userKind || resolved.lastKnown.gameProcess)
              ? {
                  userKind: resolved.lastKnown.userKind,
                  process: resolved.lastKnown.gameProcess,
                }
              : null,
        agent: device
          ? { version: device.agent_version ?? null, lastSeenAt: device.last_seen_at ?? null }
          : null,
        bootAt: runtime?.last_boot_at ?? null,
      }
    })

    // Заявки, ждущие подтверждения. Без них экран не подскажет, что кто-то
    // уже установлен и ждёт разрешения.
    const pending = (devices || [])
      .filter((d: any) => d.status === 'pending')
      .map((d: any) => ({
        id: String(d.id),
        hostname: d.reported_hostname ?? null,
        mac: d.reported_mac ?? null,
        senetWsNum: d.reported_senet_ws_num ?? null,
        deviceInstanceId: d.device_instance_id ?? null,
        requestedAt: d.requested_at ?? null,
      }))

    // Активные устройства нужны, чтобы их можно было отозвать. Без этого
    // привязка становится односторонней: подключить можно, отключить нельзя.
    const active = (devices || [])
      .filter((d: any) => d.status === 'active')
      .map((d: any) => {
        const station = (stations || []).find((s: any) => String(s.id) === String(d.station_id))
        return {
          id: String(d.id),
          stationId: d.station_id ? String(d.station_id) : null,
          stationName: station ? String(station.name) : null,
          hostname: d.reported_hostname ?? null,
          mac: d.reported_mac ?? null,
          agentVersion: d.agent_version ?? null,
          lastSeenAt: d.last_seen_at ?? null,
        }
      })

    const observedCount = rows.filter((r) => isObserved(r.state)).length
    const clientCount = rows.filter((r) => isCommerciallyOccupied(r.state)).length

    return json({
      data: {
        serverTime: now.toISOString(),
        stateVersion: ARENA_STATE_VERSION,
        heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
        offlineAfterSec: OFFLINE_AFTER_SEC,
        summary: {
          total: rows.length,
          // Наблюдаемые — те, про кого мы действительно что-то знаем.
          observed: observedCount,
          unprovisioned: rows.filter((r) => r.state === 'UNPROVISIONED').length,
          pendingDevices: pending.length,
          offline: rows.filter((r) => r.state === 'OFFLINE').length,
          available: rows.filter((r) => r.state === 'AVAILABLE').length,
          client: clientCount,
          support: rows.filter((r) => r.state === 'SUPPORT').length,
          unknown: rows.filter((r) => r.state === 'UNKNOWN').length,
          /**
           * Загрузка считается от наблюдаемых, а не от всех станций.
           *
           * Пока агент стоит на одной машине из семидесяти семи, «загрузка
           * клуба» по всему парку была бы бессмыслицей. Знаменатель отдаётся
           * рядом, чтобы число нельзя было прочитать в отрыве от него.
           */
          occupancy: observedCount > 0 ? Math.round((clientCount / observedCount) * 1000) / 10 : null,
          occupancyDenominator: observedCount,
          coverage: rows.length > 0 ? Math.round((observedCount / rows.length) * 1000) / 10 : null,
        },
        stations: rows,
        pendingDevices: pending,
        activeDevices: active,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/arena/live GET',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
