/**
 * AI tool: показать ближайшие дни рождения операторов.
 * Capability: birthdays.view
 */

import type { CopilotTool } from '../../types'
import { scopedOperatorIds } from '../../query-helpers'

function daysUntilBirthday(birthDate: string, now: Date): number | null {
  const [, m, d] = birthDate.split('-').map(Number)
  if (!m || !d) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(now.getFullYear(), m - 1, d)
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d)
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

export const getBirthdaysTool: CopilotTool = {
  name: 'get_birthdays',
  category: 'analytics',
  description: 'Показать ближайшие дни рождения операторов (ближайшие 30 дней)',
  requiredCapability: 'birthdays.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    let bdQ = ctx.supabase
      .from('operators')
      .select('id, name, short_name, operator_profiles(full_name, birth_date)')
      .eq('is_active', true)
    const bdIds = await scopedOperatorIds(ctx)
    if (bdIds) bdQ = bdQ.in('id', bdIds)
    const { data } = await bdQ

    const now = new Date()
    const items: Array<{ name: string; days: number; date: string }> = []
    for (const row of (data || []) as any[]) {
      const profile = Array.isArray(row.operator_profiles) ? row.operator_profiles[0] : row.operator_profiles
      const birthDate = profile?.birth_date
      if (!birthDate) continue
      const days = daysUntilBirthday(birthDate, now)
      if (days == null || days > 30) continue
      items.push({
        name: profile?.full_name || row.name,
        days,
        date: birthDate,
      })
    }

    if (items.length === 0) return { ok: true, message: '🎂 Нет дней рождений в ближайшие 30 дней.' }

    items.sort((a, b) => a.days - b.days)
    const lines: string[] = ['🎂 Ближайшие дни рождения:\n']
    for (const item of items) {
      const when = item.days === 0 ? 'СЕГОДНЯ 🎉' : item.days === 1 ? 'завтра' : `через ${item.days} дн.`
      lines.push(`  • ${item.name} — ${when} (${item.date})`)
    }

    return { ok: true, message: lines.join('\n'), data: { count: items.length } }
  },
}
