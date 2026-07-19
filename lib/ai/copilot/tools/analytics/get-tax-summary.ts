/**
 * AI tool: расчёт налоговой базы за период (3% от выручки).
 * Capability: tax.view
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds, fetchAllPages } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const reIso = /^\d{4}-\d{2}-\d{2}$/

export const getTaxSummaryTool: CopilotTool = {
  name: 'get_tax_summary',
  category: 'analytics',
  description: 'Расчёт налоговой базы (выручка × 3% упрощёнки) за квартал/год',
  requiredCapability: 'tax.view',
  severity: 'low',
  params: [
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'За какой период считаем',
      getOptions: async () => [
        { value: 'currentQuarter', label: 'Текущий квартал' },
        { value: 'lastQuarter', label: 'Прошлый квартал' },
        { value: 'currentYear', label: 'Текущий год' },
      ],
    },
    { name: 'from', label: 'С даты', type: 'string', required: false, description: 'Начало периода YYYY-MM-DD (произвольный диапазон, имеет приоритет над period).' },
    { name: 'to', label: 'По дату', type: 'string', required: false, description: 'Конец периода YYYY-MM-DD.' },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || 'currentQuarter')
    const now = new Date()
    const today = todayISO()
    let from = today
    let to = today

    const inFrom = String(input.from || '').trim()
    const inTo = String(input.to || '').trim()
    const hasExact = reIso.test(inFrom) && reIso.test(inTo)

    if (hasExact) {
      from = inFrom
      to = inTo
    } else if (period === 'currentQuarter') {
      const qStart = Math.floor(now.getMonth() / 3) * 3
      from = `${now.getFullYear()}-${String(qStart + 1).padStart(2, '0')}-01`
      to = today
    } else if (period === 'lastQuarter') {
      const qStart = Math.floor(now.getMonth() / 3) * 3 - 3
      const fromMonth = qStart < 0 ? qStart + 12 : qStart
      const fromYear = qStart < 0 ? now.getFullYear() - 1 : now.getFullYear()
      from = `${fromYear}-${String(fromMonth + 1).padStart(2, '0')}-01`
      const toMonth = fromMonth + 3
      const toEnd = new Date(fromYear, toMonth, 0)
      to = `${toEnd.getFullYear()}-${String(toEnd.getMonth() + 1).padStart(2, '0')}-${String(toEnd.getDate()).padStart(2, '0')}`
    } else if (period === 'currentYear') {
      from = `${now.getFullYear()}-01-01`
      to = today
    }

    // Налоговая база — только по компаниям своей организации.
    const ids = await scopedCompanyIds(ctx)
    const data = await fetchAllPages((rFrom, rTo) => {
      let taxQ = ctx.supabase
        .from('incomes')
        .select('cash_amount, kaspi_amount, card_amount, online_amount')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(rFrom, rTo)
      if (ids) taxQ = taxQ.in('company_id', ids)
      return taxQ
    }).catch(() => [] as any[])

    let revenue = 0
    for (const r of (data || []) as any[]) {
      revenue += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    }
    const tax = revenue * 0.03

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const periodLabel: Record<string, string> = {
      currentQuarter: 'текущий квартал',
      lastQuarter: 'прошлый квартал',
      currentYear: 'текущий год',
    }
    const label = hasExact ? (from === to ? from : `${from} — ${to}`) : periodLabel[period]

    return {
      ok: true,
      message: `📊 Налог за ${label}:
  Период: ${from} — ${to}
  Выручка: ${fmt(revenue)}
  Налог 3% (упрощёнка): ${fmt(tax)}
  Записей в incomes: ${(data || []).length}`,
      data: { revenue, tax, from, to },
    }
  },
}
