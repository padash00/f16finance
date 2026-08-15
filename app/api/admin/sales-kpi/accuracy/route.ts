/**
 * Точность модели и калибровка бонусных уровней.
 *
 * Это экран, на который нужно смотреть ДО того, как включать выплаты. Он
 * отвечает на два вопроса:
 *
 *   1. насколько ожидание вообще попадает в факт (WAPE и смещение);
 *   2. какая доля смен взяла бы B1, B2 и B3 на реальной истории.
 *
 * Второй вопрос важнее. Порог, который берут почти все, не мотивирует; порог,
 * который не берёт никто, воспринимается как обман.
 *
 * Бэктест идёт строго вперёд по времени: план на день считается по истории,
 * известной к началу этого дня.
 */
import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  earliestSaleDate,
  inScope,
  loadShiftFacts,
  loadStoreKpiSettings,
  resolveStoreKpiContext,
  todayISO,
} from '@/lib/server/store-kpi'
import {
  analyzeStoreKpi,
  backtestPlans,
  bonusRoi,
  forecastAccuracy,
  resolveBonus,
  type ShiftPlan,
} from '@/lib/domain/store-kpi'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveStoreKpiContext(request, 'sales-kpi.view', json)
    if ('response' in ctx) return ctx.response
    const { supabase, scope } = ctx

    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id')
    if (!companyId) return json({ error: 'company-required' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    const today = todayISO()
    const { settings } = await loadStoreKpiSettings(supabase, companyId)

    const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? today
    const facts = await loadShiftFacts(supabase, { companyId, from: historyFrom, to: today })

    const backtest = backtestPlans(facts, settings)

    // Отдельно — точность уже объявленных планов. Бэктест показывает, как
    // модель вела бы себя на всей истории, а это — как она реально сработала
    // на тех сменах, где план был объявлен заранее.
    const { data: planRows, error: planErr } = await supabase
      .from('store_kpi_shift_plans')
      .select('plan_date, shift, control_amount, b1_amount, b2_amount, b3_amount, record_threshold, expected_revenue, monthly_index, locked_at')
      .eq('company_id', companyId)
      .lte('plan_date', today)
      .order('plan_date', { ascending: false })
      .limit(400)
    if (planErr) throw planErr

    const factByKey = new Map(facts.map((f) => [`${f.date}|${f.shift}`, f]))
    const livePairs: { date: string; expected: number; actual: number }[] = []
    const liveLevels: Record<string, number> = { none: 0, b1: 0, b2: 0, b3: 0, record: 0 }
    let liveBonusCost = 0
    let liveShifts = 0

    for (const row of planRows || []) {
      const fact = factByKey.get(`${row.plan_date}|${row.shift}`)
      if (!fact || fact.receipts <= 0) continue

      liveShifts += 1
      if (row.expected_revenue) {
        livePairs.push({
          date: String(row.plan_date),
          expected: Number(row.expected_revenue),
          actual: fact.revenue,
        })
      }

      const plan: ShiftPlan = {
        control: Number(row.control_amount),
        b1: Number(row.b1_amount),
        b2: Number(row.b2_amount),
        b3: Number(row.b3_amount),
        record_threshold: row.record_threshold == null ? null : Number(row.record_threshold),
        monthly_index: Number(row.monthly_index) || 1,
        level: 'all',
        sample: 0,
      }
      const outcome = resolveBonus(fact.revenue, plan, settings)
      liveLevels[outcome.level] += 1
      liveBonusCost += outcome.amount
    }

    // Окупаемость программы: прирост над нормой против выплат. Считается по
    // тем сменам, где план был объявлен заранее — сравнивать «что было бы»
    // на всей истории значило бы приписывать бонусам чужой рост.
    const livePeriodFrom = (planRows || []).length
      ? String(planRows[planRows.length - 1].plan_date)
      : today
    const liveAnalysis = analyzeStoreKpi({
      baselineFacts: facts.filter((f) => f.date < livePeriodFrom),
      targetFacts: facts.filter((f) => f.date >= livePeriodFrom),
      settings,
    })
    // Окупаемость должна считать те деньги, которые модуль РЕАЛЬНО платит.
    // Сменные бонусы по умолчанию платятся правилами зарплаты, а не отсюда —
    // ставить их в расход означало бы посчитать чужие выплаты своими.
    let paidBonusCost = liveBonusCost
    if (!settings.shift_bonus_paid) {
      const { data: awards } = await supabase
        .from('store_kpi_bonus_awards')
        .select('amount, period_start, voided_at')
        .eq('company_id', companyId)
        .eq('kind', 'monthly')
        .gte('period_start', livePeriodFrom)
      paidBonusCost = (awards || [])
        .filter((a: any) => !a.voided_at)
        .reduce((sum: number, a: any) => sum + Number(a.amount || 0), 0)
    }

    const roi = bonusRoi(liveAnalysis.shifts, paidBonusCost, settings)

    return json({
      data: {
        company_id: companyId,
        roi,
        shift_bonus_paid: settings.shift_bonus_paid,
        history: {
          from: facts[0]?.date ?? null,
          to: facts[facts.length - 1]?.date ?? null,
          shifts: facts.length,
        },
        backtest: {
          evaluated: backtest.evaluated,
          skipped_no_history: backtest.skipped_no_history,
          hit_rates: backtest.hit_rates,
          review_rate: backtest.review_rate,
          // Сколько стоили бы сменные бонусы, если бы их платил этот модуль.
          bonus_cost: backtest.bonus_cost,
          bonus_cost_hypothetical: !settings.shift_bonus_paid,
          revenue: backtest.revenue,
          // Доля бонусного фонда в выручке — главный ограничитель здравого
          // смысла: бонусы не должны съедать маржу.
          bonus_share: backtest.revenue > 0 ? Math.round((backtest.bonus_cost / backtest.revenue) * 10000) / 10000 : null,
          accuracy: backtest.accuracy,
          calibration: backtest.calibration,
        },
        live: {
          shifts: liveShifts,
          accuracy: forecastAccuracy(livePairs),
          levels: liveLevels,
          bonus_cost: liveBonusCost,
        },
        settings: {
          b1_amount: settings.b1_amount,
          b2_amount: settings.b2_amount,
          b3_amount: settings.b3_amount,
          record_amount: settings.record_amount,
          min_sample_size: settings.min_sample_size,
        },
        model_version: settings.model_version,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/accuracy GET',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[sales-kpi/accuracy]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
