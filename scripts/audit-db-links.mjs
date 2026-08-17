/**
 * Проверка связей, которые живут в таблице-связке, а не колонкой.
 *
 * `point_projects` не знает про компанию: проект обслуживает несколько
 * компаний, и связь лежит в `point_project_companies`. Колонки `company_id` у
 * него нет — но запрос `.from('point_projects').eq('company_id', …)` не падает,
 * а просто ничего не находит. Так зал оператора отвечал «нет проекта точки» на
 * каждой точке, и выглядело это не поломкой, а настройкой.
 *
 * Проверка статическая: ищем фильтр по несуществующей колонке в цепочке
 * запроса к такой таблице.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Все .ts/.tsx под каталогом. */
function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(full)
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      yield full
    }
  }
}

/** Таблица → колонки, которых у неё нет, и где искать связь вместо них. */
const LINK_TABLES = {
  point_projects: {
    missing: ['company_id'],
    hint: 'связь с компанией лежит в point_project_companies (project_id, company_id)',
  },
}

const roots = ['app', 'lib']
const problems = []

for (const root of roots) {
  for (const file of walkFiles(path.join(process.cwd(), root))) {
    const source = fs.readFileSync(file, 'utf8')

    for (const [table, rule] of Object.entries(LINK_TABLES)) {
      const from = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)`, 'g')
      let match

      while ((match = from.exec(source)) !== null) {
        // Цепочка запроса — до следующей точки с запятой или закрывающего
        // блока: дальше идёт уже другой вызов.
        const chain = source.slice(match.index, match.index + 600)
        for (const column of rule.missing) {
          const filter = new RegExp(`\\.(eq|in|neq)\\(\\s*['"\`]${column}['"\`]`)
          if (filter.test(chain)) {
            const line = source.slice(0, match.index).split('\n').length
            problems.push({
              file: file.replace(`${process.cwd()}/`, ''),
              line,
              table,
              column,
              hint: rule.hint,
            })
          }
        }
      }
    }
  }
}

if (problems.length === 0) {
  console.log('Связи через таблицы-связки: чисто')
  process.exit(0)
}

console.log('── Фильтр по колонке, которой нет ──')
for (const problem of problems) {
  console.log(`  ${problem.table}.${problem.column} → ${problem.file}:${problem.line}`)
  console.log(`    ${problem.hint}`)
}
console.log('\nТакой запрос ничего не находит и не падает: маршрут отвечает «не найдено» всегда.')
process.exit(1)
