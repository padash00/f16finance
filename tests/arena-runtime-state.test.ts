/**
 * Вывод состояния станции — самая ответственная функция всего мониторинга.
 *
 * Здесь охраняется одно обещание: система не должна показывать зелёным то, о
 * чём она ничего не знает. Компьютер без наблюдателя, компьютер, который
 * замолчал, и компьютер, за которым действительно никого нет, — три разные
 * вещи, и различать их надо всегда.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveStationState, isCommerciallyOccupied, isObserved } from '@/lib/domain/arena-runtime/state'
import type { DeviceRow, RuntimeSnapshot } from '@/lib/domain/arena-runtime/types'

const NOW = new Date('2026-08-19T20:00:00Z')

function device(patch: Partial<DeviceRow> = {}): DeviceRow {
  return { id: 'dev1', status: 'active', last_seen_at: null, agent_version: 'probe-1', ...patch }
}

function runtime(patch: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    station_id: 'st1',
    observed_user_kind: 'logonui',
    observed_user_kind_at: '2026-08-19T19:59:30Z',
    observed_game_process: null,
    observed_game_path: null,
    observed_game_at: null,
    observed_state_hint: null,
    last_boot_at: null,
    last_heartbeat_at: '2026-08-19T19:59:45Z',
    agent_version: 'probe-1',
    ...patch,
  }
}

test('станция без наблюдателя не свободна, а неизвестна', () => {
  // Самая важная проверка всего файла. Показать такую станцию зелёной значит
  // соврать убедительно: на экране «свободно», а там может сидеть человек.
  const result = resolveStationState({ device: null, runtime: null, now: NOW })
  assert.equal(result.state, 'UNPROVISIONED')
  assert.notEqual(result.state, 'AVAILABLE')
  assert.equal(isObserved(result.state), false)
})

test('неподтверждённая заявка — не наблюдатель', () => {
  const result = resolveStationState({ device: device({ status: 'pending' }), runtime: null, now: NOW })
  assert.equal(result.state, 'PENDING')
})

test('отозванное устройство перестаёт быть источником', () => {
  const result = resolveStationState({
    device: device({ status: 'revoked' }),
    runtime: runtime({ observed_user_kind: 'senet_user' }),
    now: NOW,
  })
  assert.equal(result.state, 'REVOKED')
})

test('молчание дольше порога — offline', () => {
  const result = resolveStationState({
    device: device(),
    runtime: runtime({ last_heartbeat_at: '2026-08-19T19:57:00Z' }),
    now: NOW,
  })
  assert.equal(result.state, 'OFFLINE')
  assert.equal(result.freshness, 'stale')
  assert.equal(result.lastSeenSecondsAgo, 180)
})

test('свежий сигнал и никого в системе — свободно', () => {
  const result = resolveStationState({ device: device(), runtime: runtime(), now: NOW })
  assert.equal(result.state, 'AVAILABLE')
  assert.equal(result.freshness, 'fresh')
})

test('учётная запись клиента — занято клиентом', () => {
  const result = resolveStationState({
    device: device(),
    runtime: runtime({ observed_user_kind: 'senet_user' }),
    now: NOW,
  })
  assert.equal(result.state, 'CLIENT')
  assert.equal(isCommerciallyOccupied(result.state), true)
})

test('техническая запись — не клиент', () => {
  // Support занимает компьютер физически, но это не проданное время. Считать
  // его коммерческой загрузкой значит завысить выручку клуба на ремонте.
  const result = resolveStationState({
    device: device(),
    runtime: runtime({ observed_user_kind: 'support' }),
    now: NOW,
  })
  assert.equal(result.state, 'SUPPORT')
  assert.equal(isCommerciallyOccupied(result.state), false)
  assert.equal(isObserved(result.state), true)
})

test('непонятный пользователь не выдаётся за свободу', () => {
  const result = resolveStationState({
    device: device(),
    runtime: runtime({ observed_user_kind: 'какая-то-учётка' }),
    now: NOW,
  })
  assert.equal(result.state, 'UNKNOWN')
  assert.notEqual(result.state, 'AVAILABLE')
})

test('устаревшая игра становится последним известным, а не текущим', () => {
  // «Offline и играет в CS2» — бессмыслица. «Сейчас offline, до этого был
  // клиент с CS2» — полезно для разбора.
  const result = resolveStationState({
    device: device(),
    runtime: runtime({
      observed_user_kind: 'senet_user',
      observed_game_process: 'cs2.exe',
      last_heartbeat_at: '2026-08-19T18:00:00Z',
    }),
    now: NOW,
  })
  assert.equal(result.state, 'OFFLINE')
  assert.equal(result.lastKnown?.gameProcess, 'cs2.exe')
  assert.equal(result.lastKnown?.userKind, 'senet_user')
})

test('подтверждённое устройство, которое ни разу не отчиталось', () => {
  // Это не «свободно» и не «онлайн». Связи не было ни разу.
  const result = resolveStationState({ device: device(), runtime: null, now: NOW })
  assert.equal(result.state, 'OFFLINE')
  assert.equal(result.freshness, 'never')
  assert.equal(result.lastSeenSecondsAgo, null)
})

test('порог offline настраивается, а не зашит', () => {
  const args = {
    device: device(),
    runtime: runtime({ last_heartbeat_at: '2026-08-19T19:58:00Z' }),
    now: NOW,
  }
  assert.equal(resolveStationState({ ...args, offlineAfterSec: 60 }).state, 'OFFLINE')
  assert.equal(resolveStationState({ ...args, offlineAfterSec: 300 }).state, 'AVAILABLE')
})

test('ровно на границе порога станция ещё жива', () => {
  const result = resolveStationState({
    device: device(),
    runtime: runtime({ last_heartbeat_at: '2026-08-19T19:58:30Z' }),
    now: NOW,
    offlineAfterSec: 90,
  })
  assert.equal(result.lastSeenSecondsAgo, 90)
  assert.equal(result.state, 'AVAILABLE')
})
