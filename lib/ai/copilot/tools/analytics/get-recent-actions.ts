/**
 * AI tool: последние действия в системе (audit log).
 * Capability: logs.view
 */

import type { CopilotTool } from '../../types'

export const getRecentActionsTool: CopilotTool = {
  name: 'get_recent_actions',
  category: 'analytics',
  description: 'Последние действия в системе из audit log (кто что сделал)',
  requiredCapability: 'logs.view',
  severity: 'low',
  params: [
    {
      name: 'entity_type',
      label: 'Тип записи',
      type: 'select',
      required: false,
      description: 'Фильтр по типу. Если не указан — всё',
      getOptions: async () => [
        { value: '', label: '🔍 Все действия' },
        { value: 'expense', label: '💸 Расходы' },
        { value: 'income', label: '💰 Доходы' },
        { value: 'task', label: '📋 Задачи' },
        { value: 'shift', label: '📅 Смены' },
        { value: 'inventory-request', label: '📦 Заявки склада' },
        { value: 'operator-salary-adjustment', label: '⚖️ Корректировки ЗП' },
        { value: 'operator', label: '👥 Операторы' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const entityType = String(input.entity_type || '')
    let q = ctx.supabase
      .from('audit_log')
      .select('id, entity_type, entity_id, action, created_at, payload')
      .order('created_at', { ascending: false })
      .limit(20)
    if (entityType) q = q.eq('entity_type', entityType)
    if (ctx.organizationId) q = q.or(`organization_id.is.null,organization_id.eq.${ctx.organizationId}`)

    const { data, error } = await q
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    if (rows.length === 0) return { ok: true, message: 'Действий не найдено.' }

    const lines: string[] = [`📜 Последние ${rows.length} действий:\n`]
    for (const a of rows as any[]) {
      const date = a.created_at ? new Date(a.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''
      const payload = a.payload || {}
      const via = payload.via ? ` 🤖${payload.via}` : ''
      lines.push(`  ${date} · ${a.entity_type}/${a.action}${via}`)
    }

    return { ok: true, message: lines.join('\n'), data: { count: rows.length } }
  },
}
