/**
 * Сборка разбора смен и продавцов за период.
 *
 * Раньше это лежало прямо в GET-роуте страницы. Как только появились выгрузки
 * в PDF и Excel, стало ясно, что расчёт обязан быть один: отчёт, который
 * расходится с экраном, хуже отсутствия отчёта — верить нельзя ни ему, ни
 * экрану.
 *
 * История ДО начала периода формирует ожидания, сам период оценивается.
 * Смешивать их нельзя: смена не должна формировать планку, с которой её же
 * потом сравнивают.
 */

import { analyzeStoreKpi, explainShift, trainingFlag } from '@/lib/domain/store-kpi'
import {
  addDaysISO,
  earliestSaleDate,
  loadShiftFacts,
  loadStoreKpiSettings,
} from '@/lib/server/store-kpi'
import { contextForShift, loadContextSources, type ShiftContext } from '@/lib/server/store-kpi-context'

type AnyClient = any

export type StoreKpiReport = Awaited<ReturnType<typeof buildStoreKpiReport>>

export async function buildStoreKpiReport(
  supabase: AnyClient,
  args: {
    companyId: string
    organizationId: string | null
    from: string
    to: string
  },
) {
  const { companyId, from, to } = args

  const { row: settingsRow, settings } = await loadStoreKpiSettings(supabase, companyId)

  const baselineFrom = (await earliestSaleDate(supabase, companyId)) ?? from
  const baselineTo = addDaysISO(from, -1)

  const facts = await loadShiftFacts(supabase, { companyId, from: baselineFrom, to })

  const baselineFacts = facts.filter((f) => f.date <= baselineTo)
  const targetFacts = facts.filter((f) => f.date >= from && f.date <= to)

  const result = analyzeStoreKpi({ baselineFacts, targetFacts, settings })

  // Погода, праздники и учебные периоды — только для объяснения спроса.
  // В баллы они не входят.
  const context = await loadContextSources(supabase, companyId, args.organizationId, from, to)

  // ── Имена продавцов ──────────────────────────────────────────────────────
  const cashierIds = [...new Set(targetFacts.map((f) => f.cashier_id).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (cashierIds.length) {
    const { data: opsRows, error: opsErr } = await supabase
      .from('operators')
      .select('id, name, short_name')
      .in('id', cashierIds)
    if (opsErr) throw opsErr
    for (const op of opsRows || []) {
      names.set(String(op.id), String(op.short_name || op.name || 'Без имени'))
    }
  }

  const totals = {
    revenue: Math.round(targetFacts.reduce((sum, f) => sum + f.revenue, 0)),
    receipts: targetFacts.reduce((sum, f) => sum + f.receipts, 0),
    shifts: targetFacts.length,
    low_demand: result.shifts.filter((s) => s.verdict === 'LOW_DEMAND').length,
    cashier_issue: result.shifts.filter((s) => s.verdict === 'POSSIBLE_CASHIER_ISSUE').length,
    high_demand: result.shifts.filter((s) => s.verdict === 'HIGH_DEMAND').length,
    strong: result.shifts.filter((s) => s.verdict === 'STRONG_CASHIER').length,
    insufficient: result.shifts.filter((s) => s.verdict === 'INSUFFICIENT_DATA').length,
  }

  const shifts = result.shifts.map((s) => ({
    date: s.fact.date,
    shift: s.fact.shift,
    season: s.season,
    shift_id: s.fact.shift_id ?? null,
    duration_minutes: s.fact.duration_minutes ?? null,
    cashier_id: s.fact.cashier_id,
    cashier_name: s.fact.cashier_id ? names.get(s.fact.cashier_id) ?? 'Без имени' : null,
    revenue: Math.round(s.fact.revenue),
    expected_revenue: s.expected_revenue,
    receipts: s.fact.receipts,
    expected_receipts: s.expected_receipts,
    expected_avg_ticket: s.expected_avg_ticket,
    items: Math.round(s.fact.items),
    score: s.score,
    confidence: s.confidence,
    verdict: s.verdict,
    evidence: s.evidence,
    missing: s.missing,
    metrics: s.metrics,
    // Развёрнутый разбор считается здесь же: он детерминированный и должен
    // быть виден без отдельного запроса и без участия ИИ.
    explanation: explainShift(s, settings),
    context: contextForShift(s.fact, context) as ShiftContext,
  }))

  const cashiers = result.cashiers.map((c) => {
    // Флаг обучения — рекомендация управляющему, а не наказание: он ставится,
    // только если картина повторяется несколько смен подряд.
    const flag = trainingFlag(c, result.shifts, settings)
    return {
      ...c,
      name: names.get(c.cashier_id) ?? 'Без имени',
      training_flag: flag.flagged,
      training_reason: flag.reason,
    }
  })

  return {
    period: { from, to },
    settings,
    settingsConfigured: Boolean(settingsRow),
    coverage: result.coverage,
    totals,
    shifts,
    cashiers,
    model_version: result.model_version,
  }
}

/**
 * Предупреждения о качестве данных — теми же словами, что на экране.
 *
 * Живут здесь, потому что нужны и странице, и выгрузкам: отчёт обязан честно
 * сказать, чего в данных не хватало, иначе его цифры выглядят надёжнее, чем
 * они есть.
 */
export function coverageWarnings(coverage: {
  baseline_shifts: number
  attach_coverage: number
  items_coverage: number
  cashier_coverage: number
}): string[] {
  const list: string[] = []

  if (coverage.baseline_shifts < 20) {
    list.push(
      `История короткая: ${coverage.baseline_shifts} смен до начала периода. Ожидания будут грубыми, а часть выводов — «мало данных».`,
    )
  }
  if (coverage.attach_coverage < 0.3) {
    list.push(
      'Правила допродаж срабатывают меньше чем в трети смен — метрика допродаж почти не участвует в оценке. Проверьте, заведены ли правила и проставлены ли категории у товаров.',
    )
  }
  if (coverage.items_coverage < 0.5) {
    list.push(
      'Больше половины смен без построчных чеков: средний чек, товары на чек и допродажи по ним не считаются.',
    )
  }
  if (coverage.cashier_coverage < 0.9) {
    list.push('Часть чеков без кассира — такие смены в оценку людей не попадают.')
  }

  return list
}
