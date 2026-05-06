/**
 * AI tool: установить план KPI (выручка) для точки на месяц.
 * Capability: kpi.generate_collective_plans (или create если есть)
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const setKpiPlanTool: CopilotTool = {
  name: 'set_kpi_plan',
  category: 'system',
  description: 'Установить месячный план выручки для точки',
  requiredCapability: 'kpi.generate_collective_plans',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: true,
      description: 'Для какой точки план',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
    {
      name: 'target_amount',
      label: 'Целевая выручка (₸)',
      type: 'number',
      required: true,
      description: 'Сколько хотим заработать за месяц',
    },
    {
      name: 'month',
      label: 'Месяц (YYYY-MM)',
      type: 'string',
      required: false,
      description: 'Если не указано — текущий',
      extractHint: '2026-05',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const target = Number(input.target_amount || 0)
    const monthInput = String(input.month || '').trim()
    if (!companyId || target <= 0) return { ok: false, message: 'Не хватает данных.' }

    let year: number, month: number
    if (monthInput && /^\d{4}-\d{2}$/.test(monthInput)) {
      const [y, m] = monthInput.split('-').map(Number)
      year = y
      month = m
    } else {
      const d = new Date()
      year = d.getFullYear()
      month = d.getMonth() + 1
    }
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0)
    const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`

    // Upsert по (company_id, period_start, kind)
    const { data: existing } = await ctx.supabase
      .from('kpi_plans')
      .select('id')
      .eq('company_id', companyId)
      .eq('period_start', periodStart)
      .eq('kind', 'monthly_revenue')
      .maybeSingle()

    let result
    if (existing) {
      result = await ctx.supabase.from('kpi_plans').update({ target_amount: target, period_end: periodEnd }).eq('id', existing.id)
    } else {
      result = await ctx.supabase.from('kpi_plans').insert([{
        company_id: companyId,
        kind: 'monthly_revenue',
        target_amount: target,
        period_start: periodStart,
        period_end: periodEnd,
      }])
    }
    if (result.error) return { ok: false, message: `Не удалось установить план: ${result.error.message}` }

    const { data: comp } = await ctx.supabase.from('companies').select('name').eq('id', companyId).single()
    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'kpi-plan',
        entityId: existing?.id || 'new',
        action: existing ? 'update' : 'create',
        payload: { company_id: companyId, target_amount: target, period_start: periodStart, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `🎯 План для ${comp?.name || ''} на ${periodStart}—${periodEnd}: ${target.toLocaleString('ru-RU')} ₸ ${existing ? '(обновлён)' : '(создан)'}`,
    }
  },
}
