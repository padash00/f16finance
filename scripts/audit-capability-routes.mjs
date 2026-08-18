/**
 * Права, которых никто не проверяет.
 *
 * Каталог прав — обещание: если право есть, значит где-то оно решает, можно
 * действие или нет. Право без единой проверки — фантом: владелец видит его в
 * настройках доступа, выключает — и ничего не меняется. Хуже того, по такому
 * праву можно неделю искать «недостающую кнопку», как это случилось с
 * «Создать перемещение»: право в каталоге есть, маршрута нет, а действие давно
 * работает под другим правом.
 *
 * Проверка простая: собрать идентификаторы из каталога и посмотреть, кто их
 * упоминает — сервер (requireCapability и родня) или интерфейс (can/canView).
 *
 *   нет нигде          → фантом, его надо убрать или реализовать
 *   только в интерфейсе → «замок на картинке»: сервер пустит любого
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

function* walk(dir, extensions) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full, extensions)
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      yield full
    }
  }
}

// ── Каталог ──────────────────────────────────────────────────────────────────

const catalog = fs.readFileSync(path.join(ROOT, 'lib/core/capabilities.ts'), 'utf8')
const declared = [...catalog.matchAll(/\{\s*id:\s*'([a-z0-9-]+\.[a-z0-9_]+)'\s*,\s*label:\s*'([^']+)'/g)].map(
  (match) => ({ id: match[1], label: match[2] }),
)

if (declared.length === 0) {
  console.error('Не удалось прочитать каталог прав — проверка бесполезна, чиню разбор.')
  process.exit(1)
}

// ── Кто их упоминает ─────────────────────────────────────────────────────────

const serverText = [...walk(path.join(ROOT, 'app/api'), ['.ts'])]
  .concat([...walk(path.join(ROOT, 'lib/server'), ['.ts'])])
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

const clientText = [...walk(path.join(ROOT, 'app'), ['.tsx'])]
  .concat([...walk(path.join(ROOT, 'components'), ['.tsx', '.ts'])])
  .concat([...walk(path.join(ROOT, 'apple/OrdaKit/Sources'), ['.swift'])])
  .concat([...walk(path.join(ROOT, 'apple/Orda'), ['.swift'])])
  // Сгенерированный каталог в приложении перечисляет все права до единого —
  // с ним «упоминается» становится правдой для чего угодно, и проверка теряет
  // смысл.
  .filter((file) => !file.includes('CapabilityCatalog+Generated'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

// Страничные охранники: requireStaffCapabilityRequest(req, 'operators') пускает
// на весь раздел разом. Право на просмотр такого раздела считается проверенным
// — оно и есть этот охранник.
const pageGuards = new Set(
  [...serverText.matchAll(/require(?:Staff)?Capability(?:Request)?\(\s*[^,]+,\s*'([a-z0-9-]+)'/g)].map(
    (match) => match[1],
  ),
)

const phantom = []
const uiOnly = []

for (const capability of declared) {
  const [page, action] = capability.id.split('.')
  if (action === 'view' && pageGuards.has(page)) continue

  const quoted = new RegExp(`['"\`]${capability.id.replace('.', '\\.')}['"\`]`)
  if (quoted.test(serverText)) continue
  if (quoted.test(clientText)) {
    uiOnly.push(capability)
  } else {
    phantom.push(capability)
  }
}

// ── Отчёт ────────────────────────────────────────────────────────────────────

if (phantom.length === 0 && uiOnly.length === 0) {
  console.log(`Права: все ${declared.length} проверяются на сервере`)
  process.exit(0)
}

if (phantom.length > 0) {
  console.log('── Право есть в каталоге, но его никто не проверяет ──')
  for (const item of phantom) console.log(`  ${item.id} — ${item.label}`)
  console.log('')
}

if (uiOnly.length > 0) {
  console.log('── Право проверяет только интерфейс ──')
  for (const item of uiOnly) console.log(`  ${item.id} — ${item.label}`)
  console.log('')
  console.log('Каждую строку надо смотреть глазами: бывает три случая.')
  console.log('  1. Сервер закрывает жёстче — например, только суперадмину. Тогда всё в порядке.')
  console.log('  2. Действие идёт через маршрут с другим правом. Тогда право в каталоге лишнее.')
  console.log('  3. Сервер не проверяет ничего. Тогда замок висит на картинке: кнопки человек')
  console.log('     не увидит, а запрос сервер примет.')
}

console.log(`\nВсего прав: ${declared.length}. Фантомов: ${phantom.length}. Только в интерфейсе: ${uiOnly.length}.`)
// Не роняем сборку: список — повод разобраться, а не запрет выпускать релиз.
