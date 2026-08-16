/**
 * Все ли адреса, по которым ходит приложение, существуют на сервере.
 *
 * Опечатка в пути не ломает сборку: Swift не знает, какие маршруты есть в
 * Next.js. Обнаруживается она только когда человек откроет экран и увидит
 * «Не найдено» — а до этого сборка успевает уехать в App Store.
 *
 * Так нашлось `/api/operator/sales-kpi?month=…`: параметры были вписаны прямо
 * в путь, клиент кодирует путь целиком, и «?» становился частью адреса.
 *
 * Запуск:
 *   node scripts/audit-api-paths.mjs
 *
 * Проверяет три вещи:
 *   1. каждому адресу из Swift соответствует файл маршрута;
 *   2. в пути нет строки запроса — для неё есть отдельное поле `query`;
 *   3. метод запроса маршрут действительно экспортирует.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const API_ROOT = path.join(ROOT, 'app/api')

// ── Маршруты сервера ─────────────────────────────────────────────────────────

/** Собирает { сегменты пути → набор методов } по дереву app/api. */
function collectRoutes(dir, prefix = '/api', out = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectRoutes(full, `${prefix}/${entry.name}`, out)
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      const source = fs.readFileSync(full, 'utf8')
      const methods = new Set(
        [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)/g)].map(
          (m) => m[1],
        ),
      )
      out.set(prefix, methods)
    }
  }
  return out
}

const routes = collectRoutes(API_ROOT)

/**
 * Совпадает ли адрес с маршрутом. Динамические сегменты (`[id]`) принимают
 * что угодно, кроме пустоты.
 */
function matchRoute(requestPath) {
  const wanted = requestPath.split('/').filter(Boolean)
  for (const [route, methods] of routes) {
    const parts = route.split('/').filter(Boolean)
    if (parts.length !== wanted.length) continue
    const ok = parts.every((part, index) => {
      if (part.startsWith('[') && part.endsWith(']')) return wanted[index].length > 0
      return part === wanted[index]
    })
    if (ok) return { route, methods }
  }
  return null
}

// ── Обращения приложения ─────────────────────────────────────────────────────

function swiftSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (full.includes('/.build/') || full.includes('/Tests/')) continue
    if (entry.isDirectory()) swiftSources(full, out)
    else if (entry.name.endsWith('.swift')) out.push(full)
  }
  return out
}

/**
 * Интерполяция в пути — это идентификатор: `/api/x/\(id)` превращаем в
 * `/api/x/[id]`, чтобы сравнивать с динамическим сегментом маршрута.
 */
function normalize(raw) {
  return raw.replace(/\\\([^)]*\)/g, 'ID')
}

const calls = []
for (const file of swiftSources(path.join(ROOT, 'apple'))) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(ROOT, file)

  // `APIRequest(path: "…"` и `APIRequest.multipart("…"`.
  const patterns = [
    /APIRequest\(\s*path:\s*"([^"]+)"([\s\S]{0,200}?)\)/g,
    /APIRequest\.multipart\(\s*"([^"]+)"([\s\S]{0,200}?)\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const rawPath = match[1]
      if (!rawPath.startsWith('/api/')) continue
      const tail = match[2] || ''
      const method =
        (tail.match(/method:\s*\.(get|post|patch|put|delete)/) || [])[1]?.toUpperCase() ||
        (pattern.source.includes('multipart') ? 'POST' : 'GET')
      calls.push({ file: relative, rawPath, method })
    }
  }
}

// ── Проверки ─────────────────────────────────────────────────────────────────

const missing = []
const withQuery = []
const wrongMethod = []

for (const call of calls) {
  if (call.rawPath.includes('?')) {
    withQuery.push(call)
    continue
  }
  const matched = matchRoute(normalize(call.rawPath))
  if (!matched) {
    missing.push(call)
    continue
  }
  if (matched.methods.size > 0 && !matched.methods.has(call.method)) {
    wrongMethod.push({ ...call, has: [...matched.methods].join(', ') })
  }
}

const unique = (list) => {
  const seen = new Set()
  return list.filter((item) => {
    const key = `${item.rawPath}|${item.method}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

console.log(`Маршрутов на сервере: ${routes.size}`)
console.log(`Обращений в приложении: ${unique(calls).length}`)

let failed = false

function report(title, items, format) {
  console.log(`\n── ${title} ──`)
  const list = unique(items)
  if (list.length === 0) {
    console.log('  чисто')
    return
  }
  failed = true
  for (const item of list) console.log(`  ${format(item)}`)
}

report(
  'Строка запроса внутри пути',
  withQuery,
  (item) => `${item.rawPath}\n    ${item.file}\n    параметры передают через query, иначе «?» кодируется в путь`,
)
report('Маршрута нет на сервере', missing, (item) => `${item.method} ${item.rawPath}\n    ${item.file}`)
report(
  'Маршрут не принимает этот метод',
  wrongMethod,
  (item) => `${item.method} ${item.rawPath} — сервер умеет ${item.has}\n    ${item.file}`,
)

if (!failed) {
  console.log('\nВсе адреса приложения существуют на сервере и принимают нужный метод.')
}
process.exit(failed ? 1 : 0)
