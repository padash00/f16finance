/**
 * AI tool: история чеков POS за период.
 * Capability: pos.view
 */

import type { CopilotTool } from '../../types'

export const getReceiptHistoryTool: CopilotTool = {
  name: 'get_receipt_history',
  category: 'pos',
  description: 'История чеков (продаж) за период',
  requiredCapability: 'pos.view',
  severity: 'low',
  params: [
    {
      name: 'days',
      label: 'За сколько дней',
      type: 'number',
      required: false,
      description: 'По умолчанию — 7',
    },
    {
      name: 'company_id',
      label: 'Точка (опционально)',
      type: 'select',
      required: false,
      description: 'Если не указано — все точки',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const days = Math.max(1, Math.min(90, Number(input.days || 7)))
    const companyId = input.company_id ? String(input.company_id) : null
    const since = new Date(Date.now() - days * 86400000).toISOString()

    let query = ctx.supabase
      .from('point_sales')
      .select('id, total_amount, refunded_at, created_at, company:company_id(name)')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50)
    if (companyId) query = query.eq('company_id', companyId)

    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: '🧾 Чеков за период нет.' }

    const total = data.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0)
    const refunded = data.filter((r: any) => r.refunded_at).length
    const lines: string[] = [`🧾 Чеков за ${days} дн: ${data.length}, итого ${total.toLocaleString('ru-RU')} ₸${refunded ? `, возвратов: ${refunded}` : ''}\n`]
    for (const r of data.slice(0, 20) as any[]) {
      const co = Array.isArray(r.company) ? r.company[0] : r.company
      const date = r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : ''
      const flag = r.refunded_at ? ' ↩' : ''
      lines.push(`${date} · ${co?.name || ''} · ${Number(r.total_amount).toLocaleString('ru-RU')} ₸${flag}`)
    }
    if (data.length > 20) lines.push(`...и ещё ${data.length - 20}`)

    return { ok: true, message: lines.join('\n'), data: { count: data.length, total } }
  },
}
