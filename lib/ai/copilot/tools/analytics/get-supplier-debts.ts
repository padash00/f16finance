/**
 * AI tool: задолженности перед поставщиками.
 * Capability: suppliers.view
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds } from '../../query-helpers'

export const getSupplierDebtsTool: CopilotTool = {
  name: 'get_supplier_debts',
  category: 'analytics',
  description: 'Кому из поставщиков мы должны и сколько',
  requiredCapability: 'suppliers.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    // Мультитенантная изоляция: только долги поставщикам своей организации.
    const ids = await scopedCompanyIds(ctx)
    let query = ctx.supabase
      .from('supplier_debts')
      .select('id, total_amount, supplier:supplier_id(name), due_date, status, company_id')
      .eq('status', 'open')
      .order('due_date', { nullsFirst: false })
      .limit(50)
    if (ids) query = query.in('company_id', ids)
    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: '✅ Перед поставщиками долгов нет.' }

    const total = data.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0)
    const lines: string[] = [`📋 Долгов поставщикам: ${data.length} на ${total.toLocaleString('ru-RU')} ₸\n`]
    for (const d of data as any[]) {
      const sup = Array.isArray(d.supplier) ? d.supplier[0] : d.supplier
      lines.push(`• ${sup?.name || '?'} — ${Number(d.total_amount).toLocaleString('ru-RU')} ₸ (до ${d.due_date || '—'})`)
    }
    return { ok: true, message: lines.join('\n'), data: { count: data.length, total } }
  },
}
