/**
 * AI tool: назначить смену оператору.
 * Capability: shifts.create
 */

import type { CopilotTool } from '../../types'
import { companyOptions } from '../../query-helpers'
import { writeAuditLog } from '@/lib/server/audit'

export const assignShiftTool: CopilotTool = {
  name: 'assign_shift',
  category: 'shifts',
  description: 'Назначить смену оператору',
  requiredCapability: 'shifts.create',
  severity: 'medium',
  params: [
    {
      name: 'operator_id',
      label: 'Кого ставим',
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
      label: 'На какую точку',
      type: 'select',
      required: true,
      description: 'ID точки',
      getOptions: async (ctx) => companyOptions(ctx),
    },
    {
      name: 'date',
      label: 'Дата (YYYY-MM-DD)',
      type: 'date',
      required: true,
      description: 'Дата смены',
      extractHint: '2026-05-08',
    },
    {
      name: 'shift_type',
      label: 'Тип смены',
      type: 'select',
      required: true,
      description: 'День или ночь',
      getOptions: async () => [
        { value: 'day', label: '☀️ Дневная' },
        { value: 'night', label: '🌙 Ночная' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const companyId = String(input.company_id || '')
    const date = String(input.date || '')
    const shiftType = String(input.shift_type || 'day')
    if (!operatorId || !companyId || !date) return { ok: false, message: 'Не хватает данных.' }

    // Берём operator_name из таблицы (он required в schema shifts).
    const { data: opRow } = await ctx.supabase
      .from('operators')
      .select('name, short_name')
      .eq('id', operatorId)
      .single()
    const operatorName = (opRow?.short_name || opRow?.name || 'Оператор').trim()

    const { data, error } = await ctx.supabase
      .from('shifts')
      .insert([{
        operator_id: operatorId,
        operator_name: operatorName,
        company_id: companyId,
        date,
        shift_type: shiftType,
      }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось назначить смену: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'shift',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { operator_id: operatorId, company_id: companyId, date, shift_type: shiftType, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `Смена назначена: ${date} (${shiftType === 'night' ? 'ночь' : 'день'}).`, data: { shiftId: data?.id } }
  },
}
