/**
 * AI tool: запросить выручку за период.
 * Capability: income.view
 */

import type { CopilotTool } from '../../types'
import { companyOptions, scopedCompanyIds, fetchAllPages } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysISO(iso: string, diff: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export const queryRevenueTool: CopilotTool = {
  name: 'query_revenue',
  category: 'analytics',
  description: 'Посчитать выручку за период',
  requiredCapability: 'income.view',
  severity: 'low',
  params: [
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: false,
      description: 'Готовый период. ИЛИ используй точные даты from/to для конкретного диапазона.',
      getOptions: async () => [
        { value: 'today', label: 'Сегодня' },
        { value: 'yesterday', label: 'Вчера' },
        { value: 'week', label: 'Эта неделя (7 дней)' },
        { value: 'month', label: 'Этот месяц (30 дней)' },
      ],
    },
    { name: 'from', label: 'С даты', type: 'string', required: false, description: 'Начало YYYY-MM-DD (для произвольного диапазона, напр. «за 15-21 июня»).' },
    { name: 'to', label: 'По дату', type: 'string', required: false, description: 'Конец YYYY-MM-DD.' },
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: false,
      description: 'Фильтр по точке. Если не указан — все.',
      getOptions: async (ctx) => companyOptions(ctx, { allLabel: '📍 Все точки' }),
    },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || '')
    const companyId = String(input.company_id || '')
    const today = todayISO()
    const reIso = /^\d{4}-\d{2}-\d{2}$/

    let from = today
    let to = today
    const inFrom = String(input.from || '').trim()
    const inTo = String(input.to || '').trim()
    if (reIso.test(inFrom) && reIso.test(inTo)) {
      from = inFrom; to = inTo
    } else if (period === 'yesterday') {
      from = addDaysISO(today, -1)
      to = from
    } else if (period === 'week') {
      from = addDaysISO(today, -6)
    } else if (period === 'month') {
      from = addDaysISO(today, -29)
    }

    // «Все точки» = только точки своей организации (мультитенантный скоуп).
    const ids = companyId ? null : await scopedCompanyIds(ctx)
    let rows: any[]
    try {
      rows = await fetchAllPages((rFrom, rTo) => {
        let query = ctx.supabase
          .from('incomes')
          .select('cash_amount, kaspi_amount, card_amount, online_amount, company_id, shift, date')
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(rFrom, rTo)
        if (companyId) query = query.eq('company_id', companyId)
        else if (ids) query = query.in('company_id', ids)
        return query
      })
    } catch (e: any) {
      return { ok: false, message: `Ошибка запроса: ${e?.message || 'unknown'}` }
    }
    let total = 0
    let cash = 0
    let kaspi = 0
    let card = 0
    let online = 0
    for (const r of rows) {
      cash += Number(r.cash_amount || 0)
      kaspi += Number(r.kaspi_amount || 0)
      card += Number(r.card_amount || 0)
      online += Number(r.online_amount || 0)
    }
    total = cash + kaspi + card + online

    const fmtMoney = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

    let companyLabel = ''
    if (companyId) {
      const { data: c } = await ctx.supabase.from('companies').select('name').eq('id', companyId).single()
      companyLabel = c?.name ? ` (${c.name})` : ''
    }

    const periodLabel: Record<string, string> = {
      today: 'сегодня',
      yesterday: 'вчера',
      week: 'неделя',
      month: 'месяц',
    }
    const label = reIso.test(inFrom) && reIso.test(inTo) ? (from === to ? from : `${from} — ${to}`) : (periodLabel[period] || 'сегодня')

    return {
      ok: true,
      message: `📊 Выручка за ${label}${companyLabel}:
Итого: ${fmtMoney(total)}
  💵 Наличные: ${fmtMoney(cash)}
  💳 Безналичный: ${fmtMoney(kaspi)}
  💸 Карта: ${fmtMoney(card)}
  🌐 Онлайн: ${fmtMoney(online)}
Записей в incomes: ${rows.length}`,
      data: { total, cash, kaspi, card, online, count: rows.length },
    }
  },
}
