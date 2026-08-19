/**
 * Порядок наблюдений и часы устройства.
 *
 * Здесь охраняется правило «старое не перезаписывает новое». Нарушить его
 * легко и незаметно: снимок будет обновляться, экран — показывать
 * правдоподобное, и только человек за компьютером будет знать, что там на
 * самом деле.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { applyObservation, checkClock, shouldApply } from '@/lib/domain/arena-runtime/projection'
import type { SnapshotFields } from '@/lib/domain/arena-runtime/projection'
import { classifyProcess } from '@/lib/domain/arena-runtime/process-classification'

function snapshot(patch: Partial<SnapshotFields> = {}): SnapshotFields {
  return {
    observed_user_kind: 'logonui',
    observed_user_kind_at: '2026-08-19T20:00:00Z',
    observed_game_process: null,
    observed_game_path: null,
    observed_game_at: null,
    observed_state_hint: null,
    observed_state_hint_at: null,
    last_boot_at: null,
    ...patch,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Порядок
// ─────────────────────────────────────────────────────────────────────────────

test('опоздавшее старое наблюдение не затирает свежее', () => {
  // Тот самый случай: «вышел» в 20:00 пришёл после «зашёл» в 20:05.
  // Если он победит, экран покажет свободный компьютер с клиентом за ним.
  const current = snapshot({ observed_user_kind: 'senet_user', observed_user_kind_at: '2026-08-19T20:05:00Z' })
  const patch = applyObservation(current, {
    userKind: { value: 'logonui', observedAt: '2026-08-19T20:00:00Z' },
  })
  assert.deepEqual(patch, {}, 'старое наблюдение просочилось в снимок')
})

test('более позднее наблюдение применяется', () => {
  const patch = applyObservation(snapshot(), {
    userKind: { value: 'senet_user', observedAt: '2026-08-19T20:01:00Z' },
  })
  assert.equal(patch.observed_user_kind, 'senet_user')
  assert.equal(patch.observed_user_kind_at, '2026-08-19T20:01:00Z')
})

test('повторная доставка того же события ничего не меняет', () => {
  const current = snapshot({ observed_user_kind: 'senet_user', observed_user_kind_at: '2026-08-19T20:05:00Z' })
  const patch = applyObservation(current, {
    userKind: { value: 'senet_user', observedAt: '2026-08-19T20:05:00Z' },
  })
  assert.deepEqual(patch, {}, 'одинаковое время должно означать «уже учтено»')
})

test('поля независимы: старая игра не блокирует свежего пользователя', () => {
  // Общий барьер на всю строку сделал бы именно это — и снимок замер бы из-за
  // одного опоздавшего события про процесс.
  const current = snapshot({
    observed_user_kind_at: '2026-08-19T20:00:00Z',
    observed_game_at: '2026-08-19T20:10:00Z',
    observed_game_process: 'cs2.exe',
  })
  const patch = applyObservation(current, {
    userKind: { value: 'senet_user', observedAt: '2026-08-19T20:05:00Z' },
    game: { process: 'steam.exe', path: null, observedAt: '2026-08-19T20:01:00Z' },
  })
  assert.equal(patch.observed_user_kind, 'senet_user', 'свежее наблюдение о пользователе не применилось')
  assert.equal(patch.observed_game_process, undefined, 'старое наблюдение об игре применилось')
})

test('наблюдение без времени не применяется вовсе', () => {
  const patch = applyObservation(snapshot(), { userKind: { value: 'senet_user', observedAt: null } })
  assert.deepEqual(patch, {})
})

test('первое наблюдение по пустому полю проходит', () => {
  const patch = applyObservation(snapshot(), {
    game: { process: 'cs2.exe', path: 'C:\\Games\\cs2.exe', observedAt: '2026-08-19T20:01:00Z' },
  })
  assert.equal(patch.observed_game_process, 'cs2.exe')
})

test('время загрузки только растёт', () => {
  // Меньшее значение означает событие от предыдущего запуска компьютера.
  const current = snapshot({ last_boot_at: '2026-08-19T18:00:00Z' })
  assert.deepEqual(applyObservation(current, { bootAt: '2026-08-19T17:00:00Z' }), {})
  assert.equal(applyObservation(current, { bootAt: '2026-08-19T19:00:00Z' }).last_boot_at, '2026-08-19T19:00:00Z')
})

test('битое время не роняет и не применяется', () => {
  assert.equal(shouldApply('не-дата', '2026-08-19T20:00:00Z'), false)
  assert.equal(shouldApply('2026-08-19T20:05:00Z', 'не-дата'), true)
})

// ─────────────────────────────────────────────────────────────────────────────
// Часы устройства
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_NOW = new Date('2026-08-19T20:00:00Z')

test('нормальное время проходит', () => {
  assert.deepEqual(checkClock('2026-08-19T19:59:00Z', SERVER_NOW, 300, 604800), { ok: true })
})

test('событие из будущего отклоняется с указанием расхождения', () => {
  // Пустив его в снимок, мы заморозили бы станцию навсегда: всё последующее
  // оказалось бы «старее» и не применилось.
  const result = checkClock('2026-08-19T20:10:00Z', SERVER_NOW, 300, 604800)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.reason, 'CLOCK_SKEW_FUTURE')
    assert.equal(result.skewSeconds, 600)
  }
})

test('небольшое опережение часов допустимо', () => {
  assert.deepEqual(checkClock('2026-08-19T20:02:00Z', SERVER_NOW, 300, 604800), { ok: true })
})

test('слишком старое событие отклоняется', () => {
  const result = checkClock('2026-08-01T20:00:00Z', SERVER_NOW, 300, 604800)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'TOO_OLD')
})

test('досланное после восстановления сети принимается', () => {
  // Устройство молчало час и досылает накопленное — это норма, а не сбой.
  assert.deepEqual(checkClock('2026-08-19T19:00:00Z', SERVER_NOW, 300, 604800), { ok: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// Классификация процессов
// ─────────────────────────────────────────────────────────────────────────────

test('лаунчер не является игрой', () => {
  assert.equal(classifyProcess('steam.exe'), 'launcher')
  assert.equal(classifyProcess('EpicGamesLauncher.exe'), 'launcher')
  assert.equal(classifyProcess('RiotClientServices.exe'), 'launcher')
})

test('мессенджер — фон', () => {
  assert.equal(classifyProcess('Discord.exe'), 'background')
})

test('служебное SENET отделено от игр', () => {
  assert.equal(classifyProcess('dashboard.exe'), 'infrastructure')
  assert.equal(classifyProcess('ServiceApp.exe'), 'infrastructure')
})

test('неизвестное — кандидат, а НЕ игра', () => {
  // Главное правило файла. Если сюда попадёт «игра», в аналитику приедут
  // антивирус, драйвер и обновление Windows.
  assert.equal(classifyProcess('cs2.exe'), 'unknown_candidate')
  assert.equal(classifyProcess('какой-то.exe'), 'unknown_candidate')
})

test('системные процессы не попадают в кандидаты', () => {
  assert.equal(classifyProcess('svchost.exe'), 'system')
  assert.equal(classifyProcess('explorer.exe'), 'system')
  assert.equal(classifyProcess('MsMpEng.exe'), 'system')
})

test('регистр и путь не мешают опознанию', () => {
  assert.equal(classifyProcess('C:\\Program Files\\Steam\\STEAM.EXE'), 'launcher')
  assert.equal(classifyProcess('  Discord.exe  '), 'background')
})

test('пустое имя не превращается в игру', () => {
  assert.equal(classifyProcess(null), 'unknown_candidate')
  assert.equal(classifyProcess(''), 'unknown_candidate')
})
