/**
 * AI tool: карта страниц / где что находится в системе.
 * Read-only, доступен всем. Отвечает на «какие страницы есть», «где смотреть X»,
 * «как открыть Y». Опциональный query сужает поиск.
 */

import type { CopilotTool } from '../../types'
import { navSections } from '@/lib/nav/sections'

export const findPageTool: CopilotTool = {
  name: 'find_page',
  category: 'system',
  description: 'Карта страниц и где что находится в системе. Вызывай на «какие страницы есть», «где посмотреть зарплату/смены/склад», «как открыть отчёты», «куда зайти чтобы …». Параметр query — что ищут (опц.).',
  requiredCapability: '*',
  severity: 'low',
  params: [
    { name: 'query', label: 'Что ищем', type: 'string', required: false, description: 'Тема/название страницы (например: зарплата, склад, смены). Пусто = вся карта.' },
  ],
  handler: async (input) => {
    const q = String(input.query || '').trim().toLowerCase()
    const flat: Array<{ section: string; label: string; href: string; note?: string }> = []
    for (const s of navSections) {
      for (const it of s.items) {
        flat.push({ section: s.title, label: it.label, href: it.href, note: it.note })
      }
    }
    const matched = q
      ? flat.filter((p) =>
          `${p.label} ${p.note || ''} ${p.section}`.toLowerCase().includes(q))
      : flat

    if (matched.length === 0) {
      return { ok: true, message: `Не нашёл страницу по «${q}». Скажи иначе или открой меню.`, data: { pages: [] } }
    }

    // Группируем по разделу для читаемости
    const bySection = new Map<string, Array<{ label: string; href: string; note?: string }>>()
    for (const p of matched.slice(0, 40)) {
      const arr = bySection.get(p.section) || []
      arr.push({ label: p.label, href: p.href, note: p.note })
      bySection.set(p.section, arr)
    }
    const lines: string[] = []
    for (const [section, items] of bySection) {
      lines.push(`${section}: ` + items.map((i) => `${i.label} (${i.href})`).join(', '))
    }
    return { ok: true, message: lines.join('\n'), data: { pages: matched.slice(0, 40) } }
  },
}
