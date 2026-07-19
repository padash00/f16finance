/**
 * AI tool: статус выполнения месячного KPI (план vs факт).
 * Capability: kpi.view
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds, fetchAllPages } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const getKpiStatusTool: CopilotTool = {
  name: 'get_kpi_status',
  category: 'analytics',
  description: 'KPI: план vs факт выручки за текущий месяц с разбивкой по точкам',
  requiredCapability: 'kpi.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    const today = todayISO()
    const d = new Date(today)
    const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const monthEnd = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
    const dayOfMonth = d.getDate()
    const totalDays = lastDay.getDate()

    // Получаем планы по компаниям из таблицы (если есть kpi_plans) — только своей организации.
    const kpiScopeIds = await scopedCompanyIds(ctx)
    let plansQ = ctx.supabase
      .from('kpi_plans')
      .select('company_id, target_amount, period_start, period_end, kind')
      .eq('kind', 'monthly_revenue')
      .lte('period_start', today)
      .gte('period_end', today)
      .limit(20)
    if (kpiScopeIds) plansQ = plansQ.in('company_id', kpiScopeIds)
    const { data: plans } = await plansQ

    if (!plans || plans.length === 0) {
      return { ok: true, message: 'На текущий месяц планы KPI не установлены.' }
    }

    let companiesQ = ctx.supabase.from('companies').select('id, name')
    if (ctx.organizationId) companiesQ = companiesQ.eq('organization_id', ctx.organizationId)
    const { data: companies } = await companiesQ
    const companyMap = new Map((companies || []).map((c: any) => [String(c.id), c]))

    const lines: string[] = [`🎯 KPI на ${monthStart} — ${monthEnd} (день ${dayOfMonth} из ${totalDays}):\n`]
    let totalTarget = 0
    let totalFact = 0

    for (const plan of plans as any[]) {
      const company: any = companyMap.get(String(plan.company_id))
      const target = Number(plan.target_amount || 0)

      // Факт за период
      const incomes = await fetchAllPages((rFrom, rTo) =>
        ctx.supabase
          .from('incomes')
          .select('cash_amount, kaspi_amount, card_amount, online_amount')
          .eq('company_id', plan.company_id)
          .gte('date', monthStart)
          .lte('date', today)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(rFrom, rTo),
      ).catch(() => [] as any[])

      let fact = 0
      for (const r of (incomes || []) as any[]) {
        fact += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
      }

      const expectedSoFar = (target / totalDays) * dayOfMonth
      const performance = expectedSoFar > 0 ? (fact / expectedSoFar) * 100 : 0
      const monthPct = target > 0 ? (fact / target) * 100 : 0
      const emoji = performance >= 100 ? '🟢' : performance >= 90 ? '🟡' : '🔴'
      const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

      lines.push(`${emoji} ${company?.name || '?'}: ${fmt(fact)} / ${fmt(target)} (${monthPct.toFixed(0)}%)`)
      lines.push(`  По графику ожидаем ${fmt(expectedSoFar)}, идём на ${performance.toFixed(0)}% от темпа`)

      totalTarget += target
      totalFact += fact
    }

    if (plans.length > 1) {
      const totalExpected = (totalTarget / totalDays) * dayOfMonth
      const totalPerf = totalExpected > 0 ? (totalFact / totalExpected) * 100 : 0
      const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
      lines.push(`\n📊 Итого: ${fmt(totalFact)} / ${fmt(totalTarget)} (${totalPerf.toFixed(0)}% темпа)`)
    }

    return { ok: true, message: lines.join('\n'), data: { count: plans.length } }
  },
}
