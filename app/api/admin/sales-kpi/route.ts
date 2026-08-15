/**
 * Эффективность продавцов магазина — данные страницы `/sales-kpi`.
 *
 * Отвечает на вопрос «касса просела из-за потока или из-за продавца».
 * Вся арифметика живёт в `lib/domain/store-kpi` (чистые функции, покрытые
 * тестами), сбор данных — в `lib/server/store-kpi`. Здесь только склейка.
 *
 * История ДО начала периода формирует ожидания, период — оценивается.
 * Смешивать их нельзя: смена не должна формировать планку, с которой её же
 * потом сравнивают.
 */
import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  addDaysISO,
  earliestSaleDate,
  listStorePoints,
  loadShiftFacts,
  loadStoreKpiSettings,
  resolveStoreKpiContext,
  inScope,
} from '@/lib/server/store-kpi'
import { analyzeStoreKpi, explainShift, trainingFlag } from '@/lib/domain/store-kpi'

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
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const requestedCompany = url.searchParams.get('company_id')
    if (!from || !to) return json({ error: 'from-and-to-required' }, 400)

    if (requestedCompany && !inScope(scope, requestedCompany)) {
      return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)
    }

    const stores = await listStorePoints(supabase, scope)
    // Отсутствие магазина и невыбранная точка — это не ошибка запроса, а
    // состояние страницы: отвечаем 200 с флагом, чтобы UI показал понятный
    // экран, а не красное «400».
    if (stores.length === 0) return json({ data: { stores: [], no_store: true } })

    const company = requestedCompany
      ? stores.find((s) => s.id === requestedCompany) || null
      : stores.length === 1
        ? stores[0]
        : null
    // Несколько магазинов и не выбран ни один: смешивать их в один рейтинг
    // нельзя — у точек разный ассортимент, поток и ожидания.
    if (!company) return json({ data: { stores, needs_company: true } })

    const { row: settingsRow, settings } = await loadStoreKpiSettings(supabase, company.id)

    const baselineFrom = (await earliestSaleDate(supabase, company.id)) ?? from
    const baselineTo = addDaysISO(from, -1)

    const facts = await loadShiftFacts(supabase, {
      companyId: company.id,
      from: baselineFrom,
      to,
    })

    const baselineFacts = facts.filter((f) => f.date <= baselineTo)
    const targetFacts = facts.filter((f) => f.date >= from && f.date <= to)

    const result = analyzeStoreKpi({ baselineFacts, targetFacts, settings })

    // ── Имена продавцов ───────────────────────────────────────────────────
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

    return json({
      data: {
        period: { from, to },
        company: { id: company.id, name: company.name },
        stores,
        settings: {
          min_sample_size: settings.min_sample_size,
          min_qualifying_shifts: settings.min_qualifying_shifts,
          min_receipts_for_full_score: settings.min_receipts_for_full_score,
          ratio_clip: [settings.ratio_clip_min, settings.ratio_clip_max],
          weights: settings.weights,
          summer_months: settings.summer_months,
          configured: Boolean(settingsRow),
        },
        coverage: result.coverage,
        totals,
        shifts: result.shifts.map((s) => ({
          date: s.fact.date,
          shift: s.fact.shift,
          season: s.season,
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
          // Развёрнутый разбор считается здесь же: он детерминированный и
          // должен быть виден без отдельного запроса и без участия ИИ.
          explanation: explainShift(s, settings),
        })),
        cashiers: result.cashiers.map((c) => {
          // Флаг обучения — рекомендация управляющему, а не наказание: он
          // ставится, только если картина повторяется несколько смен подряд.
          const flag = trainingFlag(c, result.shifts, settings)
          return {
            ...c,
            name: names.get(c.cashier_id) ?? 'Без имени',
            training_flag: flag.flagged,
            training_reason: flag.reason,
          }
        }),
        model_version: result.model_version,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi GET',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[sales-kpi]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
