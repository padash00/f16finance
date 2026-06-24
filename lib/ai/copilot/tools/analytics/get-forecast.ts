/**
 * AI tool: прогноз дохода/расхода/прибыли на следующий месяц.
 * Переиспользует движок lib/analysis/monthly-forecast. Capability: forecast.view
 */

import type { CopilotTool } from '../../types'
import { companyOptions, scopedCompanyIds } from '../../query-helpers'
import { buildMonthlyForecast, type ForecastIncomeRow, type ForecastExpenseRow } from '@/lib/analysis/monthly-forecast'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const money = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

export const getForecastTool: CopilotTool = {
  name: 'get_forecast',
  category: 'analytics',
  description: 'Прогноз дохода, расхода и прибыли на СЛЕДУЮЩИЙ месяц по закономерностям прошлых месяцев. Вызывай на «сколько заработаю / прогноз на след месяц / что будет с деньгами».',
  requiredCapability: 'forecast.view',
  severity: 'low',
  params: [
    {
      name: 'company_id', label: 'Точка', type: 'select', required: false,
      description: 'Фильтр по точке. Пусто — все.',
      getOptions: async (ctx) => companyOptions(ctx, { allLabel: '📍 Все точки' }),
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const to = todayISO()
    const from = '2020-01-01'

    const fetchAll = async (table: 'incomes' | 'expenses', select: string) => {
      const all: any[] = []
      let page = 0
      while (true) {
        let q = ctx.supabase.from(table).select(select).gte('date', from).lte('date', to)
          .order('date', { ascending: true }).range(page * 5000, page * 5000 + 4999)
        if (companyId) q = q.eq('company_id', companyId)
        else { const ids = await scopedCompanyIds(ctx); if (ids) q = q.in('company_id', ids) }
        const { data, error } = await q
        if (error) throw new Error(error.message)
        const rows = data || []
        all.push(...rows)
        if (rows.length < 5000) break
        page++
      }
      return all
    }

    try {
      const [inc, exp] = await Promise.all([
        fetchAll('incomes', 'date, cash_amount, kaspi_amount, card_amount, online_amount'),
        fetchAll('expenses', 'date, category, cash_amount, kaspi_amount'),
      ])
      const incomes: ForecastIncomeRow[] = inc.map((r) => ({ date: r.date, cash: r.cash_amount || 0, kaspi: r.kaspi_amount || 0, card: r.card_amount || 0, online: r.online_amount || 0 }))
      const expenses: ForecastExpenseRow[] = exp.map((r) => ({ date: r.date, category: r.category ?? null, cash: r.cash_amount || 0, kaspi: r.kaspi_amount || 0 }))
      const f = buildMonthlyForecast(incomes, expenses, to)

      const msg = `📈 Прогноз на ${f.targetMonthLabel} (уверенность ${f.confidence.score}/100):
Доход ~${money(f.income.expected)} (${money(f.income.low)}–${money(f.income.high)})
Расход ~${money(f.expense.expected)} (постоянные ${money(f.expense.fixed)} + переменные ${f.expense.variableRatePct.toFixed(0)}% от дохода)
Прибыль ~${money(f.profit.expected)} (маржа ${f.profit.marginPct.toFixed(0)}%)
Тренд по месяцам ${f.income.momGrowthPct >= 0 ? '+' : ''}${f.income.momGrowthPct.toFixed(1)}%/мес${f.confidence.seasonalityAvailable ? `, сезонность ×${f.income.seasonalIndex.toFixed(2)}` : ', сезонность пока недоступна (<13 мес)'}`

      return {
        ok: true,
        message: msg,
        data: {
          targetMonth: f.targetMonthLabel,
          income: f.income.expected, expenseTotal: f.expense.expected, profit: f.profit.expected,
          marginPct: f.profit.marginPct, momGrowthPct: f.income.momGrowthPct,
          confidence: f.confidence.score, monthsOfData: f.confidence.monthsOfData,
          breakeven: f.breakeven.revenue,
        },
      }
    } catch (e: any) {
      return { ok: false, message: `Не удалось построить прогноз: ${e?.message || 'unknown'}` }
    }
  },
}
