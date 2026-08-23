#!/usr/bin/env node
/**
 * Сверка действий приложения с тем, что принимает сервер.
 *
 * Кнопка «Отправить на проверку» месяц не работала: приложение слало действие
 * `updateStatus`, которого у роута нет, и сервер отвечал «Неизвестное
 * действие». Ошибка не ловится ни компилятором, ни тестами — строка с обеих
 * сторон, и расходятся они молча.
 *
 * Скрипт достаёт из Swift все `"action": "…"` вместе с путём запроса и
 * сверяет с литералами, которые сравнивает соответствующий роут.
 *
 *   node scripts/audit-action-contracts.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function walk(dir, filter, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) {
      if (name === 'node_modules' || name === '.build' || name === '.next') continue
      walk(path, filter, out)
    } else if (filter(name)) {
      out.push(path)
    }
  }
  return out
}

/** Действия, которые шлёт приложение: путь → набор значений `action`. */
function collectClientActions() {
  const files = walk(join(ROOT, 'apple'), (name) => name.endsWith('.swift'))
  const byPath = new Map()

  for (const file of files) {
    const source = readFileSync(file, 'utf8')

    // Ищем блоки, где рядом стоят "action": "…" и path: "/api/…". Порядок
    // бывает любой, поэтому смотрим окно в 600 символов вокруг действия.
    // Два способа собрать тело: словарь с "action" и Encodable-структура со
    // строковым полем `action`. Второй встречается чаще, чем кажется.
    const actionRe = /(?:"action"\s*:\s*"([a-zA-Z0-9_.-]+)")|(?:\blet\s+action\s*=\s*"([a-zA-Z0-9_.-]+)")/g
    let match
    while ((match = actionRe.exec(source))) {
      const action = match[1] || match[2]
      // Берём БЛИЖАЙШИЙ адрес, а не первый попавшийся в окне. Первый — это
      // часто хвост предыдущей функции: `addTaskComment` объявляет действие,
      // а на 600 символов выше заканчивается соседний метод со своим путём, и
      // аудит рапортовал, что комментарий к задаче шлют в живую активность.
      const from = Math.max(0, match.index - 600)
      const window = source.slice(from, match.index + 600)
      // Форм вызова несколько, и знать надо все: пропущенная форма означает,
      // что действие припишется соседнему адресу — и отчёт назовёт поломкой
      // исправный код.
      const candidates = [
        ...window.matchAll(/path:\s*"(\/api\/[^"]+)"/g),
        ...window.matchAll(/APIRequest\.multipart\(\s*"(\/api\/[^"]+)"/g),
        ...window.matchAll(/APIRequest\.json\(\s*"(\/api\/[^"]+)"/g),
        ...window.matchAll(/APIRequest\(\s*"(\/api\/[^"]+)"/g),
      ]
      if (!candidates.length) continue
      const anchor = match.index - from
      const pathMatch = candidates.sort(
        (left, right) => Math.abs(left.index - anchor) - Math.abs(right.index - anchor),
      )[0]

      // Путь может содержать подстановку — берём часть до неё.
      const path = pathMatch[1].split('\\(')[0].replace(/\/$/, '')
      if (!byPath.has(path)) byPath.set(path, new Set())
      byPath.get(path).add(action)
    }
  }
  return byPath
}

/** Действия, которые принимает роут. */
function collectServerActions(apiPath) {
  const file = join(ROOT, 'app', apiPath.replace(/^\/+/, ''), 'route.ts')
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    return null
  }

  const actions = new Set()
  // `body.action === 'x'`, `action: 'x'` в типе, `case 'x':`
  for (const re of [
    /action\s*===\s*'([a-zA-Z0-9_.-]+)'/g,
    /action:\s*'([a-zA-Z0-9_.-]+)'/g,
    /case\s+'([a-zA-Z0-9_.-]+)'\s*:/g,
  ]) {
    let match
    while ((match = re.exec(source))) actions.add(match[1])
  }
  collectUnionActions(source, actions)
  return actions
}

/**
 * Действия, перечисленные типом: `action?: 'signIn' | 'refresh'`.
 *
 * Роут может не сравнивать каждое из них явно — например, брать `signIn`
 * значением по умолчанию. Для сверки это всё равно принятое действие.
 */
function collectUnionActions(source, actions) {
  const unionRe = /\baction\??\s*:\s*((?:'[^']+'\s*\|\s*)+'[^']+')/g
  let match
  while ((match = unionRe.exec(source))) {
    for (const value of match[1].matchAll(/'([^']+)'/g)) actions.add(value[1])
  }
}

const client = collectClientActions()
const problems = []
let checked = 0

for (const [path, actions] of [...client.entries()].sort()) {
  const server = collectServerActions(path)
  if (server === null) {
    problems.push({ path, kind: 'нет роута', actions: [...actions] })
    continue
  }
  checked += actions.size
  const missing = [...actions].filter((action) => !server.has(action))
  if (missing.length > 0) {
    problems.push({ path, kind: 'сервер не знает действие', actions: missing, known: [...server] })
  }
}

// Действия без явной пары «путь + действие» проверяем по всему серверу: если
// такого действия не принимает ни один роут, оно точно ошибочно.
const allServerActions = new Set()
for (const file of walk(join(ROOT, 'app', 'api'), (name) => name === 'route.ts')) {
  const source = readFileSync(file, 'utf8')
  for (const re of [
    /action\s*===\s*'([a-zA-Z0-9_.-]+)'/g,
    /action:\s*'([a-zA-Z0-9_.-]+)'/g,
    /case\s+'([a-zA-Z0-9_.-]+)'\s*:/g,
  ]) {
    let match
    while ((match = re.exec(source))) allServerActions.add(match[1])
  }
  collectUnionActions(source, allServerActions)
}

const orphan = []
for (const file of walk(join(ROOT, 'apple'), (name) => name.endsWith('.swift'))) {
  const source = readFileSync(file, 'utf8')
  const re = /(?:"action"\s*:\s*"([a-zA-Z0-9_.-]+)")|(?:\blet\s+action\s*=\s*"([a-zA-Z0-9_.-]+)")/g
  let match
  while ((match = re.exec(source))) {
    const action = match[1] || match[2]
    if (!allServerActions.has(action)) {
      orphan.push({ action, file: file.replace(ROOT + '/', '') })
    }
  }
}

console.log(`Проверено действий: ${checked}\n`)

if (orphan.length > 0) {
  console.log('── Действия, которых не знает ни один роут')
  for (const item of orphan) console.log(`   ${item.action} — ${item.file}`)
  console.log()
}

if (problems.length === 0 && orphan.length === 0) {
  console.log('Расхождений нет: всё, что шлёт приложение, сервер принимает.')
  process.exit(0)
}

for (const problem of problems) {
  console.log(`── ${problem.path} — ${problem.kind}`)
  console.log(`   шлём: ${problem.actions.join(', ')}`)
  if (problem.known?.length) {
    console.log(`   принимает: ${problem.known.sort().join(', ')}`)
  }
  console.log()
}

// Ненулевой код — чтобы расхождение было видно в проверках, а не только глазами.
process.exit(1)
