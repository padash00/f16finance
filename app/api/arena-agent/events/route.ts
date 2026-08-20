/**
 * Приём событий со станции.
 *
 * События — это улики, а не выводы. Здесь они складываются в журнал и при
 * необходимости двигают снимок. Никаких решений «станция занята» на этом
 * уровне не принимается: их выводит читающая сторона.
 *
 * Доставка «как минимум один раз», обработка «ровно один раз».
 *
 * Сеть в клубе нестабильна, поэтому устройство обязано повторять отправку,
 * пока не получит подтверждение, — и одно и то же событие неизбежно придёт
 * дважды. Уникальность по `(проект, идентификатор события)` делает повтор
 * безвредным: строка не вставится, снимок не сдвинется, ответ будет прежним.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  ARENA_SCHEMA_VERSION,
  CLOCK_SKEW_FUTURE_TOLERANCE_SEC,
  EVENTS_BATCH_LIMIT,
  EVENT_MAX_AGE_SEC,
} from '@/lib/domain/arena-runtime/config'
import { applyObservation, checkClock } from '@/lib/domain/arena-runtime/projection'
import { authenticateDevice } from '@/lib/server/arena-runtime/auth'
import { writeSystemErrorLogSafe, describeError } from '@/lib/server/audit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Типы событий первого среза.
 *
 * Список закрытый намеренно: неизвестный тип означает, что устройство и сервер
 * разошлись в понимании протокола, и молча принять его — значит накопить
 * мусор, который потом невозможно разобрать.
 */
const EVENT_TYPES = [
  'agent_started',
  'agent_stopped',
  'windows_boot',
  'windows_shutdown',
  'windows_session_changed',
  'process_started',
  'process_stopped',
] as const

const EventSchema = z.object({
  eventId: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  occurredAt: z.string().datetime({ offset: true }),
  /** Наблюдения, которые событие несёт с собой. */
  windowsUserKind: z.enum(['logonui', 'senet_user', 'support', 'unknown']).optional().nullable(),
  processName: z.string().max(260).optional().nullable(),
  processPath: z.string().max(1024).optional().nullable(),
  bootAt: z.string().datetime({ offset: true }).optional().nullable(),
  sourceSeq: z.number().int().min(0).optional().nullable(),
  payload: z.record(z.unknown()).optional(),
})

const Body = z.object({
  sourceInstanceId: z.string().max(200).optional().nullable(),
  events: z.array(EventSchema).min(1).max(EVENTS_BATCH_LIMIT),
})

/**
 * Поля, которые устройство не имеет права присылать.
 *
 * Если в нагрузке окажется что-то похожее на секрет, мы его не сохраняем и
 * сообщаем об этом. Пароль, попавший в журнал событий, остаётся там навсегда
 * и утекает в каждую выгрузку.
 */
const FORBIDDEN_PAYLOAD_KEYS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'checkcode',
  'check_code',
  'apikey',
  'api_key',
]

function stripSecrets(payload: Record<string, unknown> | undefined): {
  clean: Record<string, unknown>
  removed: string[]
} {
  if (!payload) return { clean: {}, removed: [] }
  const clean: Record<string, unknown> = {}
  const removed: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_PAYLOAD_KEYS.some((bad) => key.toLowerCase().includes(bad))) {
      removed.push(key)
      continue
    }
    clean[key] = value
  }
  return { clean, removed }
}

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

    const auth = await authenticateDevice(request)
    if (!auth.ok) return json({ error: auth.error }, auth.status)

    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return json({ error: 'invalid-payload', details: parsed.error.flatten() }, 400)

    const { events, sourceInstanceId } = parsed.data
    const device = auth.device
    const supabase = createAdminSupabaseClient()
    const serverNow = new Date()

    // Имя станции нужно сохранить в каждом событии: без него удалённая станция
    // превращает историю в набор пустых ссылок.
    const { data: station } = await supabase
      .from('arena_stations')
      .select('name')
      .eq('id', device.station_id)
      .maybeSingle()

    const rejected: Array<{ eventId: string; reason: string; skewSeconds: number | null }> = []
    const strippedKeys = new Set<string>()
    const rows: Record<string, unknown>[] = []

    for (const event of events) {
      const clock = checkClock(event.occurredAt, serverNow, CLOCK_SKEW_FUTURE_TOLERANCE_SEC, EVENT_MAX_AGE_SEC)
      const { clean, removed } = stripSecrets(event.payload)
      removed.forEach((key) => strippedKeys.add(key))

      if (!clock.ok) {
        // В журнал такое событие всё равно попадает — как улика о расхождении
        // часов. Но в проекцию не идёт: пустив его, мы заморозили бы снимок.
        rejected.push({ eventId: event.eventId, reason: clock.reason, skewSeconds: clock.skewSeconds })
      }

      rows.push({
        event_id: event.eventId,
        point_project_id: device.point_project_id,
        company_id: device.company_id,
        station_id: device.station_id,
        device_id: device.id,
        station_name_snapshot: station?.name ?? null,
        event_type: event.type,
        occurred_at: event.occurredAt,
        received_at: serverNow.toISOString(),
        source: 'arena_probe',
        source_instance_id: sourceInstanceId ?? null,
        source_seq: event.sourceSeq ?? null,
        payload: {
          ...clean,
          ...(event.windowsUserKind ? { windows_user_kind: event.windowsUserKind } : {}),
          ...(event.processName ? { process_name: event.processName } : {}),
          ...(event.processPath ? { process_path: event.processPath } : {}),
          ...(clock.ok ? {} : { clock_rejected: clock.reason }),
        },
        schema_version: ARENA_SCHEMA_VERSION,
      })
    }

    // Повторная доставка не должна быть ошибкой: устройство поступает
    // правильно, повторяя отправку. ignoreDuplicates превращает повтор в
    // ничего не делающую операцию.
    const { data: inserted, error } = await supabase
      .from('arena_station_events')
      .upsert(rows, { onConflict: 'point_project_id,event_id', ignoreDuplicates: true })
      .select('event_id')
    if (error) throw error

    const acceptedIds = new Set((inserted || []).map((row: any) => String(row.event_id)))
    const duplicates = events.filter((e) => !acceptedIds.has(e.eventId)).map((e) => e.eventId)

    // ── Двигаем снимок ────────────────────────────────────────────────────
    // Только по новым событиям и только по тем, у которых нормальные часы.
    // Повторы исключены выше — иначе одно и то же событие сдвинуло бы снимок
    // дважды и «включило» уже закрытую сессию.
    const rejectedIds = new Set(rejected.map((r) => r.eventId))
    const fresh = events
      .filter((e) => acceptedIds.has(e.eventId) && !rejectedIds.has(e.eventId))
      .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))

    if (fresh.length > 0) {
      const { data: current } = await supabase
        .from('arena_station_runtime')
        .select('observed_user_kind, observed_user_kind_at, observed_game_process, observed_game_path, observed_game_at, observed_state_hint, observed_state_hint_at, last_boot_at')
        .eq('station_id', device.station_id)
        .maybeSingle()

      let snapshot = (current ?? {
        observed_user_kind: null,
        observed_user_kind_at: null,
        observed_game_process: null,
        observed_game_path: null,
        observed_game_at: null,
        observed_state_hint: null,
        observed_state_hint_at: null,
        last_boot_at: null,
      }) as any

      const total: Record<string, unknown> = {}

      for (const event of fresh) {
        const patch = applyObservation(snapshot, {
          userKind: event.windowsUserKind
            ? { value: event.windowsUserKind, observedAt: event.occurredAt }
            : undefined,
          // Процесс двигает снимок только когда он запустился. Остановка
          // очищает поле — иначе закрытая игра осталась бы «текущей» навсегда.
          game:
            event.type === 'process_started'
              ? { process: event.processName ?? null, path: event.processPath ?? null, observedAt: event.occurredAt }
              : event.type === 'process_stopped'
                ? { process: null, path: null, observedAt: event.occurredAt }
                : undefined,
          bootAt: event.type === 'windows_boot' ? event.occurredAt : (event.bootAt ?? undefined),
        })
        snapshot = { ...snapshot, ...patch }
        Object.assign(total, patch)
      }

      if (Object.keys(total).length > 0) {
        await supabase.from('arena_station_runtime').upsert(
          [
            {
              station_id: device.station_id,
              point_project_id: device.point_project_id,
              company_id: device.company_id,
              device_id: device.id,
              ...total,
              last_event_at: serverNow.toISOString(),
              updated_at: serverNow.toISOString(),
            },
          ],
          { onConflict: 'station_id' },
        )
      }
    }

    return json({
      ok: true,
      serverTime: serverNow.toISOString(),
      schemaVersion: ARENA_SCHEMA_VERSION,
      accepted: acceptedIds.size,
      duplicates,
      rejected,
      // Устройство должно узнать, что прислало лишнее, и перестать это делать.
      ...(strippedKeys.size > 0 ? { strippedFields: [...strippedKeys] } : {}),
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/arena-agent/events',
      message: describeError(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
