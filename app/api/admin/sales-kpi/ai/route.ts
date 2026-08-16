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
import { runCashierReview, runMonthlyReview, runPostShiftReview } from '@/lib/server/store-kpi-ai'
import { contextForShift, loadContextSources } from '@/lib/server/store-kpi-context'
import { buildStoreKpiReport } from '@/lib/server/store-kpi-report'
import {
  analyzeStoreKpi,
  bonusRoi,
  explainShift,
  monthlyBonus,
  retailDiagnostics,
} from '@/lib/domain/store-kpi'

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

    // ── Разбор одного продавца ────────────────────────────────────────────
    // Отвечает управляющему на вопрос «как с ним разговаривать», которого нет
    // ни у разбора смены, ни у разбора месяца.
    if (String(body.action || '') === 'cashier') {
      const cashierId = String(body.cashier_id || '')
      const from = String(body.from || '').slice(0, 10)
      const to = String(body.to || '').slice(0, 10)
      if (!companyId || !cashierId) return json({ error: 'cashier-required' }, 400)
      if (!from || !to) return json({ error: 'period-required' }, 400)
      if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

      const { data: co } = await supabase
        .from('companies')
        .select('id, name, organization_id')
        .eq('id', companyId)
        .maybeSingle()
      if (!co?.organization_id) return json({ error: 'company-without-organization' }, 400)

      const report = await buildStoreKpiReport(supabase, {
        companyId,
        organizationId: String(co.organization_id),
        from,
        to,
      })

      const target = report.cashiers.find((c: any) => c.cashier_id === cashierId)
      if (!target) return json({ error: 'cashier-not-found' }, 404)

      const mine = report.shifts.filter((s: any) => s.cashier_id === cashierId)

      const { result, error } = await runCashierReview({
        supabase,
        organizationId: String(co.organization_id),
        companyId,
        actorUserId: access.user?.id || null,
        modelVersion: report.settings.model_version,
        period: { from, to },
        cashier: {
          name: target.name,
          shifts: target.shifts,
          receipts: target.receipts,
          revenue: target.revenue,
          score: target.score,
          status: target.status,
          confidence: target.confidence,
          metric_ratios: target.metric_ratios,
          strengths: target.strengths,
          weaknesses: target.weaknesses,
          verdicts: target.verdicts,
          training_flag: target.training_flag,
          training_reason: target.training_reason,
        },
        shifts: mine.map((s: any) => ({
          date: s.date,
          shift: s.shift,
          verdict: s.verdict,
          score: s.score,
          confidence: s.confidence,
          revenue: s.revenue,
          expected_revenue: s.expected_revenue,
          receipts: s.receipts,
          expected_receipts: s.expected_receipts,
          // Обстановка нужна, чтобы модель не приняла снежный вечер за
          // слабую работу человека.
          weather: s.context?.weather?.label ?? null,
          holidays: (s.context?.days || []).map((d: any) => d.name),
          academic: (s.context?.periods || []).map((p: any) => p.name),
        })),
        peers: report.cashiers
          .filter((c: any) => c.cashier_id !== cashierId)
          .map((c: any) => ({ name: c.name, score: c.score, status: c.status, shifts: c.shifts })),
      })

      return json({ data: { cashier_id: cashierId, ai: result, ai_error: error } })
    }

    // ── Разбор месяца ─────────────────────────────────────────────────────
    if (String(body.action || '') === 'monthly') {
      const month = String(body.month || '')
      if (!companyId || !/^\d{4}-\d{2}$/.test(month)) return json({ error: 'month-required' }, 400)
      if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

      const { data: co } = await supabase
        .from('companies')
        .select('id, organization_id')
        .eq('id', companyId)
        .maybeSingle()
      if (!co?.organization_id) return json({ error: 'company-without-organization' }, 400)

      const { settings } = await loadStoreKpiSettings(supabase, companyId)
      const [y, m] = month.split('-').map(Number)
      const monthFrom = `${month}-01`
      const monthTo = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

      const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? monthFrom
      const monthFacts = await loadShiftFacts(supabase, {
        companyId,
        from: historyFrom,
        to: monthTo,
      })

      const analysis = analyzeStoreKpi({
        baselineFacts: monthFacts.filter((f) => f.date < monthFrom),
        targetFacts: monthFacts.filter((f) => f.date >= monthFrom && f.date <= monthTo),
        settings,
      })

      const names = new Map<string, string>()
      if (analysis.cashiers.length) {
        const { data: ops } = await supabase
          .from('operators')
          .select('id, name, short_name')
          .in('id', analysis.cashiers.map((c) => c.cashier_id))
        for (const op of ops || []) names.set(String(op.id), String(op.short_name || op.name || ''))
      }

      const { data: awardRows } = await supabase
        .from('store_kpi_bonus_awards')
        .select('amount, voided_at')
        .eq('company_id', companyId)
        .eq('kind', 'monthly')
        .eq('period_start', monthFrom)
      const paid = (awardRows || [])
        .filter((a: any) => !a.voided_at)
        .reduce((sum: number, a: any) => sum + Number(a.amount || 0), 0)

      const { result, error } = await runMonthlyReview({
        supabase,
        organizationId: String(co.organization_id),
        companyId,
        actorUserId: access.user?.id || null,
        modelVersion: settings.model_version,
        month,
        facts: {
          shifts: analysis.shifts.length,
          verdicts: analysis.shifts.reduce(
            (acc: Record<string, number>, s) => {
              acc[s.verdict] = (acc[s.verdict] || 0) + 1
              return acc
            },
            {},
          ),
          diagnostics: retailDiagnostics(analysis.shifts),
          coverage: analysis.coverage,
          cashiers: analysis.cashiers.map((c) => ({
            name: names.get(c.cashier_id) || 'Без имени',
            shifts: c.shifts,
            score: c.score,
            status: c.status,
            strengths: c.strengths,
            weaknesses: c.weaknesses,
            bonus: monthlyBonus(c.status, settings).amount,
          })),
          bonus_paid: paid,
          roi: bonusRoi(analysis.shifts, paid, settings),
        },
      })

      return json({ data: { month, ai: result, ai_error: error } })
    }

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

    const { settings } = await loadStoreKpiSettings(supabase, companyId)

    const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? date
    const facts = await loadShiftFacts(supabase, { companyId, from: historyFrom, to: date })

    const baselineFacts = facts.filter((f) => f.date <= addDaysISO(date, -1))
    const targetFacts = facts.filter((f) => f.date === date && f.shift === shift)
    if (targetFacts.length === 0) return json({ error: 'shift-not-found' }, 404)

    const analysis = analyzeStoreKpi({ baselineFacts, targetFacts, settings })
    const shiftAnalysis = analysis.shifts[0]
    const explanation = explainShift(shiftAnalysis, settings)

    // Обстановка дня: погода в окне смены, праздники, учебные периоды.
    // Без неё модель объясняла провал, не зная, что шёл снег и были каникулы.
    const sources = await loadContextSources(
      supabase,
      companyId,
      String(company.organization_id),
      date,
      date,
    )
    const context = contextForShift(shiftAnalysis.fact, sources)

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
        expected_receipts: shiftAnalysis.expected_receipts,
        expected_avg_ticket: shiftAnalysis.expected_avg_ticket,
        receipts: shiftAnalysis.fact.receipts,
        items: shiftAnalysis.fact.items,
        refunds: Math.round(shiftAnalysis.fact.refunds),
        score: shiftAnalysis.score,
        confidence: shiftAnalysis.confidence,
        verdict: shiftAnalysis.verdict,
        season: shiftAnalysis.season,
        duration_minutes: shiftAnalysis.fact.duration_minutes,
      },
      // Контекст отдельно от фактов смены: он объясняет спрос, но не входит
      // в оценку продавца, и модель не должна их смешивать.
      context: {
        weather: context.weather
          ? {
              summary: context.weather.summary,
              kind: context.weather.label,
              window: context.weather.windowed ? context.weather.window_label : null,
            }
          : null,
        holidays: context.days.map((d) => `${d.name} (${d.type_label})`),
        academic: context.periods.map(
          (p) =>
            `${p.name} — ${p.type_label}${p.audience_label ? `, ${p.audience_label}` : ''}${
              p.confirmed ? '' : ' (не подтверждён)'
            }`,
        ),
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
