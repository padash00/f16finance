/**
 * Разбор действий, которых нет в приложении: что из них нужно на телефоне.
 *
 * Список в 270 строк глазами не разобрать — и не удержать в голове, чем
 * «Выгрузка в Excel» отличается от «Выдать аванс». Поэтому решение принимается
 * правилами, а спорное честно помечается «решить»: пусть лучше владелец
 * посмотрит десяток спорных, чем я молча решу за него две сотни.
 *
 * Правила простые и объяснимые:
 *   — за столом: выгрузки, печать, импорт, массовые операции, настройка
 *     правил, ролей и интеграций, удаление сущностей целиком;
 *   — на телефоне: то, что делают стоя и в моменте — завести, ответить,
 *     подтвердить, отметить, начислить;
 *   — решить: всё остальное.
 *
 * Запуск:
 *   node scripts/triage-mobile-actions.mjs            # печатает разбор
 *   node scripts/triage-mobile-actions.mjs --markdown # готовый документ
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'apple/Contracts/capabilities.json'), 'utf8'))
const nativeSection = fs.readFileSync(
  path.join(ROOT, 'apple/OrdaKit/Sources/OrdaKit/Access/NativeSection.swift'),
  'utf8',
)
const nativePages = new Set([...nativeSection.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]))

function swiftSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    // Сгенерированный каталог перечисляет все права строками — если его
    // читать, «есть в приложении» окажется вообще всё.
    if (full.includes('/.build/') || full.includes('/Tests/')) continue
    if (full.includes('/Access/Generated/')) continue
    if (entry.isDirectory()) swiftSources(full, out)
    else if (entry.name.endsWith('.swift')) out.push(full)
  }
  return out
}

const swift = swiftSources(path.join(ROOT, 'apple'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

// ── Правила ──────────────────────────────────────────────────────────────────

/** За столом: работа, которую не делают стоя у стойки. */
const DESK = [
  /\.export/, /\.export_/, /_export$/, /\.import/, /print_labels/, /\.upload/, /\.apply_backroom/,
  /bulk_/, /\.delete_all/, /\.delete_selected/, /\.reset_to_defaults/,
  /^salary-rules\./, /^access\./, /^structure\./, /^telegram\./, /^settings\./,
  /^production\./, /^store-purchase-plan\./, /^debug\./, /^categories\./,
  /_template$/, /\.setup_webhook/, /\.test_webhook/,
]

/** В моменте: делают стоя, между делом, при человеке. */
const POCKET = [
  /\.create$/, /\.respond/, /\.confirm/, /\.close$/, /\.mark_/, /\.toggle_active/,
  /\.adjust_/, /\.assign$/, /\.notify$/, /\.remind$/, /\.move$/, /\.return_to_/,
  /\.reset_password/, /\.send_/, /\.complete$/, /\.cancel$/, /\.dismiss$/, /\.restore$/,
]

function verdict(id) {
  if (DESK.some((rule) => rule.test(id))) return 'стол'
  if (POCKET.some((rule) => rule.test(id))) return 'телефон'
  return 'решить'
}

// ── Сбор ─────────────────────────────────────────────────────────────────────

const rows = []
for (const group of catalog.groups || []) {
  for (const page of group.pages || []) {
    if (!nativePages.has(page.id)) continue
    for (const capability of page.capabilities || []) {
      const id = capability.id
      if (id.endsWith('.view')) continue
      if (swift.includes(`"${id}"`)) continue
      rows.push({
        group: group.label,
        page: page.label,
        id,
        label: capability.label,
        severity: capability.severity || 'low',
        verdict: verdict(id),
      })
    }
  }
}

const counts = rows.reduce((acc, row) => {
  acc[row.verdict] = (acc[row.verdict] || 0) + 1
  return acc
}, {})

if (process.argv.includes('--markdown')) {
  const lines = []
  lines.push('# Действия, которых нет в приложении')
  lines.push('')
  lines.push(
    'Собрано `scripts/triage-mobile-actions.mjs` по каталогу прав и коду приложения. ' +
      'Считается «есть», если право упомянуто в Swift.',
  )
  lines.push('')
  lines.push(`Всего: **${rows.length}**. На телефон просятся **${counts['телефон'] || 0}**, ` +
    `работа за столом — **${counts['стол'] || 0}**, спорных — **${counts['решить'] || 0}**.`)
  lines.push('')
  for (const verdictName of ['телефон', 'решить', 'стол']) {
    const subset = rows.filter((row) => row.verdict === verdictName)
    if (subset.length === 0) continue
    lines.push(`## ${verdictName === 'телефон' ? 'Нужно на телефоне' : verdictName === 'решить' ? 'Спорные — решить владельцу' : 'Работа за столом'}`)
    lines.push('')
    lines.push('| Раздел | Действие | Право | Важность |')
    lines.push('|---|---|---|---|')
    for (const row of subset.sort((a, b) => a.page.localeCompare(b.page))) {
      lines.push(`| ${row.page} | ${row.label} | \`${row.id}\` | ${row.severity} |`)
    }
    lines.push('')
  }
  process.stdout.write(lines.join('\n'))
} else {
  console.log(`Действий без кнопки: ${rows.length}`)
  console.log(`  на телефон: ${counts['телефон'] || 0}`)
  console.log(`  за столом:  ${counts['стол'] || 0}`)
  console.log(`  решить:     ${counts['решить'] || 0}`)
  console.log('\n── На телефон ──')
  for (const row of rows.filter((r) => r.verdict === 'телефон')) {
    console.log(`  ${row.page}: ${row.label} (${row.id})`)
  }
}
