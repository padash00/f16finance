/**
 * AI tool: создать цель/задание команды.
 * Capability: goals.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const createGoalTool: CopilotTool = {
  name: 'create_goal',
  category: 'system',
  description: 'Создать цель/задание для команды на месяц',
  requiredCapability: 'goals.create',
  severity: 'medium',
  params: [
    {
      name: 'title',
      label: 'Название цели',
      type: 'string',
      required: true,
      description: 'Короткое название',
      extractHint: 'Увеличить выручку на 15%',
    },
    {
      name: 'description',
      label: 'Описание',
      type: 'string',
      required: false,
      description: 'Детали и план действий',
    },
    {
      name: 'target_value',
      label: 'Целевое значение',
      type: 'number',
      required: false,
      description: 'Числовое значение цели если применимо',
    },
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'На какой период цель',
      getOptions: async () => [
        { value: 'month', label: 'Месяц' },
        { value: 'quarter', label: 'Квартал' },
        { value: 'year', label: 'Год' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const title = String(input.title || '').trim()
    const description = String(input.description || '').trim() || null
    const targetValue = input.target_value != null ? Number(input.target_value) : null
    const period = String(input.period || 'month')
    if (!title) return { ok: false, message: 'Название обязательно.' }

    const now = new Date()
    let periodEnd = new Date()
    if (period === 'month') periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    else if (period === 'quarter') periodEnd = new Date(now.getFullYear(), now.getMonth() + 3, 0)
    else if (period === 'year') periodEnd = new Date(now.getFullYear() + 1, 0, 0)

    const periodEndISO = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, '0')}-${String(periodEnd.getDate()).padStart(2, '0')}`

    const { data, error } = await ctx.supabase
      .from('goals')
      .insert([{
        title,
        description,
        target_value: targetValue,
        period_end: periodEndISO,
        status: 'active',
        // Мультитенантная изоляция: привязываем цель к своей организации.
        organization_id: ctx.organizationId || null,
      }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'goal',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { title, period, target_value: targetValue, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🎯 Цель "${title}" создана (до ${periodEndISO}).` }
  },
}
