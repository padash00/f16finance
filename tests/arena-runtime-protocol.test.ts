/**
 * Совместимость протокола: сервер обязан понимать старые устройства.
 *
 * Урок с боевой станции 21. Я поменял формат списка процессов на сервере — и
 * probe, работавший на машине, замолчал с ошибкой разбора. На одной машине это
 * неприятно; на семидесяти семи бездисковых это означало бы, что мониторинг
 * ослеп до пересборки мастер-образа, то есть до остановки клуба.
 *
 * Отсюда правило, которое эти тесты охраняют: **новая версия сервера обязана
 * принимать данные от старой версии агента**. Обновление сервера не может
 * требовать одновременного обновления парка.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyProcess } from '@/lib/domain/arena-runtime/process-classification'

/**
 * Повторяет правило выбора кандидата из heartbeat-роута.
 *
 * Вынесено в тест намеренно: правило простое, но ошибка в нём приводит к
 * тому, что в аналитике игрой окажется служебная программа, — а заметить это
 * можно только глазами, случайно.
 */
function pickCandidate(
  processes: Array<string | { name: string; memoryMb?: number | null; hasWindow?: boolean | null }>,
): string | null {
  const normalized = processes.map((process) =>
    typeof process === 'string'
      ? { name: process, memoryMb: null as number | null, hasWindow: null as boolean | null }
      : { name: process.name, memoryMb: process.memoryMb ?? null, hasWindow: process.hasWindow ?? null },
  )

  const candidates = normalized.filter((p) => classifyProcess(p.name) === 'unknown_candidate')
  const withWindow = candidates.filter((p) => p.hasWindow)
  const pool = withWindow.length > 0 ? withWindow : candidates
  return pool.slice().sort((a, b) => (b.memoryMb ?? 0) - (a.memoryMb ?? 0))[0]?.name ?? null
}

test('старое устройство присылает просто имена — данные принимаются', () => {
  const candidate = pickCandidate(['steam.exe', 'AppNotify.exe', 'cs2.exe', 'svchost.exe'])
  assert.ok(candidate !== null, 'список строк должен обрабатываться, а не отвергаться')
})

test('новое устройство присылает вес и окно — выбирается игра, а не служба', () => {
  // Ровно случай со станции 21: при запущенной CS2 система показывала
  // AppNotify.exe, потому что он раньше по алфавиту.
  const candidate = pickCandidate([
    { name: 'AppNotify.exe', memoryMb: 12, hasWindow: false },
    { name: 'cs2.exe', memoryMb: 3200, hasWindow: true },
    { name: 'steam.exe', memoryMb: 400, hasWindow: true },
  ])
  assert.equal(candidate, 'cs2.exe')
})

test('окно важнее веса', () => {
  // Служба обновления может весить больше игры в момент загрузки файлов, но
  // окна у неё нет — и человек за компьютером её не видит.
  const candidate = pickCandidate([
    { name: 'HeavyUpdater.exe', memoryMb: 5000, hasWindow: false },
    { name: 'cs2.exe', memoryMb: 2000, hasWindow: true },
  ])
  assert.equal(candidate, 'cs2.exe')
})

test('смешанный список от разных версий не ломается', () => {
  const candidate = pickCandidate([
    'AppNotify.exe',
    { name: 'cs2.exe', memoryMb: 3000, hasWindow: true },
  ])
  assert.equal(candidate, 'cs2.exe')
})

test('известная инфраструктура не попадает в кандидаты никогда', () => {
  // Список со станции 21: всё, что там крутится постоянно.
  const candidate = pickCandidate([
    { name: 'clubnetsvc.exe', memoryMb: 40, hasWindow: false },
    { name: 'AppNotify.exe', memoryMb: 12, hasWindow: false },
    { name: 'steam.exe', memoryMb: 400, hasWindow: true },
    { name: 'svchost.exe', memoryMb: 90, hasWindow: false },
  ])
  assert.equal(candidate, null, 'при одной лишь обвязке кандидата быть не должно')
})

test('пустой список не превращается в игру', () => {
  assert.equal(pickCandidate([]), null)
})
