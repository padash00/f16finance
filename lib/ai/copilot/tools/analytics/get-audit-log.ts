/**
 * AI tool: лог действий за период.
 * Capability: audit.view
 */

import type { CopilotTool } from '../../types'

export const getAuditLogTool: CopilotTool = {
  name: 'get_audit_log',
  category: 'analytics',
  description: 'Показать журнал действий за период',
  requiredCapability: 'audit.view',
  severity: 'low',
  params: [
    { name: 'days', label: 'За сколько дней', type: 'number', required: false, description: 'По умолчанию — 1' },
    {
      name: 'entity_type',
      label: 'Сущность (опционально)',
      type: 'select',
      required: false,
      description: 'Что фильтровать',
      getOptions: async () => [
        { value: 'expense', label: 'Расходы' },
        { value: 'income', label: 'Доходы' },
        { value: 'shift', label: 'Смены' },
        { value: 'operator', label: 'Операторы' },
        { value: 'inventory-item', label: 'Товары' },
        { value: 'company', label: 'Точки' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const days = Math.max(1, Math.min(30, Number(input.days || 1)))
    const entityType = input.entity_type ? String(input.entity_type) : null
    const since = new Date(Date.now() - days * 86400000).toISOString()

    let query = ctx.supabase
      .from('audit_log')
      .select('id, entity_type, entity_id, action, payload, created_at, actor_user_id')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50)
    if (entityType) query = query.eq('entity_type', entityType)
    if (ctx.organizationId) query = query.or(`organization_id.is.null,organization_id.eq.${ctx.organizationId}`)

    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: '📜 Записей нет.' }

    const lines: string[] = [`📜 Действий за ${days} дн: ${data.length}${entityType ? ` (${entityType})` : ''}\n`]
    for (const r of data.slice(0, 25) as any[]) {
      const time = r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : ''
      lines.push(`${time} · ${r.entity_type} · ${r.action}`)
    }
    if (data.length > 25) lines.push(`...и ещё ${data.length - 25}`)

    return { ok: true, message: lines.join('\n'), data: { count: data.length } }
  },
}
