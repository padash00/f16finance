/**
 * AI tool: показать активные долги точек.
 * Capability: point-debts.view
 */

import type { CopilotTool } from '../../types'
import { companyOptions, resolveCompanyNames, scopedCompanyIds } from '../../query-helpers'

export const getOverdueDebtsTool: CopilotTool = {
  name: 'get_active_debts',
  category: 'analytics',
  description: 'Показать активные долги клиентов (товар взят, не оплачено)',
  requiredCapability: 'point-debts.view',
  severity: 'low',
  params: [
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: false,
      description: 'Фильтр по точке',
      getOptions: async (ctx) => companyOptions(ctx, { allLabel: '📍 Все точки' }),
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    // Используем point_debt_items (живая таблица) вместо debts
    let q = ctx.supabase
      .from('point_debt_items')
      .select('id, total_amount, client_name, item_name, created_at, company_id')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(30)
    if (companyId) {
      q = q.eq('company_id', companyId)
    } else {
      const ids = await scopedCompanyIds(ctx)
      if (ids) q = q.in('company_id', ids)
    }

    const { data, error } = await q
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    if (rows.length === 0) return { ok: true, message: '✅ Нет активных долгов.' }

    const companyMap = await resolveCompanyNames(ctx.supabase, rows as any)
    const fmt = (n: number) => Math.round(Number(n)).toLocaleString('ru-RU') + ' ₸'
    let total = 0
    const lines: string[] = []
    for (const d of rows as any[]) {
      const co = companyMap.get(String(d.company_id)) || ''
      const days = d.created_at ? Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86_400_000) : 0
      const aged = days >= 30 ? '🔴' : days >= 14 ? '🟡' : '🟢'
      const sum = Number(d.total_amount || 0)
      total += sum
      lines.push(`  ${aged} ${co} · ${(d.client_name || 'клиент').trim()} · ${fmt(sum)} (${days} дн)`)
    }

    const head = `💸 Активных долгов: ${rows.length} на ${fmt(total)}\n`
    return {
      ok: true,
      message: head + lines.slice(0, 15).join('\n') + (rows.length > 15 ? `\n  ... и ещё ${rows.length - 15}` : ''),
      data: { count: rows.length, total },
      followUps: [{ label: '👁 Открыть долги', action: 'open:/point-debts' }],
    }
  },
}
