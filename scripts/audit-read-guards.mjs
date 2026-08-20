/**
 * Чтение, закрытое «любым вошедшим».
 *
 * За день разбора одна и та же дыра нашлась восемь раз: действия в маршруте
 * закрыты правами по одному, а выдача списка — нет. Причина всегда одна и та
 * же: проверка `isSuperAdmin || staffRole` выглядит как проверка доступа, но
 * отвечает лишь на вопрос «это вообще сотрудник».
 *
 * Стоит это дорого: список — это все суммы точки за период, телефоны клиентов,
 * закупочные цены поставщиков. И читают их без следа: правку видно в журнале, а
 * чтение — нет.
 *
 * Проверка ищет GET-обработчики в админском контуре, где нет ни одной проверки
 * права. Роль и «любой staff» за проверку не считаются.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

function* walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name === 'route.ts') yield full
  }
}

/** Тело функции от её начала до следующего `export async function`. */
function handlerBody(source, method) {
  const start = source.indexOf(`export async function ${method}(`)
  if (start === -1) return null
  const rest = source.slice(start + 10)
  const next = rest.indexOf('\nexport async function ')
  return next === -1 ? rest : rest.slice(0, next)
}

/**
 * Тело обработчика вместе с помощниками, которых он зовёт.
 *
 * Проверка часто стоит не в самом обработчике, а в общей функции файла:
 * `resolveContext(request, 'sales-kpi.view')`, `resolveScope(request)`. Глядя
 * только в обработчик, аудит объявлял такие маршруты открытыми — и хуже:
 * помечал их «и без проверки входа», потому что и вход проверяется там же.
 *
 * Отчёт, где три четверти строк — ложная тревога, перестают читать целиком.
 */
function handlerWithHelpers(source, body) {
  let text = body
  const helpers = [...source.matchAll(/(?:async )?function (\w+)\s*\([^)]*\)[^{]*\{/g)]
  for (const [, name] of helpers) {
    if (!new RegExp(`\\b${name}\\(`).test(body)) continue
    const start = source.indexOf(`function ${name}`)
    if (start < 0) continue
    // До следующего объявления верхнего уровня: скобки считать незачем,
    // лишний хвост проверке не мешает.
    const rest = source.slice(start)
    const next = rest.slice(1).search(/\n(?:export )?(?:async )?function |\nexport async function /)
    text += next === -1 ? rest : rest.slice(0, next + 1)
  }
  return text
}

// Право спрашивают не только напрямую: половина маршрутов делает это через
// помощников, которым право передают аргументом. Не знать про них — значит
// поднимать ложную тревогу и приучать читателя пролистывать отчёт.
const CHECKS = new RegExp(
  [
    'require(?:Staff|Any)?Capability\\w*\\(',
    'requireSuperAdmin\\(',
    // Владелец организации — тоже проверка доступа, и строже права.
    'requireOwnerOrSuper\\(',
    // Платформенные выдачи отказывают прямо в теле: `if (!access.isSuperAdmin)
    // return 403`. Это проверка, а не ветка по роли — отличаем по `return`
    // сразу за условием.
    '!\\w+\\.isSuperAdmin\\)\\s*\\{?\\s*return',
    'requireStaffCapabilityRequest\\(',
    'resolveStoreKpiContext\\(',
    'requirePlatformAccess\\(',
    'isOwnerActor\\(',
    // Выдача может не закрываться целиком, а собираться по кускам: каждый блок
    // добавляется, только если право есть. Так сделаны уведомления, и это
    // лучше общей проверки — человек видит свою часть, а не отказ целиком.
    'hasCapability\\(',
  ].join('|'),
)
/**
 * Грубая проверка: «свой сотрудник» без разбора, какое именно право.
 *
 * Это не дыра — посторонний ничего не получит, — но и не право из каталога:
 * владелец, снявший раздел у должности, такую выдачу не закроет. Держим их
 * отдельным списком, чтобы настоящие дыры не тонули среди осознанных решений.
 */
const STAFF_ONLY = new RegExp(
  [
    '!\\w+\\.staffMember\\)',
    '!\\w+\\.staffRole\\)',
    '!canManage\\w*\\(',
    '!\\w+\\.isSuperAdmin && !',
  ].join('|'),
)

const openReads = []
const staffOnly = []

for (const file of walk(path.join(ROOT, 'app/api/admin'))) {
  const source = fs.readFileSync(file, 'utf8')
  const body = handlerBody(source, 'GET')
  if (!body) continue
  const guarded = handlerWithHelpers(source, body)

  // Право может проверяться не строкой, а переменной — это тоже проверка.
  if (CHECKS.test(guarded)) continue

  // Совсем открытых маршрутов не бывает: если нет даже входа, это отдельная
  // беда, и её видно по отсутствию контекста доступа.
  const hasAuth = guarded.includes('getRequestAccessContext') || guarded.includes('requirePointDevice')
  const route = file.replace(`${ROOT}/app/api/`, '/api/').replace('/route.ts', '')

  if (hasAuth && STAFF_ONLY.test(guarded)) {
    staffOnly.push({ route })
    continue
  }

  openReads.push({ route, hasAuth })
}

if (staffOnly.length > 0) {
  console.log('── Закрыто должностью, а не правом ──')
  for (const item of staffOnly) console.log(`  ${item.route}`)
  console.log(
    '\nПосторонний ничего не получит, но и владелец, снявший раздел у должности,\n' +
      'такую выдачу не закроет. Для справочников (точки, должности, шаблоны) это\n' +
      'осознанно: их просят десяток экранов, и своё право у них было бы выдумкой.\n',
  )
}

if (openReads.length === 0) {
  console.log('Открытых выдач нет: каждая админская выдача закрыта правом или должностью.')
  process.exit(0)
}

console.log('── Выдача без проверки права ──')
for (const item of openReads) {
  console.log(`  ${item.route}${item.hasAuth ? '' : '   ← и без проверки входа'}`)
}
console.log(`\nВсего: ${openReads.length}. Каждую надо посмотреть: бывает, что раздел общий по устройству дела`)
console.log('(новости, чат), но чаще это список, который закрыт в настройках и всё равно отдаётся.')
process.exit(1)
