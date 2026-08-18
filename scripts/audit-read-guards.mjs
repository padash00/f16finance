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

// Право спрашивают не только напрямую: половина маршрутов делает это через
// помощников, которым право передают аргументом. Не знать про них — значит
// поднимать ложную тревогу и приучать читателя пролистывать отчёт.
const CHECKS = new RegExp(
  [
    'require(?:Staff|Any)?Capability\\w*\\(',
    'requireSuperAdmin\\(',
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
const openReads = []

for (const file of walk(path.join(ROOT, 'app/api/admin'))) {
  const source = fs.readFileSync(file, 'utf8')
  const body = handlerBody(source, 'GET')
  if (!body) continue

  // Право может проверяться не строкой, а переменной — это тоже проверка.
  if (CHECKS.test(body)) continue

  // Совсем открытых маршрутов не бывает: если нет даже входа, это отдельная
  // беда, и её видно по отсутствию контекста доступа.
  const hasAuth = body.includes('getRequestAccessContext') || body.includes('requirePointDevice')
  openReads.push({
    route: file.replace(`${ROOT}/app/api/`, '/api/').replace('/route.ts', ''),
    hasAuth,
  })
}

if (openReads.length === 0) {
  console.log('Чтение: у всех админских выдач есть проверка права')
  process.exit(0)
}

console.log('── Выдача без проверки права ──')
for (const item of openReads) {
  console.log(`  ${item.route}${item.hasAuth ? '' : '   ← и без проверки входа'}`)
}
console.log(`\nВсего: ${openReads.length}. Каждую надо посмотреть: бывает, что раздел общий по устройству дела`)
console.log('(новости, чат), но чаще это список, который закрыт в настройках и всё равно отдаётся.')
