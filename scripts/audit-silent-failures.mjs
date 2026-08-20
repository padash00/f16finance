#!/usr/bin/env node
/**
 * Проглоченные ошибки в приложении.
 *
 * `try?` превращает отказ сервера в пустой экран. Человек видит «ничего нет» и
 * не может отличить это от «нет права», «устаревшая сборка», «запрос не
 * прошёл» — и рассказать, что именно не работает, ему нечем. Так и вышло с
 * заявками склада: одобрение не проходило месяцами, а на экране просто ничего
 * не менялось.
 *
 * Скрипт следит, чтобы обращений к серверу без разбора ошибки не становилось
 * больше. Оставшиеся перечислены ниже — про них известно, и они безобидны:
 * это фоновые мелочи, отказ которых экрану ничего не меняет.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'apple/Orda'

/**
 * Не обращения к серверу: пауза, чтение файла из галереи и показ локального
 * уведомления (`UNUserNotificationCenter.current().add`). Их `try?` — это не
 * проглоченный отказ сервера, а «не получилось — ну и ладно».
 */
const NOT_NETWORK = new Set(['sleep', 'loadTransferable', 'current'])

/**
 * Справочник точек. Его просит десяток экранов ради выпадающего списка, и
 * отказ по нему — пустой список выбора, а не пустой экран.
 */
const REFERENCE_CALLS = new Set(['companies', 'disabledCapabilities'])

/**
 * Известные и осознанные.
 *
 * Счётчики на значках: непрочитанные сообщения и открытые экзамены. Это фон,
 * который не должен мешать смене.
 *
 * Отправка адреса для уведомлений отсюда ушла: её отказ означал ноль устройств
 * в базе и «уведомления не приходят» без единой причины. Теперь причина
 * остаётся в `PushManager.lastRegistrationError`.
 */
const KNOWN = new Set([
  'CabinetStore.swift:threads',
  'CabinetStore.swift:exams',
  'FeedScreens.swift:markNewsViewed',
  'FeedScreens.swift:teamChat',
  'FeedScreens.swift:react',
  'FeedScreens.swift:deleteTeamMessage',
  'FeedScreens.swift:unpinTeamMessage',
  'FeedScreens.swift:pinTeamMessage',
  'FeedScreens.swift:conversation',
  'FeedScreens.swift:blockedUsers',
  'RetailScreens.swift:arenaSessions',
  'RetailScreens.swift:arenaBoard',
  'SalesKpiScreen.swift:report',
  'ProductionScreens.swift:order',
])

function swiftFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) swiftFiles(path, out)
    else if (entry.endsWith('.swift')) out.push(path)
  }
  return out
}

const found = []
for (const file of swiftFiles(ROOT)) {
  const source = readFileSync(file, 'utf8')
  const name = file.split('/').pop()
  for (const match of source.matchAll(/try\?\s*await\s+(?:self\.)?\w+\.(\w+)\(/g)) {
    const call = match[1]
    if (NOT_NETWORK.has(call) || REFERENCE_CALLS.has(call)) continue
    found.push({ key: `${name}:${call}`, file, call })
  }
}

const fresh = found.filter((item) => !KNOWN.has(item.key))
const fixed = [...KNOWN].filter((key) => !found.some((item) => item.key === key))

if (fixed.length > 0) {
  console.log('\n── Разобрано, уберите из списка в скрипте ──\n')
  for (const key of fixed) console.log(`  ${key}`)
}

if (fresh.length === 0) {
  console.log(`\nНовых проглоченных ошибок нет. В списке известных: ${found.length}.\n`)
  process.exit(0)
}

console.log('\n── Отказ сервера уходит в пустоту ──\n')
for (const item of fresh) {
  console.log(`  ${item.file}: ${item.call}()`)
}
console.log(
  '\nЧеловек увидит пустой экран и не поймёт, отказал сервер или данных нет.\n' +
    'Разберите ошибку и положите в ошибку своего раздела — так сделано\n' +
    'в CabinetStore.attempt и BusinessStore.attempt.\n',
)
process.exit(1)
