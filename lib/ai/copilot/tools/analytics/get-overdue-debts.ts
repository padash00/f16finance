/**
 * AI tool: показать активные долги точек.
 * Capability: point-debts.view
 */

import type { CopilotTool } from '../../types'

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
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return [
          { value: '', label: '📍 Все точки' },
          ...(data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') })),
        ]
      },
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    let q = ctx.supabase
      .from('debts')
      .select('id, amount, client_name, created_at, company:companies!company_id(name)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(30)
    if (companyId) q = q.eq('company_id', companyId)

    const { data, error } = await q
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    if (rows.length === 0) return { ok: true, message: '✅ Нет активных долгов.' }

    const fmt = (n: number) => Math.round(Number(n)).toLocaleString('ru-RU') + ' ₸'
    let total = 0
    const lines: string[] = []
    for (const d of rows as any[]) {
      const co = Array.isArray(d.company) ? d.company[0] : d.company
      const date = d.created_at ? new Date(d.created_at).toLocaleDateString('ru-RU') : ''
      const days = d.created_at ? Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86_400_000) : 0
      const aged = days >= 30 ? '🔴' : days >= 14 ? '🟡' : '🟢'
      const sum = Number(d.amount || 0)
      total += sum
      lines.push(`  ${aged} ${co?.name || ''} · ${(d.client_name || 'клиент').trim()} · ${fmt(sum)} (${days} дн)`)
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
