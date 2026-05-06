/**
 * AI tool: добавить доверенного поставщика в whitelist.
 * Capability: expense-whitelist.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const addVendorTool: CopilotTool = {
  name: 'add_trusted_vendor',
  category: 'finance',
  description: 'Добавить доверенного поставщика (whitelist для расходов без чека)',
  requiredCapability: 'expense-whitelist.create',
  severity: 'medium',
  params: [
    {
      name: 'vendor_name',
      label: 'Название поставщика',
      type: 'string',
      required: true,
      description: 'Имя или название (Иван Петров, ТОО Alpha и т.п.)',
    },
    {
      name: 'company_id',
      label: 'Только для одной точки',
      type: 'select',
      required: false,
      description: 'Если оставить пусто — для всех точек',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return [
          { value: '', label: '🌐 Для всех точек' },
          ...(data || []).map((c: any) => ({ value: c.id, label: '📍 ' + c.name + (c.code ? ` (${c.code})` : '') })),
        ]
      },
    },
    {
      name: 'notes',
      label: 'Заметка',
      type: 'string',
      required: false,
      description: 'Опционально (адрес, контакт)',
    },
  ],
  handler: async (input, ctx) => {
    const vendorName = String(input.vendor_name || '').trim()
    const companyId = String(input.company_id || '') || null
    const notes = String(input.notes || '').trim() || null
    if (!vendorName) return { ok: false, message: 'Название обязательно.' }

    const { data, error } = await ctx.supabase
      .from('expense_vendor_whitelist')
      .insert([{ vendor_name: vendorName, company_id: companyId, notes }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось добавить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'expense-vendor-whitelist',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { vendor_name: vendorName, company_id: companyId, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Поставщик "${vendorName}" добавлен.` }
  },
}
