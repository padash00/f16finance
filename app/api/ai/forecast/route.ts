import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, streamAiText, type AiMessage } from '@/lib/ai/provider'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

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

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
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

async function fetchAllRows(
  queryFactory: (from: number, to: number) => any,
  pageSize = 2000,
) {
  const rows: any[] = []
  let offset = 0
  while (true) {
    const { data, error } = await queryFactory(offset, offset + pageSize - 1)
    if (error) throw error
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < pageSize) break
    offset += pageSize
  }
  return rows
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-forecast:${access.user?.id || ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'too-many-requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as { company_id?: string | null; stream?: boolean | null }
    const selectedCompanyId = typeof body.company_id === 'string' && body.company_id.trim().length > 0 ? body.company_id.trim() : null

    const dateTo = todayISO()
    const dateFrom = addDaysISO(dateTo, -89) // 90 days of history

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const incomesPromise = fetchAllRows((from, to) => {
      let query = supabase
        .from('incomes')
        .select('date, company_id, cash_amount, kaspi_amount, online_amount, card_amount')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
        .range(from, to)
      if (selectedCompanyId) query = query.eq('company_id', selectedCompanyId)
      return query
    })
    const expensesPromise = fetchAllRows((from, to) => {
      let query = supabase
        .from('expenses')
        .select('date, company_id, cash_amount, kaspi_amount')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
        .range(from, to)
      if (selectedCompanyId) query = query.eq('company_id', selectedCompanyId)
      return query
    })

    const [incomeRows, expenseRows] = await Promise.all([incomesPromise, expensesPromise])

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

    for (const row of incomeRows) {
      const wi = getWeekIndex(row.date)
      if (wi >= 0 && wi < numWeeks) {
        weeklyIncome[wi] += safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount) + safeNumber(row.online_amount) + safeNumber(row.card_amount)
      }
    }
    for (const row of expenseRows) {
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

    // Среднее по ненулевым неделям — fallback когда регрессия даёт 0
    const avgWeeklyIncome = nonZeroIncome.length > 0
      ? nonZeroIncome.reduce((s, v) => s + v, 0) / nonZeroIncome.length
      : 0
    const avgWeeklyExpense = nonZeroExpense.length > 0
      ? nonZeroExpense.reduce((s, v) => s + v, 0) / nonZeroExpense.length
      : 0

    // Project next 13 weeks. Если регрессия даёт 0 (мало данных, slope < 0),
    // используем среднюю недельную сумму × количество недель — иначе
    // прогноз "0 ₸" за 60/90 дней при наличии расходов выглядит как баг.
    const projectWeek = (reg: { slope: number; intercept: number }, weekIndex: number, weeks: number, avg: number) => {
      const fromReg = Math.max(0, reg.slope * weekIndex + reg.intercept) * weeks
      // Если регрессия близка к нулю но есть исторические данные — используем среднее
      if (fromReg < avg * weeks * 0.1 && avg > 0) {
        return avg * weeks
      }
      return fromReg
    }

    const n = numWeeks
    const projected = {
      week4Income: projectWeek(incomeReg, n + 3, 4, avgWeeklyIncome),
      week8Income: projectWeek(incomeReg, n + 7, 8, avgWeeklyIncome),
      week13Income: projectWeek(incomeReg, n + 12, 13, avgWeeklyIncome),
      week4Expense: projectWeek(expenseReg, n + 3, 4, avgWeeklyExpense),
      week8Expense: projectWeek(expenseReg, n + 7, 8, avgWeeklyExpense),
      week13Expense: projectWeek(expenseReg, n + 12, 13, avgWeeklyExpense),
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

    const aiPayload: { model: string; maxTokens: number; messages: AiMessage[] } = {
      model: OPENAI_MODEL,
      maxTokens: 1200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }

    const responsePayload = {
      dateFrom,
      dateTo,
      weeklyIncome,
      weeklyExpense,
      weekLabels,
      projected,
      scenarios,
      avgWeeklyIncome,
      avgWeeklyExpense,
    }

    if (body.stream === true) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(sse('meta', responsePayload)))
            const result = await streamAiText({
              ...aiPayload,
              onDelta: (text) => controller.enqueue(encoder.encode(sse('delta', { text }))),
            })
            await logAiUsageSafe(access.supabase, {
              userId: access.user?.id || null,
              endpoint: '/api/ai/forecast',
              provider: result.provider,
              model: result.model,
              usage: result.usage,
            })
            controller.enqueue(encoder.encode(sse('done', { ok: true, provider: result.provider, model: result.model })))
            controller.close()
          } catch (error) {
            await logAiUsageSafe(access.supabase, {
              userId: access.user?.id || null,
              endpoint: '/api/ai/forecast',
              model: OPENAI_MODEL,
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            })
            controller.enqueue(encoder.encode(sse('error', { error: error instanceof Error ? error.message : String(error) })))
            controller.close()
          }
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive',
        },
      })
    }

    const result = await generateAiText(aiPayload).catch(async (error) => {
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/ai/forecast',
        model: OPENAI_MODEL,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    })

    const text = result.text.trim()
    if (!text) return NextResponse.json({ error: 'ИИ не вернул прогноз.' }, { status: 500 })

    await logAiUsageSafe(access.supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/ai/forecast',
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    })

    return NextResponse.json({
      text,
      ...responsePayload,
    })
  } catch (error) {
    console.error('POST /api/ai/forecast failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка генерации прогноза.' }, { status: 500 })
  }
}
