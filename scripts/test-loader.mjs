// ESM resolve-hook для `node --test`: позволяет тестам импортировать исходники
// проекта так же, как это делает Next/TS — то есть с алиасом `@/...` и без
// расширений файлов. Никаких npm-зависимостей (vitest/jest не ставим, чтобы не
// трогать lock-файлы и деплой). TypeScript Node 24 разбирает сам (type stripping).
import { pathToFileURL, fileURLToPath } from 'node:url'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']

function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const e of EXTS) if (existsSync(base + e)) return base + e
  for (const e of EXTS) {
    const idx = path.join(base, 'index' + e)
    if (existsSync(idx)) return idx
  }
  return null
}

export async function resolve(specifier, context, next) {
  // Алиас @/ → корень проекта
  if (specifier.startsWith('@/')) {
    const target = resolveFile(path.join(root, specifier.slice(2)))
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true }
  }
  // Относительные импорты без расширения (TS-стиль): ./foo → ./foo.ts
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
    if (context.parentURL && context.parentURL.startsWith('file:')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL))
      const target = resolveFile(path.resolve(parentDir, specifier))
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true }
    }
  }
  return next(specifier, context)
}
