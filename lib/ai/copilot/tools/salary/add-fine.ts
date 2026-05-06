/**
 * AI tool: оштрафовать оператора (создать adjustment типа fine).
 * Capability: salary.adjustment_create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const addFineTool: CopilotTool = {
  name: 'add_fine',
  category: 'salary',
  description: 'Оштрафовать оператора',
  requiredCapability: 'salary.adjustment_create',
  severity: 'high',
  params: [
    {
      name: 'operator_id',
      label: 'Кого штрафуем',
      type: 'select',
      required: true,
      description: 'ID оператора',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('operators').select('id, name, short_name').eq('is_active', true).order('name')
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    {
      name: 'company_id',
      label: 'На какой точке',
      type: 'select',
      required: true,
      description: 'ID точки',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
    {
      name: 'amount',
      label: 'Сумма штрафа (₸)',
      type: 'number',
      required: true,
      description: 'Положительное число',
      extractHint: '5000',
    },
    {
      name: 'reason',
      label: 'Причина',
      type: 'string',
      required: true,
      description: 'За что штраф (опоздание, недостача, нарушение и т.п.)',
      extractHint: 'опоздание на 30 минут',
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const companyId = String(input.company_id || '')
    const amount = Number(input.amount || 0)
    const reason = String(input.reason || '').trim()

    if (!operatorId || !companyId || amount <= 0 || !reason) {
      return { ok: false, message: 'Не хватает данных (оператор, точка, сумма, причина).' }
    }

    const today = todayISO()
    const { data, error } = await ctx.supabase
      .from('operator_salary_adjustments')
      .insert([
        {
          operator_id: operatorId,
          date: today,
          amount,
          kind: 'fine',
          comment: reason,
          company_id: companyId,
          source_type: 'manual',
          status: 'active',
        },
      ])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось создать штраф: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator-salary-adjustment',
        entityId: data?.id || 'unknown',
        action: 'create-fine',
        payload: { operator_id: operatorId, company_id: companyId, amount, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `Штраф ${amount.toLocaleString('ru-RU')} ₸ зафиксирован. Причина: ${reason}`,
      data: { adjustmentId: data?.id },
    }
  },
}
