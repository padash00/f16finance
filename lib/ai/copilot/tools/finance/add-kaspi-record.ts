/**
 * AI tool: добавить запись безналичный терминала.
 * Capability: kaspi-terminal.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const addKaspiRecordTool: CopilotTool = {
  name: 'add_kaspi_record',
  category: 'finance',
  description: 'Записать сумму с безналичный терминала за день',
  requiredCapability: 'kaspi-terminal.create',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: true,
      description: 'Какая точка',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
    {
      name: 'amount',
      label: 'Сумма (₸)',
      type: 'number',
      required: true,
      description: 'Сумма с терминала',
    },
    {
      name: 'date',
      label: 'Дата',
      type: 'date',
      required: false,
      description: 'YYYY-MM-DD. Если не указана — сегодня',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const amount = Number(input.amount || 0)
    const date = String(input.date || '').trim() || todayISO()
    if (!companyId || amount <= 0) return { ok: false, message: 'Не хватает данных.' }

    const { data, error } = await ctx.supabase
      .from('kaspi_terminal_records')
      .insert([{ company_id: companyId, date, amount }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось записать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'kaspi-terminal',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { company_id: companyId, date, amount, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ запись безнала ${amount.toLocaleString('ru-RU')} ₸ за ${date} сохранена.` }
  },
}
