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

import { readFileSync } from 'node:fs'

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

/** Регион базы. Меняется вместе с проектом Supabase — не чаще раза в жизни. */
const DATABASE_REGION = 'fra1'

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
