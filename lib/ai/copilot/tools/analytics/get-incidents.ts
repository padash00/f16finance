/**
 * AI tool: список инцидентов/нарушений за период.
 * Capability: incidents.view
 *
 * Источник: таблица `incidents` (kind, severity, status, subject_staff_id,
 * description, occurred_at/created_at). Скоупим по company_id своей организации.
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds, resolveDateRange, dateRangeParams } from '../../query-helpers'

const SEVERITY_LABEL: Record<string, string> = {
  low: 'низкая', normal: 'обычная', high: 'высокая', critical: 'критическая',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'на рассмотрении', confirmed: 'подтверждён', dismissed: 'отклонён', resolved: 'решён',
}

export const getIncidentsTool: CopilotTool = {
  name: 'get_incidents',
  category: 'analytics',
  description: 'Список инцидентов/нарушений за период (вид, важность, статус, описание)',
  requiredCapability: 'incidents.view',
  severity: 'low',
  params: [
    ...dateRangeParams(),
    {
      name: 'status',
      label: 'Статус',
      type: 'select',
      required: false,
      description: 'Фильтр по статусу инцидента',
      getOptions: async () => [
        { value: 'pending', label: 'На рассмотрении' },
        { value: 'confirmed', label: 'Подтверждённые' },
        { value: 'dismissed', label: 'Отклонённые' },
        { value: 'resolved', label: 'Решённые' },
      ],
    },
    {
      name: 'severity',
      label: 'Важность',
      type: 'select',
      required: false,
      description: 'Фильтр по важности',
      getOptions: async () => [
        { value: 'low', label: 'Низкая' },
        { value: 'normal', label: 'Обычная' },
        { value: 'high', label: 'Высокая' },
        { value: 'critical', label: 'Критическая' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const { from, to, label } = resolveDateRange(input, { defaultPeriod: 'month' })
    const status = String(input.status || '').trim()
    const severity = String(input.severity || '').trim()

    let query = ctx.supabase
      .from('incidents')
      .select('id, occurred_at, created_at, kind, severity, status, title, description, subject_staff_id, company_id')
      .order('occurred_at', { ascending: false })
      .limit(200)
    if (from) query = query.gte('occurred_at', from)
    if (to) query = query.lte('occurred_at', `${to}T23:59:59`)
    if (status) query = query.eq('status', status)
    if (severity) query = query.eq('severity', severity)

    // Мультитенантная изоляция — только инциденты точек своей организации.
    const ids = await scopedCompanyIds(ctx)
    if (ids) query = query.in('company_id', ids)

    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = (data || []) as any[]
    if (rows.length === 0) {
      return { ok: true, message: `🛡 За ${label} инцидентов не найдено.`, data: { count: 0, incidents: [] } }
    }

    const lines = [`🛡 Инциденты за ${label}: ${rows.length}`, '']
    for (const r of rows.slice(0, 20)) {
      const date = String(r.occurred_at || r.created_at || '').slice(0, 10)
      const sev = SEVERITY_LABEL[String(r.severity)] || String(r.severity || '')
      const st = STATUS_LABEL[String(r.status)] || String(r.status || '')
      const desc = String(r.title || r.description || r.kind || '').slice(0, 80)
      lines.push(`  • ${date} · ${r.kind || ''} · ${sev} · ${st} — ${desc}`)
    }
    if (rows.length > 20) lines.push(`  ... и ещё ${rows.length - 20}`)

    return { ok: true, message: lines.join('\n'), data: { count: rows.length, incidents: rows } }
  },
}
