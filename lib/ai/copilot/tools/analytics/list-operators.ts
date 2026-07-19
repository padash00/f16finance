/**
 * AI tool: список операторов поимённо (опц. по точке).
 * «какие операторы работают в F16 Arena», «полный состав», «список ФИО».
 * Capability: operators.view. Read-only.
 */

import type { CopilotTool } from '../../types'
import { companyOptions, scopedOperatorIds, fetchAllPages } from '../../query-helpers'

export const listOperatorsTool: CopilotTool = {
  name: 'list_operators',
  category: 'analytics',
  description: 'Список операторов ПОИМЁННО (ФИО). Опц. по точке (кто работает на ней). Вызывай на «какие операторы / список операторов / полный состав / кто работает в <точка>».',
  requiredCapability: 'operators.view',
  severity: 'low',
  params: [
    {
      name: 'company_id', label: 'Точка', type: 'select', required: false,
      description: 'Кто работает на этой точке (по сменам). Пусто — все операторы.',
      getOptions: async (ctx) => companyOptions(ctx, { allLabel: '📍 Все точки' }),
    },
    {
      name: 'only_active', label: 'Только активные', type: 'boolean', required: false,
      description: 'true — только активные (по умолчанию), false — включая заблокированных.',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const onlyActive = input.only_active === false ? false : true

    // Если указана точка — берём операторов из её смен (связь оператор↔точка через shifts).
    let operatorIdsFilter: Set<string> | null = null
    if (companyId) {
      const shifts = await fetchAllPages((rFrom, rTo) =>
        ctx.supabase
          .from('shifts').select('operator_id').eq('company_id', companyId).not('operator_id', 'is', null)
          .order('id', { ascending: true }).range(rFrom, rTo),
      ).catch(() => [] as any[])
      operatorIdsFilter = new Set((shifts || []).map((s: any) => String(s.operator_id)).filter(Boolean))
      if (operatorIdsFilter.size === 0) {
        return { ok: true, message: 'На этой точке пока нет операторов в сменах.', data: { operators: [] } }
      }
    }

    // ОРГ-СКОУП: если точка не указана — ограничиваем операторами своей организации
    // (иначе утечка операторов чужих клубов). С точкой фильтр уже по сменам этой точки.
    const orgOpIds = operatorIdsFilter ? null : await scopedOperatorIds(ctx)
    let data: any[]
    try {
      data = await fetchAllPages((rFrom, rTo) => {
        let q = ctx.supabase.from('operators').select('id, name, short_name, is_active')
          .order('name').order('id', { ascending: true }).range(rFrom, rTo)
        if (onlyActive) q = q.eq('is_active', true)
        if (orgOpIds) q = q.in('id', orgOpIds)
        return q
      })
    } catch (e: any) {
      return { ok: false, message: `Ошибка: ${e?.message || 'unknown'}` }
    }

    let ops = (data || []) as Array<{ id: string; name: string; short_name: string | null; is_active: boolean }>
    if (operatorIdsFilter) ops = ops.filter((o) => operatorIdsFilter!.has(String(o.id)))

    if (ops.length === 0) return { ok: true, message: 'Операторов не найдено.', data: { operators: [] } }

    let companyLabel = ''
    if (companyId) {
      const { data: c } = await ctx.supabase.from('companies').select('name').eq('id', companyId).single()
      companyLabel = c?.name ? ` на «${c.name}»` : ''
    }

    const names = ops.map((o) => o.name + (o.short_name ? ` (${o.short_name})` : '') + (o.is_active ? '' : ' — заблокирован'))
    return {
      ok: true,
      message: `Операторы${companyLabel} (${ops.length}):\n` + names.map((n, i) => `${i + 1}. ${n}`).join('\n'),
      data: { count: ops.length, operators: ops.map((o) => ({ name: o.name, short_name: o.short_name, is_active: o.is_active })) },
    }
  },
}
