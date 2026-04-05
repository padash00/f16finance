import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

function todayISO() {
  const now = new Date()
  const t = now.getTime() - now.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

function addDaysISO(iso: string, diff: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  const t = dt.getTime() - dt.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

function safeNumber(v: number | null | undefined) {
  return Number(v || 0)
}

function formatMoney(v: number) {
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`
}

function linearRegression(values: number[]) {
  const n = values.length
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 }
  const xMean = (n - 1) / 2
  const yMean = values.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean)
    den += (i - xMean) ** 2
  }
  const slope = den !== 0 ? num / den : 0
  const intercept = yMean - slope * xMean
  return { slope, intercept }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY не настроен на сервере.' }, { status: 500 })
    }

    const dateTo = todayISO()
    const dateFrom = addDaysISO(dateTo, -89) // 90 days of history

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const [incomesRes, expensesRes] = await Promise.all([
      supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, online_amount, card_amount')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
        .range(0, 4999),
      supabase
        .from('expenses')
        .select('date, cash_amount, kaspi_amount')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
        .range(0, 4999),
    ])

    if (incomesRes.error) throw incomesRes.error
    if (expensesRes.error) throw expensesRes.error

    // Aggregate by week (7-day buckets from dateFrom)
    const weeklyIncome: number[] = []
    const weeklyExpense: number[] = []
    const weekLabels: string[] = []

    const [fy, fm, fd] = dateFrom.split('-').map(Number)
    const fromMs = new Date(fy, (fm || 1) - 1, fd || 1).getTime()

    function getWeekIndex(dateStr: string) {
      const [y, m, d] = dateStr.split('-').map(Number)
      const ms = new Date(y, (m || 1) - 1, d || 1).getTime()
      return Math.floor((ms - fromMs) / (7 * 24 * 60 * 60 * 1000))
    }

    const numWeeks = 13
    for (let i = 0; i < numWeeks; i++) {
      weeklyIncome.push(0)
      weeklyExpense.push(0)
      const weekStart = addDaysISO(dateFrom, i * 7)
      const weekEnd = addDaysISO(dateFrom, i * 7 + 6)
      weekLabels.push(`${weekStart} — ${weekEnd}`)
    }

    for (const row of incomesRes.data ?? []) {
      const wi = getWeekIndex(row.date)
      if (wi >= 0 && wi < numWeeks) {
        weeklyIncome[wi] += safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount) + safeNumber(row.online_amount) + safeNumber(row.card_amount)
      }
    }
    for (const row of expensesRes.data ?? []) {
      const wi = getWeekIndex(row.date)
      if (wi >= 0 && wi < numWeeks) {
        weeklyExpense[wi] += safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount)
      }
    }

    // Linear regression on weekly data
    const nonZeroIncome = weeklyIncome.filter((v) => v > 0)
    const nonZeroExpense = weeklyExpense.filter((v) => v > 0)
    const incomeReg = linearRegression(nonZeroIncome.length >= 3 ? weeklyIncome : nonZeroIncome)
    const expenseReg = linearRegression(nonZeroExpense.length >= 3 ? weeklyExpense : nonZeroExpense)

    // Project next 13 weeks
    const n = numWeeks
    const projected = {
      week4Income: Math.max(0, incomeReg.slope * (n + 3) + incomeReg.intercept) * 4,
      week8Income: Math.max(0, incomeReg.slope * (n + 7) + incomeReg.intercept) * 8,
      week13Income: Math.max(0, incomeReg.slope * (n + 12) + incomeReg.intercept) * 13,
      week4Expense: Math.max(0, expenseReg.slope * (n + 3) + expenseReg.intercept) * 4,
      week8Expense: Math.max(0, expenseReg.slope * (n + 7) + expenseReg.intercept) * 8,
      week13Expense: Math.max(0, expenseReg.slope * (n + 12) + expenseReg.intercept) * 13,
    }

    const scenarios = {
      pessimistic: {
        week4Income: projected.week4Income * 0.75,
        week8Income: projected.week8Income * 0.75,
        week13Income: projected.week13Income * 0.75,
        week4Expense: projected.week4Expense * 1.1,
        week8Expense: projected.week8Expense * 1.1,
        week13Expense: projected.week13Expense * 1.1,
      },
      realistic: projected,
      optimistic: {
        week4Income: projected.week4Income * 1.25,
        week8Income: projected.week8Income * 1.25,
        week13Income: projected.week13Income * 1.25,
        week4Expense: projected.week4Expense * 0.95,
        week8Expense: projected.week8Expense * 0.95,
        week13Expense: projected.week13Expense * 0.95,
      },
    }

    const totalHistoricalIncome = weeklyIncome.reduce((a, b) => a + b, 0)
    const totalHistoricalExpense = weeklyExpense.reduce((a, b) => a + b, 0)
    const avgWeeklyIncome = totalHistoricalIncome / numWeeks
    const avgWeeklyExpense = totalHistoricalExpense / numWeeks

    // Build context for GPT
    const weeklyContext = weekLabels
      .map((label, i) => `Неделя ${i + 1} (${label}): доход ${formatMoney(weeklyIncome[i])}, расход ${formatMoney(weeklyExpense[i])}, прибыль ${formatMoney(weeklyIncome[i] - weeklyExpense[i])}`)
      .join('\n')

    const systemPrompt = [
      'Ты — старший финансовый аналитик системы Orda Control.',
      'Составь профессиональный прогноз на русском языке на основе исторических данных.',
      '',
      'СТРУКТУРА (используй эти заголовки):',
      '## Тренд последних 90 дней',
      '## Прогноз на 30 дней',
      '## Прогноз на 60 дней',
      '## Прогноз на 90 дней',
      '## Рекомендации',
      '',
      'ПРАВИЛА:',
      '- Используй **жирный** для ключевых цифр',
      '- Укажи прогнозируемые цифры выручки и прибыли',
      '- Опирайся только на данные ниже, не выдумывай',
      '- Укажи факторы риска которые могут изменить прогноз',
      '- В конце — одно конкретное действие для улучшения прибыли',
    ].join('\n')

    const userMessage = [
      `Исторические данные за ${dateFrom} — ${dateTo} (по неделям):`,
      weeklyContext,
      '',
      `Средняя выручка в неделю: ${formatMoney(avgWeeklyIncome)}`,
      `Средний расход в неделю: ${formatMoney(avgWeeklyExpense)}`,
      `Расчётный прогноз (линейная экстраполяция):`,
      `  30 дней: выручка ${formatMoney(projected.week4Income)}, расход ${formatMoney(projected.week4Expense)}, прибыль ${formatMoney(projected.week4Income - projected.week4Expense)}`,
      `  60 дней: выручка ${formatMoney(projected.week8Income)}, расход ${formatMoney(projected.week8Expense)}, прибыль ${formatMoney(projected.week8Income - projected.week8Expense)}`,
      `  90 дней: выручка ${formatMoney(projected.week13Income)}, расход ${formatMoney(projected.week13Expense)}, прибыль ${formatMoney(projected.week13Income - projected.week13Expense)}`,
      '',
      'Составь детальный прогноз с анализом трендов.',
    ].join('\n')

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    })

    const json = await response.json().catch(() => null)
    if (!response.ok || json?.error) {
      return NextResponse.json({ error: json?.error?.message || `OpenAI API error (${response.status})` }, { status: 500 })
    }

    const text = json?.choices?.[0]?.message?.content?.trim() || ''
    if (!text) return NextResponse.json({ error: 'ИИ не вернул прогноз.' }, { status: 500 })

    return NextResponse.json({
      text,
      dateFrom,
      dateTo,
      weeklyIncome,
      weeklyExpense,
      weekLabels,
      projected,
      scenarios,
      avgWeeklyIncome,
      avgWeeklyExpense,
    })
  } catch (error) {
    console.error('POST /api/ai/forecast failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка генерации прогноза.' }, { status: 500 })
  }
}
