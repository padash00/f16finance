/**
 * AI tool: показать заявки на пополнение которые ждут решения.
 * Capability: store-requests.view
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds } from '../../query-helpers'

export const getPendingRequestsTool: CopilotTool = {
  name: 'get_pending_requests',
  category: 'analytics',
  description: 'Показать заявки на пополнение витрины которые ждут решения',
  requiredCapability: 'store-requests.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    // Мультитенантная изоляция: только заявки точек своей организации.
    const scopeIds = await scopedCompanyIds(ctx)
    let query = ctx.supabase
      .from('inventory_requests')
      .select('id, status, created_at, comment, requesting_company_id')
      .in('status', ['new', 'disputed'])
      .order('created_at', { ascending: false })
      .limit(20)
    if (scopeIds) query = query.in('requesting_company_id', scopeIds)
    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    if (rows.length === 0) return { ok: true, message: '✅ Нет ожидающих заявок.' }

    // Подгружаем имена точек одним запросом
    const ids = Array.from(new Set(rows.map((r: any) => r.requesting_company_id).filter(Boolean)))
    const companyMap = new Map<string, string>()
    if (ids.length > 0) {
      const { data: cos } = await ctx.supabase.from('companies').select('id, name').in('id', ids)
      for (const c of (cos || []) as any[]) companyMap.set(String(c.id), c.name || '')
    }

    const lines: string[] = [`📋 Заявок ждут решения: ${rows.length}\n`]
    for (const r of rows as any[]) {
      const coName = companyMap.get(String(r.requesting_company_id)) || '—'
      const date = r.created_at ? new Date(r.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''
      const tag = r.status === 'disputed' ? '⚠️ Спорная' : '🆕 Новая'
      lines.push(`  ${tag} · ${coName} · ${date}${r.comment ? `\n    "${r.comment.slice(0, 80)}"` : ''}`)
    }

    return {
      ok: true,
      message: lines.join('\n'),
      data: { count: rows.length },
      followUps: [{ label: '👁 Открыть заявки', action: 'open:/store/requests' }],
    }
  },
}
