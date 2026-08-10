/**
 * Какие действия выданы правами, но их негде нажать.
 *
 * Правило простое: если владелец выдал право, человек должен увидеть действие.
 * Обратное — «показали то, чего сервер не пустит» — проверяет
 * `audit-native-gates.mjs`. Этот скрипт про противоположный перекос: право
 * есть, кнопки нет, и человек считает, что доступ не выдали.
 *
 * Так нашлось «Создать задачу»: право `tasks.create` жило в каталоге, экран
 * задач умел только показывать, и поставить задачу с телефона было нельзя.
 *
 * Запуск:
 *   node scripts/audit-native-actions.mjs
 *
 * Печатает по нативным разделам: действия каталога, которых нет в приложении.
 * Считается «есть», если Swift упоминает право в `can("…")` или шлёт запрос,
 * который его требует.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'apple/Contracts/capabilities.json'), 'utf8'))
const nativeSection = fs.readFileSync(
  path.join(ROOT, 'apple/OrdaKit/Sources/OrdaKit/Access/NativeSection.swift'),
  'utf8',
)

/** Страницы, у которых в приложении есть экран. */
const nativePages = new Set([...nativeSection.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]))

function swiftSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (full.includes('/.build/') || full.includes('/Tests/')) continue
    if (entry.isDirectory()) swiftSources(full, out)
    else if (entry.name.endsWith('.swift')) out.push(full)
  }
  return out
}

const swift = swiftSources(path.join(ROOT, 'apple'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

/** Права, которые приложение упоминает явно. */
const mentioned = new Set([...swift.matchAll(/can(?:Any)?\(\s*"([a-z0-9_.-]+)"/g)].map((m) => m[1]))

/**
 * Действия, которые в приложении есть, но выражены не правом, а вызовом:
 * запрос уходит, сервер проверяет право сам. Здесь их перечисляем, чтобы
 * отчёт не звал делать сделанное.
 */
const IMPLEMENTED_WITHOUT_CHECK = new Set([
  'news.view',
  'messages.send', // операторам права не выдаются — отдельный разговор
  'team-chat.view',
])

const gaps = []
for (const group of catalog.groups ?? []) {
  for (const page of group.pages ?? []) {
    if (!nativePages.has(page.id)) continue
    const missing = (page.capabilities ?? [])
      .filter((c) => !c.id.endsWith('.view'))
      .filter((c) => !mentioned.has(c.id) && !IMPLEMENTED_WITHOUT_CHECK.has(c.id))
    if (missing.length) {
      gaps.push({ group: group.label, page: page.label, id: page.id, missing })
    }
  }
}

const totalActions = catalog.groups.flatMap((g) => g.pages).flatMap((p) => p.capabilities ?? [])
  .filter((c) => !c.id.endsWith('.view')).length

console.log(`Действий в каталоге: ${totalActions}`)
console.log(`Нет в приложении:    ${gaps.reduce((sum, g) => sum + g.missing.length, 0)}\n`)

let currentGroup = null
for (const gap of gaps.sort((a, b) => a.group.localeCompare(b.group))) {
  if (gap.group !== currentGroup) {
    currentGroup = gap.group
    console.log(`── ${currentGroup} ──`)
  }
  console.log(`  ${gap.page}`)
  for (const capability of gap.missing) console.log(`      ${capability.id} — ${capability.label}`)
}
