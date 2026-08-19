/**
 * Периодическое подтверждение: устройство живо и вот что оно видит.
 *
 * Ключевое отличие от обычного «пинга»: heartbeat несёт **полный снимок
 * наблюдений**, а не просто факт жизни. Это делает систему самовосстанавливающейся.
 *
 * Представьте: событие «клиент вошёл» потерялось в сети. При пустом пинге
 * станция навсегда осталась бы «свободной» — до следующего входа. Раз в
 * тридцать секунд приходит полный снимок, и ошибка живёт максимум полминуты.
 *
 * Второе: время приёма ставит сервер, а не устройство. Вывод об офлайне обязан
 * опираться на то, что сервер действительно получал, а не на часы клиента,
 * которые могут врать на часы.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  ARENA_PROTOCOL_VERSION,
  ARENA_SCHEMA_VERSION,
  CLOCK_SKEW_FUTURE_TOLERANCE_SEC,
  HEARTBEAT_INTERVAL_SEC,
} from '@/lib/domain/arena-runtime/config'
import { classifyProcess } from '@/lib/domain/arena-runtime/process-classification'
import { applyObservation } from '@/lib/domain/arena-runtime/projection'
import { authenticateDevice } from '@/lib/server/arena-runtime/auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const Body = z.object({
  /** Когда устройство сделало эти наблюдения, по своим часам. */
  observedAt: z.string().datetime({ offset: true }),
  windowsUserKind: z.enum(['logonui', 'senet_user', 'support', 'unknown']).optional().nullable(),
  /**
   * Что сейчас запущено — списком, без выводов.
   *
   * Именно списком, а не одним «текущая игра»: выбирать игру должен сервер.
   * Если бы выбирал probe, правило отбора пришлось бы менять пересборкой
   * образа на семидесяти семи машинах.
   */
  /**
   * Что запущено.
   *
   * Принимаются ДВА формата, и это принципиально: старые устройства присылают
   * просто имена, новые — имена с весом и признаком окна.
   *
   * Сервер обязан понимать обе версии. Иначе выкладка новой версии ослепляет
   * весь парк до пересборки образа — на бездисковых машинах это означает
   * остановку клуба ради обновления мониторинга. Один раз я так уже сломал
   * наблюдение на станции 21 и не хочу повторять это на семидесяти семи.
   */
  processes: z
    .array(
      z.union([
        z.string().max(260),
        z.object({
          name: z.string().max(260),
          /** Сколько памяти занимает. Игра берёт сотни мегабайт, служба — единицы. */
          memoryMb: z.number().int().min(0).max(1_000_000).optional().nullable(),
          /** Есть ли окно. У игры оно есть, у фоновой службы нет. */
          hasWindow: z.boolean().optional().nullable(),
        }),
      ]),
    )
    .max(60)
    .optional()
    .nullable(),
  bootAt: z.string().datetime({ offset: true }).optional().nullable(),
  agentVersion: z.string().max(60).optional().nullable(),
  /** Что устройство само думает о состоянии. Только сверка, в проекцию не идёт. */
  stateHint: z.string().max(40).optional().nullable(),
  sourceInstanceId: z.string().max(200).optional().nullable(),
  sourceSeq: z.number().int().min(0).optional().nullable(),
})

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

    const auth = await authenticateDevice(request)
    if (!auth.ok) return json({ error: auth.error }, auth.status)

    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return json({ error: 'invalid-payload', details: parsed.error.flatten() }, 400)

    const body = parsed.data
    const device = auth.device
    const supabase = createAdminSupabaseClient()
    const serverNow = new Date()

    // Расхождение часов считаем всегда — устройству полезно знать, что оно
    // отстаёт, даже если наблюдения при этом приняты.
    const observed = Date.parse(body.observedAt)
    const skewSeconds = Number.isFinite(observed)
      ? Math.round((observed - serverNow.getTime()) / 1000)
      : null

    const clockRejected = skewSeconds !== null && skewSeconds > CLOCK_SKEW_FUTURE_TOLERANCE_SEC

    // Кандидата в игры выбирает сервер, а не устройство.
    //
    // Раньше брался первый неопознанный из списка — и это оказалось никуда не
    // годным правилом: список приходит по алфавиту, и на боевой станции 21 при
    // запущенной CS2 победил AppNotify.exe.
    //
    // Теперь смотрим на вес и окно. Игра занимает сотни мегабайт и имеет окно;
    // служебная программа — единицы мегабайт и без окна. Это по-прежнему
    // догадка, а не знание: пометка так и останется «возможно игра», пока
    // процесс не привязан к каталогу клуба.
    // Приводим оба формата к одному виду. У старых устройств веса и окна нет —
    // тогда выбор вырождается в прежний, и это лучше, чем отказ принять данные.
    const observedProcesses = (body.processes || []).map((process) =>
      typeof process === 'string'
        ? { name: process, memoryMb: null as number | null, hasWindow: null as boolean | null }
        : { name: process.name, memoryMb: process.memoryMb ?? null, hasWindow: process.hasWindow ?? null },
    )

    const candidates = observedProcesses.filter(
      (process) => classifyProcess(process.name) === 'unknown_candidate',
    )
    const withWindow = candidates.filter((process) => process.hasWindow)
    const pool = withWindow.length > 0 ? withWindow : candidates
    const candidate =
      pool.slice().sort((a, b) => (b.memoryMb ?? 0) - (a.memoryMb ?? 0))[0]?.name ?? null

    // Снимок мог ещё не существовать: первое подтверждение после привязки.
    const { data: current } = await supabase
      .from('arena_station_runtime')
      .select('observed_user_kind, observed_user_kind_at, observed_game_process, observed_game_path, observed_game_at, observed_state_hint, observed_state_hint_at, last_boot_at')
      .eq('station_id', device.station_id)
      .maybeSingle()

    const base = current ?? {
      observed_user_kind: null,
      observed_user_kind_at: null,
      observed_game_process: null,
      observed_game_path: null,
      observed_game_at: null,
      observed_state_hint: null,
      observed_state_hint_at: null,
      last_boot_at: null,
    }

    // Наблюдения из будущего в проекцию не идут: они заблокировали бы все
    // последующие, и снимок замер бы навсегда.
    const patch = clockRejected
      ? {}
      : applyObservation(base as any, {
          userKind: { value: body.windowsUserKind ?? null, observedAt: body.observedAt },
          game: { process: candidate, path: null, observedAt: body.observedAt },
          stateHint: { value: body.stateHint ?? null, observedAt: body.observedAt },
          bootAt: body.bootAt ?? null,
        })

    // Время жизни ставим всегда — даже при сбитых часах устройство живо, и
    // считать его офлайном было бы неверно.
    const { error } = await supabase.from('arena_station_runtime').upsert(
      [
        {
          station_id: device.station_id,
          point_project_id: device.point_project_id,
          company_id: device.company_id,
          device_id: device.id,
          ...patch,
          last_heartbeat_at: serverNow.toISOString(),
          agent_version: body.agentVersion ?? device.agent_version ?? null,
          source_instance_id: body.sourceInstanceId ?? null,
          last_source_seq: body.sourceSeq ?? null,
          updated_at: serverNow.toISOString(),
        },
      ],
      { onConflict: 'station_id' },
    )
    if (error) throw error

    await supabase
      .from('arena_station_devices')
      .update({
        last_seen_at: serverNow.toISOString(),
        agent_version: body.agentVersion ?? device.agent_version ?? null,
        updated_at: serverNow.toISOString(),
      })
      .eq('id', device.id)

    return json({
      ok: true,
      serverTime: serverNow.toISOString(),
      protocolVersion: ARENA_PROTOCOL_VERSION,
      schemaVersion: ARENA_SCHEMA_VERSION,
      heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
      clockSkewSeconds: skewSeconds,
      // Устройство должно узнать, что его наблюдения отвергнуты, — иначе оно
      // будет считать, что всё в порядке, а экран будет показывать старое.
      ...(clockRejected ? { warning: 'CLOCK_SKEW_FUTURE' } : {}),
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/arena-agent/heartbeat',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
