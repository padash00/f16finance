/**
 * AI tool: оштрафовать оператора (создать adjustment типа fine).
 * Capability: salary.adjustment_create
 */

import type { CopilotTool } from '../../types'
import { companyOptions } from '../../query-helpers'
import { writeAuditLog } from '@/lib/server/audit'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekStartISO(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  const day = dt.getDay() === 0 ? 7 : dt.getDay()
  dt.setDate(dt.getDate() - (day - 1))
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

async function ensureSalaryWeekId(supabase: any, operatorId: string, weekStart: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('operator_salary_weeks')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('week_start', weekStart)
    .maybeSingle()
  if (existing?.id) return String(existing.id)
  const weekEndDate = new Date(weekStart + 'T00:00:00')
  weekEndDate.setDate(weekEndDate.getDate() + 6)
  const weekEnd = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, '0')}-${String(weekEndDate.getDate()).padStart(2, '0')}`
  const { data: newWeek } = await supabase
    .from('operator_salary_weeks')
    .insert([{ operator_id: operatorId, week_start: weekStart, week_end: weekEnd, status: 'draft' }])
    .select('id')
    .single()
  return newWeek?.id ? String(newWeek.id) : null
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
      getOptions: async (ctx) => companyOptions(ctx),
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
    const weekStart = weekStartISO(today)
    const salaryWeekId = await ensureSalaryWeekId(ctx.supabase, operatorId, weekStart)

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
          salary_week_id: salaryWeekId,
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
