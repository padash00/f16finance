#!/usr/bin/env node
/**
 * Загрузка, которая никогда не запускается.
 *
 * `Group { if let x { … } }` без ветки `else` при пустом `x` схлопывается в
 * `EmptyView`. Модификаторы на нём не выполняются: `.task` и `.onAppear` не
 * сработают, экран останется пустым навсегда — а выглядит это как «сервер не
 * ответил» или «данных нет».
 *
 * Так пропала карточка своей зарплаты в профиле: запрос за ней не уходил
 * никогда, и разбирались с этим два захода — сначала грешили на деплой, потом
 * на привязку аккаунта.
 *
 * Правило: если у вида есть `.task` или `.onAppear`, у него должна быть ветка,
 * которая рисуется всегда. Заглушка «Загружаем…» и есть эта ветка.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['apple/Orda', 'apple/OrdaUI/Sources']

function swiftFiles(dir) {
  const out = []
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...swiftFiles(path))
    else if (entry.endsWith('.swift')) out.push(path)
  }
  return out
}

const problems = []

for (const file of ROOTS.flatMap(swiftFiles)) {
  const src = readFileSync(file, 'utf8')
  // `Group {` … `}` со следующим сразу `.task`/`.onAppear`.
  const pattern = /Group \{\n([\s\S]*?)\n(\s*)\}\n\s*\.(task|onAppear)\b/g
  let match
  while ((match = pattern.exec(src))) {
    const body = match[1]
    const hasCondition = /^\s*if /m.test(body)
    // Ветка, которая рисуется всегда: либо `else {`, либо ветка «ещё не
    // загрузили» — на первом кадре, когда всё состояние пустое, рисуется
    // именно она, и её достаточно, чтобы `.task` выполнился.
    const hasFallback =
      /\belse\s*\{/.test(body) || /\bif\s+!?(didLoad|isLoading|loaded|hasLoaded)\b/.test(body)
    if (hasCondition && !hasFallback) {
      const line = src.slice(0, match.index).split('\n').length
      problems.push({ file, line, modifier: match[3] })
    }
  }
}

if (problems.length === 0) {
  console.log('Загрузка привязана к видам, которые точно рисуются.')
  process.exit(0)
}

console.log('\n── Загрузка на виде, которого может не быть ──\n')
for (const problem of problems) {
  console.log(`  ${problem.file}:${problem.line} — .${problem.modifier} на Group без ветки else`)
}
console.log(
  '\nПустой Group — это EmptyView, а на нём модификаторы не выполняются:\n' +
    'запрос не уйдёт, экран останется пустым. Добавьте ветку, которая\n' +
    'рисуется всегда, — заглушку «Загружаем…».\n',
)
process.exit(1)
