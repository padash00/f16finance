#!/usr/bin/env node
/**
 * Синхронизация проекта с Obsidian-хранилищем.
 *
 * Две разные вещи в одной команде:
 *   «Карта системы» — ПЕРЕСОБИРАЕТСЯ из кода при каждом запуске. Правки руками
 *                     там затрутся, и это правильно: карта должна отражать код,
 *                     а не то, что о нём когда-то написали.
 *   «Журнал»        — только ДОПИСЫВАЕТСЯ. Ничего не перезаписывает, поэтому
 *                     свои заметки в дневных файлах в безопасности.
 *
 * Запускается хуком после каждой сессии Claude Code и вручную:
 *   node scripts/vault-sync.mjs
 *
 * Путь к хранилищу — ORDA_VAULT_PATH, иначе значение по умолчанию ниже.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VAULT = process.env.ORDA_VAULT_PATH || 'C:\\Users\\Арыстан\\Documents\\Obsidian Vault'
const ROOT = path.join(VAULT, 'Orda')
const MAP = path.join(ROOT, 'Карта системы')
const JOURNAL = path.join(ROOT, 'Журнал')
const STATE = path.join(ROOT, '.sync-state.json')

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function ensureDirs() {
  for (const dir of [ROOT, MAP, JOURNAL, path.join(ROOT, 'Решения')]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(REPO, relativePath), 'utf8')
  } catch {
    return ''
  }
}

function git(command) {
  try {
    return execSync(`git ${command}`, { cwd: REPO, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'))
  } catch {
    return { lastCommit: null }
  }
}

function saveState(state) {
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), 'utf8')
}

// ─── Карта системы ─────────────────────────────────────────────────────────

/** Разделы и страницы бокового меню — из единственного источника навигации. */
function collectNav() {
  const source = read('lib/nav/sections.tsx')
  const sections = []
  const sectionRe = /id:\s*'([^']+)',\s*\n\s*title:\s*'([^']+)'/g
  let match
  while ((match = sectionRe.exec(source))) {
    sections.push({ id: match[1], title: match[2], index: match.index, items: [] })
  }
  const itemRe = /\{\s*href:\s*'([^']+)',\s*label:\s*'([^']+)'/g
  while ((match = itemRe.exec(source))) {
    const owner = [...sections].reverse().find((section) => section.index < match.index)
    if (owner) owner.items.push({ href: match[1], label: match[2] })
  }
  return sections
}

/** Все API-маршруты, сгруппированные по первому сегменту после /api. */
function collectApiRoutes() {
  const base = path.join(REPO, 'app', 'api')
  const routes = []
  const walk = (dir) => {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts') {
        routes.push('/' + path.relative(path.join(REPO, 'app'), path.dirname(full)).split(path.sep).join('/'))
      }
    }
  }
  walk(base)

  const groups = new Map()
  for (const route of routes.sort()) {
    const key = route.split('/')[2] || 'прочее'
    groups.set(key, [...(groups.get(key) || []), route])
  }
  return groups
}

/** Разделы каталога прав: сколько страниц и действий в каждом. */
function collectCapabilities() {
  const source = read('lib/core/capabilities.ts')
  const groups = []
  const groupRe = /id:\s*'([a-z-]+)',\s*\n\s*label:\s*'([^']+)',\s*\n\s*pages:/g
  let match
  while ((match = groupRe.exec(source))) {
    groups.push({ id: match[1], label: match[2], index: match.index, pages: 0, caps: 0 })
  }
  const pageRe = /path:\s*'(\/[^']*)'/g
  while ((match = pageRe.exec(source))) {
    const owner = [...groups].reverse().find((group) => group.index < match.index)
    if (owner) owner.pages += 1
  }
  const capRe = /\{\s*id:\s*'([a-z0-9-]+\.[a-z_]+)'/g
  while ((match = capRe.exec(source))) {
    const owner = [...groups].reverse().find((group) => group.index < match.index)
    if (owner) owner.caps += 1
  }
  return groups
}

/** Миграции: сколько всего и последние — по ним видно, что ждёт применения. */
function collectMigrations() {
  try {
    return fs
      .readdirSync(path.join(REPO, 'supabase', 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()
  } catch {
    return []
  }
}

function writeSystemMap() {
  const stamp = new Date().toISOString().slice(0, 10)
  const nav = collectNav()
  const api = collectApiRoutes()
  const caps = collectCapabilities()
  const migrations = collectMigrations()
  const apiTotal = [...api.values()].reduce((sum, list) => sum + list.length, 0)

  const header = (title) =>
    `# ${title}\n\n> Пересобирается из кода командой \`node scripts/vault-sync.mjs\`.\n> Править руками бесполезно — затрётся. Обновлено ${stamp}.\n\n`

  fs.writeFileSync(
    path.join(MAP, 'Страницы.md'),
    header('Страницы') +
      `Всего разделов: ${nav.length}, страниц: ${nav.reduce((sum, s) => sum + s.items.length, 0)}.\n\n` +
      nav
        .map(
          (section) =>
            `## ${section.title}\n\n` +
            section.items.map((item) => `- \`${item.href}\` — ${item.label}`).join('\n'),
        )
        .join('\n\n') +
      '\n',
    'utf8',
  )

  fs.writeFileSync(
    path.join(MAP, 'API.md'),
    header('API') +
      `Всего маршрутов: ${apiTotal}.\n\n` +
      [...api.entries()]
        .map(([group, list]) => `## ${group} (${list.length})\n\n` + list.map((route) => `- \`${route}\``).join('\n'))
        .join('\n\n') +
      '\n',
    'utf8',
  )

  fs.writeFileSync(
    path.join(MAP, 'Права.md'),
    header('Права') +
      'Модель fail-open: staff-роль базово получает ВЕСЬ каталог, на /access права только отнимаются.\n' +
      'Владелец проходит мимо проверок всегда. Доступ к страницам — наоборот, fail-closed, через `position_paths`.\n\n' +
      `| Раздел | Страниц | Действий явно |\n| --- | ---: | ---: |\n` +
      caps.map((group) => `| ${group.label} | ${group.pages} | ${group.caps} |`).join('\n') +
      `\n| **Итого** | **${caps.reduce((s, g) => s + g.pages, 0)}** | **${caps.reduce((s, g) => s + g.caps, 0)}** |\n\n` +
      'Колонка «действий явно» считает только права, выписанные в каталоге поимённо. Часть прав\n' +
      'создаётся хелпером `crud()` и сюда не попадает — фактическое число больше. Точную цифру\n' +
      'показывает сводка на /access → Права.\n',
    'utf8',
  )

  fs.writeFileSync(
    path.join(MAP, 'Миграции.md'),
    header('Миграции') +
      `Всего: ${migrations.length}. Применяются вручную через SQL Editor — файл в репозитории не означает,\n` +
      'что миграция накатана на боевую базу.\n\n## Последние 15\n\n' +
      migrations.slice(-15).reverse().map((name) => `- \`${name}\``).join('\n') +
      '\n',
    'utf8',
  )

  return { nav, apiTotal, caps, migrations }
}

// ─── Журнал ────────────────────────────────────────────────────────────────

function appendJournal() {
  const state = loadState()
  const range = state.lastCommit ? `${state.lastCommit}..HEAD` : '-15'
  const raw = git(`log ${range} --pretty=format:%H%x09%h%x09%ad%x09%s --date=short`)
  if (!raw) return { added: 0 }

  const commits = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, short, date, subject] = line.split('\t')
      return { hash, short, date, subject }
    })
    .reverse()

  if (commits.length === 0) return { added: 0 }

  const byDate = new Map()
  for (const commit of commits) {
    byDate.set(commit.date, [...(byDate.get(commit.date) || []), commit])
  }

  for (const [date, list] of byDate) {
    const file = path.join(JOURNAL, `${date}.md`)
    const [year, month, day] = date.split('-')
    const title = `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`

    let body = ''
    if (fs.existsSync(file)) {
      body = fs.readFileSync(file, 'utf8')
    } else {
      body = `# ${title}\n\nЗаметка ведётся автоматически: дописывается в конец, ничего не перезаписывает.\nСвои мысли можно добавлять где угодно — синхронизация их не тронет.\n`
    }

    // Пропускаем коммиты, которые уже записаны: хук может сработать дважды.
    const fresh = list.filter((commit) => !body.includes(commit.short))
    if (fresh.length === 0) continue

    body += `\n## Коммиты\n\n`
    for (const commit of fresh) {
      const files = git(`show --stat --pretty=format: ${commit.hash}`)
        .split('\n')
        .filter((line) => line.includes('|'))
        .length
      body += `- \`${commit.short}\` ${commit.subject}${files ? ` — файлов: ${files}` : ''}\n`
    }

    fs.writeFileSync(file, body, 'utf8')
  }

  saveState({ lastCommit: git('rev-parse HEAD'), syncedAt: new Date().toISOString() })
  return { added: commits.length }
}

// ─── Точка входа ───────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(VAULT)) {
    console.error(`Хранилище не найдено: ${VAULT}`)
    process.exit(0) // хук не должен ронять сессию
  }

  ensureDirs()
  const stats = writeSystemMap()
  const journal = appendJournal()

  console.log(
    `Vault обновлён: страниц ${stats.nav.reduce((s, n) => s + n.items.length, 0)}, ` +
      `API ${stats.apiTotal}, миграций ${stats.migrations.length}, новых коммитов ${journal.added}`,
  )
}

main()
