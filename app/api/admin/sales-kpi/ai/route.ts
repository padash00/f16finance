/**
 * ИИ-разбор смены.
 *
 * Модель ничего не считает: и метрики, и вывод, и объяснение уже готовы
 * (`analyzeStoreKpi` + `explainShift`). Она получает их вместе с сырыми
 * числами и излагает связным текстом — с разбивкой на поток, кассу, работу
 * продавца, вывод и рекомендацию.
 *
 * Если ИИ недоступен, разбор всё равно возвращается — просто без текста
 * модели. Модуль обязан работать без неё.
 */
import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  addDaysISO,
  earliestSaleDate,
  inScope,
  loadShiftFacts,
  loadStoreKpiSettings,
  resolveStoreKpiContext,
} from '@/lib/server/store-kpi'
import { runPostShiftReview } from '@/lib/server/store-kpi-ai'
import { analyzeStoreKpi, explainShift } from '@/lib/domain/store-kpi'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveStoreKpiContext(request, 'sales-kpi.view', json)
    if ('response' in ctx) return ctx.response
    const { supabase, scope, access } = ctx

    const body = (await request.json().catch(() => ({}))) as Record<string, any>
    const companyId = String(body.company_id || '')
    const date = String(body.date || '')
    const shift = body.shift === 'night' ? 'night' : 'day'
    if (!companyId || !date) return json({ error: 'company-and-date-required' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id, name, organization_id')
      .eq('id', companyId)
      .maybeSingle()
    if (companyErr) throw companyErr
    if (!company?.organization_id) return json({ error: 'company-without-organization' }, 400)

    const { settings, clubId } = await loadStoreKpiSettings(supabase, companyId, scope)

    const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? date
    const facts = await loadShiftFacts(supabase, { companyId, from: historyFrom, to: date, clubId })

    const baselineFacts = facts.filter((f) => f.date <= addDaysISO(date, -1))
    const targetFacts = facts.filter((f) => f.date === date && f.shift === shift)
    if (targetFacts.length === 0) return json({ error: 'shift-not-found' }, 404)

    const analysis = analyzeStoreKpi({ baselineFacts, targetFacts, settings })
    const shiftAnalysis = analysis.shifts[0]
    const explanation = explainShift(shiftAnalysis, settings)

    let cashierName: string | null = null
    if (shiftAnalysis.fact.cashier_id) {
      const { data: op } = await supabase
        .from('operators')
        .select('name, short_name')
        .eq('id', shiftAnalysis.fact.cashier_id)
        .maybeSingle()
      cashierName = op ? String(op.short_name || op.name || '') : null
    }

    const { result, error } = await runPostShiftReview({
      supabase,
      organizationId: String(company.organization_id),
      companyId,
      actorUserId: access.user?.id || null,
      modelVersion: settings.model_version,
      subject: { date, shift, cashier_name: cashierName },
      facts: {
        revenue: Math.round(shiftAnalysis.fact.revenue),
        expected_revenue: shiftAnalysis.expected_revenue,
        club_revenue: shiftAnalysis.fact.club_revenue,
        expected_club_revenue: shiftAnalysis.expected_club_revenue,
        receipts: shiftAnalysis.fact.receipts,
        items: shiftAnalysis.fact.items,
        refunds: Math.round(shiftAnalysis.fact.refunds),
        score: shiftAnalysis.score,
        confidence: shiftAnalysis.confidence,
        verdict: shiftAnalysis.verdict,
        season: shiftAnalysis.season,
      },
      explanation,
    })

    return json({
      data: {
        date,
        shift,
        explanation,
        ai: result,
        // ИИ мог не ответить — это не ошибка страницы, разбор всё равно есть.
        ai_error: error,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/ai POST',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[sales-kpi/ai]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
