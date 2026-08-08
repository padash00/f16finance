/**
 * Экспорт каталога прав и аддонов в контракт для нативных клиентов (Apple-приложение).
 *
 * Зачем: `lib/core/capabilities.ts` — единственный источник правды по 397 правам.
 * Swift-клиент не может импортировать TypeScript, а дублировать каталог руками
 * означает, что рано или поздно веб и приложение разойдутся: владелец добавит
 * право, приложение о нём не узнает и покажет кнопку, которую сервер отвергнет.
 *
 * Скрипт генерирует:
 *   apple/Contracts/capabilities.json                     — снимок каталога (человекочитаемый)
 *   apple/OrdaKit/Sources/OrdaKit/Access/Generated/*.swift — Swift-зеркало
 *
 * Запуск:
 *   node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs
 *   node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs --check
 *
 * `--check` ничего не пишет, а падает с кодом 1, если сгенерированное разошлось
 * с закоммиченным. Ставится в CI рядом с typecheck.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import { CAPABILITY_GROUPS, getCapabilitiesSummary } from '@/lib/core/capabilities'
import { ADDON_CATALOG } from '@/lib/core/addons'

const ROOT = process.cwd()
const CHECK_ONLY = process.argv.includes('--check')

const CONTRACTS_DIR = path.join(ROOT, 'apple', 'Contracts')
const SWIFT_DIR = path.join(ROOT, 'apple', 'OrdaKit', 'Sources', 'OrdaKit', 'Access', 'Generated')

// ────────────────────────────────────────────────────────────────────────────
// Сборка контракта
// ────────────────────────────────────────────────────────────────────────────

function buildContract() {
  const groups = CAPABILITY_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    pages: group.pages.map((page) => ({
      id: page.id,
      path: page.path,
      extraPaths: page.extraPaths ?? [],
      label: page.label,
      capabilities: page.capabilities.map((cap) => ({
        id: cap.id,
        label: cap.label,
        description: cap.description ?? null,
        severity: cap.severity ?? 'low',
        deps: cap.deps ?? [],
      })),
    })),
  }))

  const addons = ADDON_CATALOG.map((addon) => ({
    code: addon.code,
    name: addon.name,
    description: addon.description,
    pages: addon.pages,
    grants: addon.grants,
    priceKzt: addon.price_kzt,
    billing: addon.billing ?? 'flat',
  }))

  return { version: 1, summary: getCapabilitiesSummary(), groups, addons }
}

// ────────────────────────────────────────────────────────────────────────────
// Swift-генерация
// ────────────────────────────────────────────────────────────────────────────

/** Строковый литерал Swift. Экранируем то, что ломает исходник. */
function swiftString(value) {
  if (value === null || value === undefined) return 'nil'
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

function swiftOptionalString(value) {
  return value === null || value === undefined || value === '' ? 'nil' : swiftString(value)
}

function swiftStringArray(values) {
  if (!values || values.length === 0) return '[]'
  return `[${values.map(swiftString).join(', ')}]`
}

const HEADER = `// ВНИМАНИЕ: файл сгенерирован автоматически. Правки будут затёрты.
//
// Источник:  lib/core/capabilities.ts, lib/core/addons.ts
// Генератор: scripts/export-capabilities.mjs
//
// Обновить:  node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs
// Проверить: node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs --check
`

function generateCapabilitiesSwift(contract) {
  const lines = [HEADER, '', 'extension CapabilityCatalog {', '    /// Все группы прав, зеркало `CAPABILITY_GROUPS` из веба.', '    static let generatedGroups: [CapabilityGroup] = [']

  for (const group of contract.groups) {
    lines.push('        CapabilityGroup(')
    lines.push(`            id: ${swiftString(group.id)},`)
    lines.push(`            label: ${swiftString(group.label)},`)
    lines.push('            pages: [')
    for (const page of group.pages) {
      lines.push('                CapabilityPage(')
      lines.push(`                    id: ${swiftString(page.id)},`)
      lines.push(`                    path: ${swiftString(page.path)},`)
      lines.push(`                    extraPaths: ${swiftStringArray(page.extraPaths)},`)
      lines.push(`                    label: ${swiftString(page.label)},`)
      lines.push('                    capabilities: [')
      for (const cap of page.capabilities) {
        const parts = [
          `id: ${swiftString(cap.id)}`,
          `label: ${swiftString(cap.label)}`,
          `description: ${swiftOptionalString(cap.description)}`,
          `severity: .${cap.severity}`,
          `deps: ${swiftStringArray(cap.deps)}`,
        ]
        lines.push(`                        Capability(${parts.join(', ')}),`)
      }
      lines.push('                    ]')
      lines.push('                ),')
    }
    lines.push('            ]')
    lines.push('        ),')
  }

  lines.push('    ]')
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

function generateAddonsSwift(contract) {
  const lines = [HEADER, '', 'extension AddonCatalog {', '    /// Продаваемые модули, зеркало `ADDON_CATALOG` из веба.', '    static let generatedAddons: [Addon] = [']

  for (const addon of contract.addons) {
    lines.push('        Addon(')
    lines.push(`            code: ${swiftString(addon.code)},`)
    lines.push(`            name: ${swiftString(addon.name)},`)
    lines.push(`            description: ${swiftString(addon.description)},`)
    lines.push(`            pages: ${swiftStringArray(addon.pages)},`)
    lines.push(`            grants: ${swiftStringArray(addon.grants)},`)
    lines.push(`            priceKzt: ${addon.priceKzt},`)
    lines.push(`            billing: .${addon.billing}`)
    lines.push('        ),')
  }

  lines.push('    ]')
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// Запись / проверка
// ────────────────────────────────────────────────────────────────────────────

const stale = []

function emit(filePath, content) {
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
  if (existing === content) return 'unchanged'

  if (CHECK_ONLY) {
    stale.push(path.relative(ROOT, filePath))
    return 'stale'
  }

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  return existing === null ? 'created' : 'updated'
}

const contract = buildContract()

const outputs = [
  [path.join(CONTRACTS_DIR, 'capabilities.json'), JSON.stringify(contract, null, 2) + '\n'],
  [path.join(SWIFT_DIR, 'CapabilityCatalog+Generated.swift'), generateCapabilitiesSwift(contract)],
  [path.join(SWIFT_DIR, 'AddonCatalog+Generated.swift'), generateAddonsSwift(contract)],
]

for (const [filePath, content] of outputs) {
  const status = emit(filePath, content)
  if (!CHECK_ONLY) {
    console.log(`  ${status.padEnd(9)} ${path.relative(ROOT, filePath)}`)
  }
}

if (CHECK_ONLY) {
  if (stale.length > 0) {
    console.error('Контракт для Apple-клиента устарел. Файлы разошлись с источником:')
    for (const file of stale) console.error(`  - ${file}`)
    console.error('\nПочините: node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs')
    process.exit(1)
  }
  console.log('Контракт для Apple-клиента синхронен с lib/core/*.ts')
} else {
  const { groups, pages, capabilities } = contract.summary
  console.log(`\nЭкспортировано: ${groups} групп, ${pages} страниц, ${capabilities} прав, ${contract.addons.length} аддонов`)
}
