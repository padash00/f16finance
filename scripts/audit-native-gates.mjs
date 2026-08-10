/**
 * Сверка того, что показывает приложение, с тем, что пропустит сервер.
 *
 * Зачем: меню приложения строится из каталога прав — пункт показывается, если
 * у человека есть право страницы. Но роут может проверять не право страницы, а
 * роль напрямую (`role === 'owner'`) или право соседней страницы. Тогда пункт
 * есть, а данных нет: человек нажимает и упирается в отказ на пустом экране.
 *
 * Так нашлись «Техкарты» (сервер смотрит на роль) и «План закупа» (сервер
 * просит право «Заказы поставщикам»). Оба раза — по скриншоту от пользователя.
 * Этот скрипт находит такие места без скриншотов.
 *
 * Запуск:
 *   node scripts/audit-native-gates.mjs
 *
 * Что печатает:
 *   1. Роуты, требующие право не своей страницы.
 *   2. Роуты, проверяющие роль напрямую, — их ограничения должны быть
 *      перечислены в `NativeSection.allowedStaffRoles`.
 *   3. Разделы, у которых ограничение в Swift есть, а в роуте уже нет —
 *      значит, сервер починили и запись пора удалить.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CATALOG = path.join(ROOT, 'apple/Contracts/capabilities.json')
const NATIVE_SECTION = path.join(ROOT, 'apple/OrdaKit/Sources/OrdaKit/Access/NativeSection.swift')

// ── Каталог: страница → её права ─────────────────────────────────────────────

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))
const pageCapabilities = new Map()
const pageByPath = new Map()
for (const group of catalog.groups ?? []) {
  for (const page of group.pages ?? []) {
    pageCapabilities.set(page.id, new Set((page.capabilities ?? []).map((c) => c.id)))
    pageByPath.set(page.path, page.id)
  }
}

// ── Что зовёт приложение ─────────────────────────────────────────────────────

function swiftFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (full.includes('/.build/')) continue
    if (entry.isDirectory()) swiftFiles(full, out)
    else if (entry.name.endsWith('.swift')) out.push(full)
  }
  return out
}

const calledPaths = new Set()
for (const file of swiftFiles(path.join(ROOT, 'apple'))) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/path:\s*"(\/api\/[^"]+)"/g)) {
    calledPaths.add(match[1].replace(/\\\([^)]*\)/g, '[id]'))
  }
}

// ── Роут по адресу API ───────────────────────────────────────────────────────

function routeFileFor(apiPath) {
  let dir = path.join(ROOT, 'app')
  for (const part of apiPath.split('/').filter(Boolean)) {
    if (fs.existsSync(path.join(dir, part))) {
      dir = path.join(dir, part)
      continue
    }
    const dynamic = fs.existsSync(dir)
      ? fs.readdirSync(dir).find((name) => name.startsWith('['))
      : null
    if (!dynamic) return null
    dir = path.join(dir, dynamic)
  }
  const file = path.join(dir, 'route.ts')
  return fs.existsSync(file) ? file : null
}

/** Страница каталога, которую обслуживает адрес: самое длинное совпадение. */
function pageFor(apiPath) {
  const trimmed = apiPath.replace(/^\/api\/admin/, '').replace(/^\/api/, '')
  return (
    [...pageByPath.entries()]
      .filter(([pagePath]) => trimmed === pagePath || trimmed.startsWith(`${pagePath}/`))
      .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? null
  )
}

function getHandler(source) {
  const start = source.indexOf('export async function GET')
  if (start < 0) return ''
  const next = source.indexOf('export async function', start + 10)
  return source.slice(start, next < 0 ? source.length : next)
}

const ROLE_PATTERNS = [
  /role === '([a-z_]+)'/g,
  /staffRole === '([a-z_]+)'/g,
]

const foreignCapability = []
const roleGated = []

for (const apiPath of [...calledPaths].sort()) {
  const file = routeFileFor(apiPath)
  if (!file) continue
  const source = fs.readFileSync(file, 'utf8')
  const handler = getHandler(source)
  if (!handler) continue

  const page = pageFor(apiPath)
  const relative = path.relative(ROOT, file)

  // 1. Право не своей страницы.
  const required = new Set()
  for (const m of handler.matchAll(/requireCapability\([^,]+,\s*'([^']+)'/g)) required.add(m[1])
  for (const m of handler.matchAll(/requireAnyCapability\([^,]+,\s*\[([^\]]+)\]/g)) {
    for (const c of m[1].matchAll(/'([^']+)'/g)) required.add(c[1])
  }
  if (page && required.size) {
    const own = pageCapabilities.get(page) ?? new Set()
    const satisfiedByOwn = [...required].some((c) => own.has(c))
    if (!satisfiedByOwn) {
      foreignCapability.push({ apiPath, page, required: [...required], relative })
    }
  }

  // 2. Прямая проверка роли — в самом роуте или через общий помощник.
  const roles = new Set()
  for (const pattern of ROLE_PATTERNS) {
    for (const m of source.matchAll(pattern)) roles.add(m[1])
  }
  if (/isStoreManager\(/.test(handler)) {
    roles.add('owner')
    roles.add('manager')
  }
  if (roles.size && page) {
    roleGated.push({ apiPath, page, roles: [...roles].sort(), relative })
  }
}

// ── Что уже учтено в приложении ──────────────────────────────────────────────

const swift = fs.readFileSync(NATIVE_SECTION, 'utf8')
const declaredRoles = new Set()
const rolesBlock = swift.slice(swift.indexOf('public var allowedStaffRoles'))
for (const m of rolesBlock.slice(0, rolesBlock.indexOf('\n    }')).matchAll(/case \.([a-zA-Z]+):/g)) {
  declaredRoles.add(m[1])
}

// ── Отчёт ────────────────────────────────────────────────────────────────────

let problems = 0

console.log('── Право не своей страницы ──')
if (!foreignCapability.length) console.log('  чисто')
for (const item of foreignCapability) {
  problems += 1
  console.log(`  ${item.apiPath}`)
  console.log(`    страница «${item.page}», требует ${item.required.join(', ')}`)
  console.log(`    ${item.relative}`)
}

console.log('\n── Роут смотрит на роль, а не на право ──')
if (!roleGated.length) console.log('  чисто')
for (const item of roleGated) {
  console.log(`  ${item.apiPath} → «${item.page}»: ${item.roles.join(', ')}`)
  console.log(`    ${item.relative}`)
}

console.log('\n── Учтено в NativeSection.allowedStaffRoles ──')
console.log(`  ${[...declaredRoles].sort().join(', ') || '—'}`)
console.log(
  '\nСписок ограничений должен таять вместе с починкой сервера: как только роут',
  '\nначнёт проверять право вместо роли, запись в NativeSection нужно удалить.',
)

process.exit(problems > 0 ? 1 : 0)
