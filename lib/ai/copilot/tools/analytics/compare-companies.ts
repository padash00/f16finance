/**
 * AI tool: сравнить две точки между собой по выручке/расходам/прибыли.
 * Capability: profitability.view
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

async function getStats(supabase: any, companyId: string, from: string, to: string) {
  const [incRows, expRows] = await Promise.all([
    fetchAllPages((rFrom, rTo) =>
      supabase
        .from('incomes')
        .select('cash_amount, kaspi_amount, card_amount, online_amount')
        .eq('company_id', companyId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(rFrom, rTo),
    ).catch(() => [] as any[]),
    fetchAllPages((rFrom, rTo) =>
      supabase
        .from('expenses')
        .select('cash_amount, kaspi_amount')
        .eq('company_id', companyId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(rFrom, rTo),
    ).catch(() => [] as any[]),
  ])
  let income = 0
  for (const r of incRows as any[]) {
    income += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
  }
  let expense = 0
  for (const r of expRows as any[]) {
    expense += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
  }
  return { income, expense, profit: income - expense }
}

export const compareCompaniesTool: CopilotTool = {
  name: 'compare_companies',
  category: 'analytics',
  description: 'Сравнить две точки между собой (выручка / расходы / прибыль / маржа)',
  requiredCapability: 'profitability.view',
  severity: 'low',
  params: [
    {
      name: 'company_a',
      label: 'Точка 1',
      type: 'select',
      required: true,
      description: 'Первая точка для сравнения',
      getOptions: async (ctx) => companyOptions(ctx),
    },
    {
      name: 'company_b',
      label: 'Точка 2',
      type: 'select',
      required: true,
      description: 'Вторая точка для сравнения',
      getOptions: async (ctx) => companyOptions(ctx),
    },
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'За какой период сравнивать',
      getOptions: async () => [
        { value: 'week', label: 'Неделя' },
        { value: 'month', label: 'Месяц' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const a = String(input.company_a || '')
    const b = String(input.company_b || '')
    const period = String(input.period || 'month')
    if (!a || !b) return { ok: false, message: 'Нужны две точки.' }
    if (a === b) return { ok: false, message: 'Выбери разные точки.' }

    // Мультитенантная изоляция: обе точки должны принадлежать своей организации
    // (нельзя сравнивать чужие точки по подставленному id).
    const ids = await scopedCompanyIds(ctx)
    if (ids && (!ids.includes(a) || !ids.includes(b))) {
      return { ok: false, message: 'Точка не найдена.' }
    }

    const today = todayISO()
    const from = period === 'week' ? addDaysISO(today, -6) : addDaysISO(today, -29)

    const [{ data: aRow }, { data: bRow }] = await Promise.all([
      ctx.supabase.from('companies').select('id, name').eq('id', a).single(),
      ctx.supabase.from('companies').select('id, name').eq('id', b).single(),
    ])
    if (!aRow || !bRow) return { ok: false, message: 'Точка не найдена.' }

    const [statsA, statsB] = await Promise.all([
      getStats(ctx.supabase, a, from, today),
      getStats(ctx.supabase, b, from, today),
    ])

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const marginA = statsA.income > 0 ? (statsA.profit / statsA.income) * 100 : 0
    const marginB = statsB.income > 0 ? (statsB.profit / statsB.income) * 100 : 0

    const winnerRev = statsA.income > statsB.income ? '🏆 ' + aRow.name : '🏆 ' + bRow.name
    const winnerProfit = statsA.profit > statsB.profit ? '🏆 ' + aRow.name : '🏆 ' + bRow.name
    const winnerMargin = marginA > marginB ? '🏆 ' + aRow.name : '🏆 ' + bRow.name

    return {
      ok: true,
      message: `⚖️ ${aRow.name} vs ${bRow.name} (${period === 'week' ? 'неделя' : 'месяц'}):

📊 Выручка:
  ${aRow.name}: ${fmt(statsA.income)}
  ${bRow.name}: ${fmt(statsB.income)}
  ${winnerRev}

💸 Расходы:
  ${aRow.name}: ${fmt(statsA.expense)}
  ${bRow.name}: ${fmt(statsB.expense)}

💰 Прибыль:
  ${aRow.name}: ${fmt(statsA.profit)}
  ${bRow.name}: ${fmt(statsB.profit)}
  ${winnerProfit}

📈 Маржа:
  ${aRow.name}: ${marginA.toFixed(1)}%
  ${bRow.name}: ${marginB.toFixed(1)}%
  ${winnerMargin}`,
      data: { a: { ...statsA, name: aRow.name }, b: { ...statsB, name: bRow.name } },
    }
  },
}
