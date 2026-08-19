#!/usr/bin/env node
/**
 * База из браузера.
 *
 * Правило проекта: Supabase доступен только через серверные роуты. Когда
 * страница ходит в базу сама, право из каталога перестаёт что-либо значить —
 * данные отдаёт база, а не роут, — а фильтр по организации оказывается на
 * стороне, которой нельзя доверять. Ровно так вышло с аналитикой операторов и
 * с карточкой оператора: цифры и документы были открыты шире, чем показывали
 * настройки доступа.
 *
 * Скрипт следит, чтобы список таких мест только сокращался. Новые попадания —
 * ошибка сборки; про оставшиеся известно, они перечислены ниже и ждут очереди.
 *
 * Аутентификация (`supabase.auth.*`) и файлы (`supabase.storage.*`) сюда не
 * входят: сессия и загрузка файла в браузере — норма.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components']

/** Известные и ещё не разобранные. Список может только уменьшаться. */
const KNOWN = new Set([
  'app/(main)/access/page.tsx',
  'app/(main)/shifts/add/page.tsx',
  'app/(main)/shifts/report/page.tsx',
  'app/login/LoginForm.tsx',
])

function files(dir) {
  const out = []
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      out.push(...files(path))
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      out.push(path)
    }
  }
  return out
}

const offenders = []

for (const file of ROOTS.flatMap(files)) {
  // Серверные роуты — это и есть правильный путь к базе.
  if (file.startsWith('app/api/')) continue
  const src = readFileSync(file, 'utf8')
  const usesBrowserClient =
    src.includes("from '@/lib/supabaseClient'") || src.includes('createBrowserClient')
  if (!usesBrowserClient) continue
  // `.storage.from(...)` — файлы, а не таблицы.
  const tableReads = [...src.matchAll(/(?<!storage)\.from\('([a-z_]+)'\)/g)].map((m) => m[1])
  if (tableReads.length === 0) continue
  offenders.push({ file, tables: [...new Set(tableReads)] })
}

const fresh = offenders.filter((item) => !KNOWN.has(item.file))
const fixed = [...KNOWN].filter((file) => !offenders.some((item) => item.file === file))

if (fixed.length > 0) {
  console.log('\n── Разобрано, уберите из списка в скрипте ──\n')
  for (const file of fixed) console.log(`  ${file}`)
}

if (fresh.length === 0) {
  console.log(`\nНовых обращений к базе из браузера нет. Осталось разобрать: ${offenders.length}.\n`)
  process.exit(0)
}

console.log('\n── База из браузера, мимо роутов и прав ──\n')
for (const item of fresh) {
  console.log(`  ${item.file}`)
  console.log(`      таблицы: ${item.tables.join(', ')}`)
}
console.log(
  '\nПраво из каталога такие запросы не проверяет, скоуп организации — тоже.\n' +
    'Перенесите чтение и запись в серверный роут.\n',
)
process.exit(1)
