import 'server-only'

/**
 * Аутентификация наблюдающего устройства.
 *
 * Отдельно от киоска намеренно. Механизм похож, но домены безопасности разные:
 * общий секрет связал бы отказы двух подсистем в один, и компрометация киоска
 * означала бы компрометацию мониторинга.
 *
 * Главное правило: после проверки **ничему из тела запроса не верим**.
 * Ни идентификатору станции, ни компании, ни проекту. Всё это выводится из
 * самого устройства — иначе подтверждённое устройство одной станции могло бы
 * писать данные за любую другую.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { createAdminSupabaseClient } from '@/lib/server/supabase'

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Сравнение хэшей за постоянное время.
 *
 * Обычное `===` на строках завершается на первом несовпавшем символе, и по
 * времени ответа можно подбирать секрет посимвольно. На хэшах это менее
 * практично, чем на самих секретах, но стоит одну строку.
 */
function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

/** Секрет, который показывается ровно один раз и больше не восстанавливается. */
export function generateSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Нормализация MAC — дословно как в существующем индексе арены
 * `uq_arena_stations_project_device_mac`.
 *
 * Если нормализовать иначе, одно и то же устройство окажется разным в двух
 * таблицах, и сопоставление с существующими станциями молча перестанет
 * работать.
 */
export function normalizeMac(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = String(raw).trim()
  if (!value) return null
  return value.toUpperCase().replace(/-/g, ':')
}

export type ArenaDevice = {
  id: string
  point_project_id: string
  company_id: string | null
  station_id: string | null
  status: 'pending' | 'active' | 'revoked'
  agent_version: string | null
  device_instance_id: string | null
}

export type DeviceAuthResult =
  | { ok: true; device: ArenaDevice }
  | { ok: false; error: string; status: number }

export const DEVICE_TOKEN_HEADER = 'x-arena-agent-device-token'
export const DEVICE_SECRET_HEADER = 'x-arena-agent-secret'

/**
 * Проверяет устройство по паре «токен + секрет».
 *
 * Токен ищет строку, секрет доказывает право. Одного токена мало: он попадает
 * в журналы прокси и заголовки, а секрет — нет.
 *
 * Неподтверждённое устройство сюда не проходит: заявка даёт право только
 * спросить свой статус, но не писать данные. Это и есть смысл разделения
 * общего ключа регистрации и личных учётных данных — украденный из образа
 * общий ключ позволит максимум создать заявку.
 */
export async function authenticateDevice(request: Request): Promise<DeviceAuthResult> {
  const token = (request.headers.get(DEVICE_TOKEN_HEADER) || '').trim()
  const secret = (request.headers.get(DEVICE_SECRET_HEADER) || '').trim()

  if (!token) return { ok: false, error: 'missing-device-token', status: 401 }
  if (!secret) return { ok: false, error: 'missing-secret', status: 401 }

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('arena_station_devices')
    .select('id, point_project_id, company_id, station_id, status, agent_version, device_instance_id, device_token_hash, client_secret_hash')
    .eq('device_token_hash', sha256(token))
    .maybeSingle()

  if (error) return { ok: false, error: 'db-error', status: 500 }
  if (!data) return { ok: false, error: 'unauthorized', status: 401 }

  if (!data.client_secret_hash || !hashEquals(sha256(secret), String(data.client_secret_hash))) {
    return { ok: false, error: 'unauthorized', status: 401 }
  }

  if (data.status === 'revoked') {
    return { ok: false, error: 'device-revoked', status: 403 }
  }

  if (data.status !== 'active') {
    // Заявка ещё не подтверждена человеком. Отвечаем явно, чтобы устройство
    // могло спокойно ждать, а не считать себя сломанным.
    return { ok: false, error: 'device-not-approved', status: 403 }
  }

  if (!data.station_id) {
    // Не должно случаться: ограничение в базе требует привязку у активного.
    // Но если случилось — писать некуда, и молча продолжать нельзя.
    return { ok: false, error: 'device-not-bound', status: 409 }
  }

  return {
    ok: true,
    device: {
      id: String(data.id),
      point_project_id: String(data.point_project_id),
      company_id: data.company_id ? String(data.company_id) : null,
      station_id: String(data.station_id),
      status: 'active',
      agent_version: data.agent_version ? String(data.agent_version) : null,
      device_instance_id: data.device_instance_id ? String(data.device_instance_id) : null,
    },
  }
}

/**
 * Проверка общего ключа регистрации.
 *
 * Этот ключ даёт право **только подать заявку**. На diskless он неизбежно
 * окажется в образе, то есть на каждом клиентском компьютере клуба, — и
 * относиться к нему надо соответственно: как к номеру очереди, а не к пропуску.
 */
export function verifyBootstrapKey(provided: string | null | undefined): boolean {
  const expected = process.env.ARENA_PROVISIONING_KEY
  if (!expected) return false
  const value = (provided || '').trim()
  if (!value) return false
  return hashEquals(sha256(value), sha256(expected))
}
