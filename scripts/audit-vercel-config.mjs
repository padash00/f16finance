#!/usr/bin/env node
/**
 * Проверка vercel.json.
 *
 * Файл разбирает не наш код, а Vercel — и по строгой схеме: лишний ключ роняет
 * деплой целиком. Однажды я вписал туда `$comment` с объяснением, зачем нужен
 * регион, и выкатка упала — объяснение попало в файл, который комментариев не
 * принимает.
 *
 * Заодно следим за главным: регион функций должен совпадать с регионом базы.
 * Стоял Токио при базе во Франкфурте — каждый запрос к базе шёл через полмира,
 * около четверти секунды впустую, и «всё долго грузится» объяснялось этим, а не
 * тяжёлыми запросами.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ALLOWED_KEYS = new Set([
  'buildCommand',
  'cleanUrls',
  'crons',
  'devCommand',
  'framework',
  'functions',
  'git',
  'headers',
  'ignoreCommand',
  'images',
  'installCommand',
  'outputDirection',
  'outputDirectory',
  'public',
  'redirects',
  'regions',
  'rewrites',
  'trailingSlash',
])

/**
 * Регион базы.
 *
 * Токио, а не Франкфурт — и это стоило двух ошибок подряд. Сначала я увёз
 * функции во Франкфурт, прочитав регион у чужих проектов Supabase: проекта
 * Orda в доступном аккаунте нет, а соседние действительно в eu-central-1.
 * Потом эта проверка закрепила ошибку как правило.
 *
 * Правда проверяется адресом самой базы, а не списком проектов:
 *
 *     dig +short AAAA db.tmudsqgagblmdctaosgw.supabase.co
 *     → 2406:da14:...   а блок 2406:da14::/35 у AWS — это ap-northeast-1
 *
 * Франкфуртские адреса начинаются с 2a05:d0xx. Ничего похожего там нет.
 */
const DATABASE_REGION = 'hnd1'

let config
try {
  config = JSON.parse(readFileSync('vercel.json', 'utf8'))
} catch (error) {
  console.log(`\nvercel.json не разбирается: ${error.message}\n`)
  process.exit(1)
}

const problems = []

for (const key of Object.keys(config)) {
  if (!ALLOWED_KEYS.has(key)) {
    problems.push(
      `лишний ключ «${key}» — Vercel отвергает файл целиком, деплой не состоится.\n` +
        '      Комментарии сюда не поместятся: объяснение — в коде или в docs.',
    )
  }
}

// ── .vercelignore ────────────────────────────────────────────────────────────
//
// Правило без ведущего слэша совпадает с любым путём, где встречается такое
// имя. Строка `mobile/` выбрасывала не только приложение в корне, но и
// `app/api/mobile/` — роуты уведомлений. Файлы были в репозитории, собирались
// локально, а на бою отвечали 404: телефон отправлял адрес в пустоту.
try {
  const ignore = readFileSync('.vercelignore', 'utf8')
  for (const line of ignore.split('\n')) {
    const rule = line.trim()
    if (!rule || rule.startsWith('#') || rule.startsWith('/') || rule.startsWith('*')) continue
    const name = rule.replace(/\/$/, '')
    if (existsSync(join('app', 'api', name)) || existsSync(join('app', name))) {
      problems.push(
        `правило «${rule}» выбросит и app/api/${name} — на бою этих роутов не будет.\n` +
          '      Поставьте ведущий слэш: правило станет только про корень.',
      )
    } else {
      problems.push(
        `правило «${rule}» без ведущего слэша: совпадёт с любым путём, где есть\n` +
          `      такое имя. Сегодня совпадений нет, но появится app/api/${name} — и\n` +
          '      он молча исчезнет с боя. Поставьте ведущий слэш.',
      )
    }
  }
} catch {
  // Файла может не быть — это нормально.
}

const regions = config.regions || []
if (regions.length > 0 && !regions.includes(DATABASE_REGION)) {
  problems.push(
    `регион функций ${regions.join(', ')} не совпадает с регионом базы (${DATABASE_REGION}).\n` +
      '      Каждый запрос к базе будет ходить через полмира — это сотни миллисекунд\n' +
      '      на каждый, и никакая оптимизация запросов этого не перевесит.',
  )
}

if (problems.length === 0) {
  console.log(`\nvercel.json в порядке: регион ${regions.join(', ') || 'по умолчанию'}.\n`)
  process.exit(0)
}

console.log('\n── vercel.json ──\n')
for (const problem of problems) console.log(`  · ${problem}`)
console.log('')
process.exit(1)
