/**
 * AI Forecast API: умный прогноз доходов/расходов/прибыли с разбивкой
 * по категориям, трендами, точками роста и сравнением с KPI планом.
 *
 * Возвращает богатый контекст для GPT-аналитика (трёхпериодное сравнение,
 * топ-категории расходов, выбросы, сезонность по дням недели, etc).
 */

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

function daysBetween(fromISO: string, toISO: string) {
  const [fy, fm, fd] = fromISO.split('-').map(Number)
  const [ty, tm, td] = toISO.split('-').map(Number)
  return Math.floor(
    (new Date(ty, (tm || 1) - 1, td || 1).getTime() - new Date(fy, (fm || 1) - 1, fd || 1).getTime()) / 86_400_000,
  )
}

function safeNumber(v: number | null | undefined) {
  return Number(v || 0)
}

function formatMoney(v: number) {
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`
}

function formatPct(v: number) {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
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

/** Median и std dev для определения выбросов */
function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function stdDev(values: number[]) {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
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
        .select('date, company_id, category, cash_amount, kaspi_amount, comment')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
        .range(from, to)
      if (selectedCompanyId) query = query.eq('company_id', selectedCompanyId)
      return query
    })

    // KPI-плана за текущий месяц
    const kpiPromise = (async () => {
      const monthStart = `${dateTo.slice(0, 7)}-01`
      let kpiQuery = supabase
        .from('kpi_plans')
        .select('company_id, target_amount, period_start, period_end')
        .eq('kind', 'monthly_revenue')
        .lte('period_start', dateTo)
        .gte('period_end', dateFrom)
      if (selectedCompanyId) kpiQuery = kpiQuery.eq('company_id', selectedCompanyId)
      const { data } = await kpiQuery
      return (data || []) as Array<{ company_id: string; target_amount: number; period_start: string; period_end: string }>
    })().catch(() => [] as Array<{ company_id: string; target_amount: number; period_start: string; period_end: string }>)

    const [incomeRows, expenseRows, kpiPlans] = await Promise.all([incomesPromise, expensesPromise, kpiPromise])

    // ─── По неделям ────────────────────────────────────────────────────────
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

    function getDayOfWeek(dateStr: string) {
      const [y, m, d] = dateStr.split('-').map(Number)
      return new Date(y, (m || 1) - 1, d || 1).getDay() // 0=Вс, 1=Пн ... 6=Сб
    }

    const numWeeks = 13
    for (let i = 0; i < numWeeks; i++) {
      weeklyIncome.push(0)
      weeklyExpense.push(0)
      const weekStart = addDaysISO(dateFrom, i * 7)
      const weekEnd = addDaysISO(dateFrom, i * 7 + 6)
      weekLabels.push(`${weekStart} — ${weekEnd}`)
    }

    // По дням недели (для сезонности: понедельник лучше или хуже субботы)
    const incomeByDayOfWeek = [0, 0, 0, 0, 0, 0, 0]
    const incomeCountByDayOfWeek = [0, 0, 0, 0, 0, 0, 0]

    for (const row of incomeRows) {
      const wi = getWeekIndex(row.date)
      const total = safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount) + safeNumber(row.online_amount) + safeNumber(row.card_amount)
      if (wi >= 0 && wi < numWeeks) {
        weeklyIncome[wi] += total
      }
      const dow = getDayOfWeek(row.date)
      incomeByDayOfWeek[dow] += total
      incomeCountByDayOfWeek[dow]++
    }
    for (const row of expenseRows) {
      const wi = getWeekIndex(row.date)
      if (wi >= 0 && wi < numWeeks) {
        weeklyExpense[wi] += safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount)
      }
    }

    // ─── Категории расходов ────────────────────────────────────────────────
    const expenseByCategory = new Map<string, { total: number; count: number; recent: number; older: number }>()
    const cutoff30 = addDaysISO(dateTo, -29) // последние 30 дней
    for (const row of expenseRows) {
      const cat = (row.category || 'Без категории').trim()
      const sum = safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount)
      if (sum <= 0) continue
      const cur = expenseByCategory.get(cat) || { total: 0, count: 0, recent: 0, older: 0 }
      cur.total += sum
      cur.count++
      if (row.date >= cutoff30) cur.recent += sum
      else cur.older += sum
      expenseByCategory.set(cat, cur)
    }
    const topExpenseCategories = Array.from(expenseByCategory.entries())
      .map(([category, stats]) => ({ category, ...stats, share: stats.total / Math.max(1, expenseRows.reduce((s, r) => s + safeNumber(r.cash_amount) + safeNumber(r.kaspi_amount), 0)) * 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 7)

    // ─── Трёхпериодное сравнение (последние 30 / 30-60 / 60-90) ────────────
    const last30Income = sumInRange(incomeRows, addDaysISO(dateTo, -29), dateTo, 'income')
    const prev30Income = sumInRange(incomeRows, addDaysISO(dateTo, -59), addDaysISO(dateTo, -30), 'income')
    const prevPrev30Income = sumInRange(incomeRows, addDaysISO(dateTo, -89), addDaysISO(dateTo, -60), 'income')

    const last30Expense = sumInRange(expenseRows, addDaysISO(dateTo, -29), dateTo, 'expense')
    const prev30Expense = sumInRange(expenseRows, addDaysISO(dateTo, -59), addDaysISO(dateTo, -30), 'expense')
    const prevPrev30Expense = sumInRange(expenseRows, addDaysISO(dateTo, -89), addDaysISO(dateTo, -60), 'expense')

    const incomeMomentum = prev30Income > 0 ? ((last30Income - prev30Income) / prev30Income) * 100 : 0
    const expenseMomentum = prev30Expense > 0 ? ((last30Expense - prev30Expense) / prev30Expense) * 100 : 0
    const last30Profit = last30Income - last30Expense
    const prev30Profit = prev30Income - prev30Expense
    const profitMomentum = prev30Profit !== 0 ? ((last30Profit - prev30Profit) / Math.abs(prev30Profit)) * 100 : 0
    const last30Margin = last30Income > 0 ? (last30Profit / last30Income) * 100 : 0
    const prev30Margin = prev30Income > 0 ? (prev30Profit / prev30Income) * 100 : 0

    // ─── Выбросы — расходы, превышающие median+2σ ─────────────────────────
    const expenseAmounts = expenseRows
      .map((r) => safeNumber(r.cash_amount) + safeNumber(r.kaspi_amount))
      .filter((v) => v > 0)
    const expMed = median(expenseAmounts)
    const expStd = stdDev(expenseAmounts)
    const outlierThreshold = expMed + 2 * expStd
    const outliers = expenseRows
      .filter((r) => {
        const sum = safeNumber(r.cash_amount) + safeNumber(r.kaspi_amount)
        return sum > 0 && sum > outlierThreshold
      })
      .sort((a, b) => safeNumber(b.cash_amount) + safeNumber(b.kaspi_amount) - safeNumber(a.cash_amount) - safeNumber(a.kaspi_amount))
      .slice(0, 5)

    // ─── Прогноз ──────────────────────────────────────────────────────────
    const nonZeroIncome = weeklyIncome.filter((v) => v > 0)
    const nonZeroExpense = weeklyExpense.filter((v) => v > 0)
    const incomeReg = linearRegression(nonZeroIncome.length >= 3 ? weeklyIncome : nonZeroIncome)
    const expenseReg = linearRegression(nonZeroExpense.length >= 3 ? weeklyExpense : nonZeroExpense)

    const avgWeeklyIncome = nonZeroIncome.length > 0
      ? nonZeroIncome.reduce((s, v) => s + v, 0) / nonZeroIncome.length
      : 0
    const avgWeeklyExpense = nonZeroExpense.length > 0
      ? nonZeroExpense.reduce((s, v) => s + v, 0) / nonZeroExpense.length
      : 0

    const projectWeek = (reg: { slope: number; intercept: number }, weekIndex: number, weeks: number, avg: number) => {
      const fromReg = Math.max(0, reg.slope * weekIndex + reg.intercept) * weeks
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

    // KPI план — сравнение текущего месяца с целью
    const totalKpiPlan = kpiPlans.reduce((s, k) => s + Number(k.target_amount || 0), 0)
    const monthIncome = sumInRange(incomeRows, dateTo.slice(0, 7) + '-01', dateTo, 'income')
    const kpiProgress = totalKpiPlan > 0 ? (monthIncome / totalKpiPlan) * 100 : null

    // ─── Сезонность: лучший/худший день недели ─────────────────────────────
    const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    const avgByDay = incomeByDayOfWeek.map((sum, i) => ({
      name: dayNames[i],
      avg: incomeCountByDayOfWeek[i] > 0 ? sum / incomeCountByDayOfWeek[i] : 0,
    }))
    const sortedDays = [...avgByDay].sort((a, b) => b.avg - a.avg)
    const bestDay = sortedDays[0]
    const worstDay = sortedDays[sortedDays.length - 1]

    // ─── Контекст для GPT ──────────────────────────────────────────────────
    const weeklyContext = weekLabels
      .map((label, i) => `Неделя ${i + 1} (${label}): доход ${formatMoney(weeklyIncome[i])}, расход ${formatMoney(weeklyExpense[i])}, прибыль ${formatMoney(weeklyIncome[i] - weeklyExpense[i])}`)
      .join('\n')

    const categoriesContext = topExpenseCategories
      .map((c) => {
        const trend = c.older > 0 ? ((c.recent - c.older) / c.older) * 100 : 0
        const trendArrow = Math.abs(trend) < 10 ? '→' : trend > 0 ? '↑' : '↓'
        return `  ${c.category}: ${formatMoney(c.total)} (${c.share.toFixed(1)}%, ${c.count} операций, тренд ${trendArrow} ${formatPct(trend)})`
      })
      .join('\n')

    const outliersContext = outliers.length > 0
      ? outliers.map((o) => `  ${o.date} · ${o.category} · ${formatMoney(safeNumber(o.cash_amount) + safeNumber(o.kaspi_amount))}${o.comment ? ` (${o.comment})` : ''}`).join('\n')
      : '  нет крупных выбросов'

    const systemPrompt = [
      'Ты — старший финансовый аналитик системы Orda Control с опытом работы с игровыми клубами и POS-бизнесами.',
      'Твоя задача — дать ВЛАДЕЛЬЦУ глубокий и actionable анализ, а не общие фразы.',
      '',
      'СТРУКТУРА (используй эти заголовки):',
      '## 📊 Что произошло за 90 дней',
      '## 🔥 Главное сейчас (последние 30 дней)',
      '## 💰 Прогноз доходов (30/60/90 дней)',
      '## 💸 Прогноз расходов и риски',
      '## 🎯 Где зарабатывать больше',
      '## ✂️ Где экономить',
      '## 📋 3 конкретных действия на эту неделю',
      '',
      'ПРАВИЛА:',
      '- **Жирным** — конкретные цифры. Каждый абзац начинается с цифры или факта.',
      '- НЕ пиши "вам следует рассмотреть возможность" — пиши прямо: "сократи Х на 10%, экономия 50к".',
      '- В "Главном сейчас" — резюме за 30 дней vs предыдущие 30: рост/падение в %.',
      '- В "Где экономить" — конкретные категории с долей и трендом.',
      '- Если есть выбросы — упомяни их явно (раз в месяц 200к на ремонт — это нормально, или нет?).',
      '- Если есть KPI план — сравни прогноз с ним.',
      '- В "3 действия" — конкретно: "позвонить поставщику X — у него закупки выросли на 30%".',
      '- Не повторяй промпт. Пиши как будто говоришь с владельцем за чаем.',
    ].join('\n')

    const userMessage = [
      `Период анализа: ${dateFrom} — ${dateTo}`,
      selectedCompanyId ? `Точка: одна выбрана` : `Точки: все доступные`,
      '',
      `## Трёхпериодное сравнение (по 30 дней):`,
      `Доходы: ${formatMoney(prevPrev30Income)} → ${formatMoney(prev30Income)} → ${formatMoney(last30Income)} (последние 30 vs предыдущие 30: ${formatPct(incomeMomentum)})`,
      `Расходы: ${formatMoney(prevPrev30Expense)} → ${formatMoney(prev30Expense)} → ${formatMoney(last30Expense)} (последние 30 vs предыдущие 30: ${formatPct(expenseMomentum)})`,
      `Прибыль: ${formatMoney(prevPrev30Income - prevPrev30Expense)} → ${formatMoney(prev30Profit)} → ${formatMoney(last30Profit)} (${formatPct(profitMomentum)})`,
      `Маржа: ${prev30Margin.toFixed(1)}% → ${last30Margin.toFixed(1)}%`,
      '',
      `## По неделям (последние 13):`,
      weeklyContext,
      '',
      `## Топ-7 категорий расходов:`,
      categoriesContext || '  нет данных',
      '',
      `## Выбросы (расходы > median + 2σ = ${formatMoney(outlierThreshold)}):`,
      outliersContext,
      '',
      `## Сезонность (средний доход в день недели):`,
      `Лучший: ${bestDay?.name || '?'} (${formatMoney(bestDay?.avg || 0)})`,
      `Худший: ${worstDay?.name || '?'} (${formatMoney(worstDay?.avg || 0)})`,
      '',
      kpiProgress !== null
        ? `## KPI-план на этот месяц: ${formatMoney(totalKpiPlan)} | Факт: ${formatMoney(monthIncome)} (${kpiProgress.toFixed(0)}%)`
        : `## KPI-плана на этот месяц нет`,
      '',
      `## Прогноз (математический):`,
      `  30 дней: выручка ${formatMoney(projected.week4Income)}, расход ${formatMoney(projected.week4Expense)}, прибыль ${formatMoney(projected.week4Income - projected.week4Expense)}`,
      `  60 дней: выручка ${formatMoney(projected.week8Income)}, расход ${formatMoney(projected.week8Expense)}, прибыль ${formatMoney(projected.week8Income - projected.week8Expense)}`,
      `  90 дней: выручка ${formatMoney(projected.week13Income)}, расход ${formatMoney(projected.week13Expense)}, прибыль ${formatMoney(projected.week13Income - projected.week13Expense)}`,
      `  (Цифры выше — линейная экстраполяция. Используй их как опорные, но если видишь тренд — корректируй вручную.)`,
      '',
      'Дай профессиональный анализ владельцу. Будь прямолинеен.',
    ].join('\n')

    const aiPayload: { model: string; maxTokens: number; messages: AiMessage[] } = {
      model: OPENAI_MODEL,
      maxTokens: 1800,
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
      // ─── Новое в умной версии ───
      comparison: {
        last30: { income: last30Income, expense: last30Expense, profit: last30Profit, margin: last30Margin },
        prev30: { income: prev30Income, expense: prev30Expense, profit: prev30Profit, margin: prev30Margin },
        prevPrev30: { income: prevPrev30Income, expense: prevPrev30Expense },
        momentum: { income: incomeMomentum, expense: expenseMomentum, profit: profitMomentum },
      },
      categories: topExpenseCategories,
      outliers: outliers.map((o) => ({
        date: o.date,
        category: o.category,
        amount: safeNumber(o.cash_amount) + safeNumber(o.kaspi_amount),
        comment: o.comment || null,
      })),
      seasonality: { byDay: avgByDay, best: bestDay, worst: worstDay },
      kpi: kpiProgress !== null ? { plan: totalKpiPlan, actual: monthIncome, progress: kpiProgress } : null,
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

/** Helper: сумма доходов или расходов за период */
function sumInRange(rows: any[], from: string, to: string, kind: 'income' | 'expense'): number {
  let total = 0
  for (const row of rows) {
    if (row.date < from || row.date > to) continue
    if (kind === 'income') {
      total += safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount) + safeNumber(row.online_amount) + safeNumber(row.card_amount)
    } else {
      total += safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount)
    }
  }
  return total
}
