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
import {
  confidenceRu,
  metricRu,
  runCashierReview,
  runMonthlyReview,
  runPostShiftReview,
  scoreRu,
  statusRu,
  verdictRu,
  verdictsRu,
} from '@/lib/server/store-kpi-ai'
import { contextForShift, loadContextSources } from '@/lib/server/store-kpi-context'
import { buildProbabilisticLayer } from '@/lib/server/store-kpi-probability'
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
        // Всё по-русски: модель печатает то, что видит, и код STRONG_CASHIER
        // из входных данных ушёл бы прямо в текст владельцу.
        cashier: {
          имя: target.name,
          смен: target.shifts,
          чеков: target.receipts,
          выручка: target.revenue,
          как_отработал: scoreRu(target.score),
          статус: statusRu(target.status),
          можно_ли_доверять: confidenceRu(target.confidence),
          метрики: Object.fromEntries(
            Object.entries(target.metric_ratios || {})
              .filter(([, r]) => r != null)
              .map(([m, r]) => [metricRu(m), scoreRu(r)]),
          ),
          сильные_стороны: (target.strengths || []).map(metricRu),
          стоит_подтянуть: (target.weaknesses || []).map(metricRu),
          смены_по_выводам: verdictsRu(target.verdicts),
          рекомендуется_обучение: target.training_flag,
          причина: target.training_reason,
        },
        shifts: mine.map((s: any) => ({
          дата: s.date,
          смена: s.shift === 'night' ? 'ночь' : 'день',
          вывод: verdictRu(s.verdict),
          как_отработал: scoreRu(s.score),
          можно_ли_доверять: confidenceRu(s.confidence),
          касса: s.revenue,
          обычно_касса: s.expected_revenue,
          покупателей: s.receipts,
          обычно_покупателей: s.expected_receipts,
          // Обстановка нужна, чтобы модель не приняла снежный вечер за
          // слабую работу человека.
          погода: s.context?.weather?.label ?? null,
          праздники: (s.context?.days || []).map((d: any) => d.name),
          учёба: (s.context?.periods || []).map((p: any) => p.name),
        })),
        peers: report.cashiers
          .filter((c: any) => c.cashier_id !== cashierId)
          .map((c: any) => ({
            имя: c.name,
            как_отработал: scoreRu(c.score),
            статус: statusRu(c.status),
            смен: c.shifts,
          })),
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
          смен: analysis.shifts.length,
          смены_по_выводам: verdictsRu(
            analysis.shifts.reduce(
              (acc: Record<string, number>, s) => {
                acc[s.verdict] = (acc[s.verdict] || 0) + 1
                return acc
              },
              {},
            ),
          ),
          диагностика: retailDiagnostics(analysis.shifts),
          охват_данных: analysis.coverage,
          продавцы: analysis.cashiers.map((c) => ({
            имя: names.get(c.cashier_id) || 'Без имени',
            смен: c.shifts,
            как_отработал: scoreRu(c.score),
            статус: statusRu(c.status),
            сильные_стороны: (c.strengths || []).map(metricRu),
            стоит_подтянуть: (c.weaknesses || []).map(metricRu),
            доплата: monthlyBonus(c.status, settings).amount,
          })),
          доплат_начислено: paid,
          окупаемость: bonusRoi(analysis.shifts, paid, settings),
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

    // Вероятностный прогноз, посчитанный детерминированно. Модель получает
    // готовые числа и только пересказывает их человеческим языком: считать
    // вероятности сама она не имеет права, и в промпте это прямо запрещено.
    let probability: { спрос: string; допродажи: string } | null = null
    try {
      const layer = buildProbabilisticLayer({
        baselineFacts,
        targetFacts,
        settings,
        receipts: [],
        plans: new Map(),
      })
      const row = layer.shifts[0]
      if (row?.demand) {
        const percent = row.fact_percentile === null ? null : Math.round(row.fact_percentile * 100)
        probability = {
          спрос:
            `ожидалось ${Math.round(row.demand.expectedReceipts)} чеков, обычные границы ` +
            `${Math.round(row.demand.interval80.low)}–${Math.round(row.demand.interval80.high)}` +
            (percent === null
              ? ''
              : percent <= 15
                ? `; фактический поток в нижних ${percent}% ожидаемого`
                : percent >= 85
                  ? `; фактический поток в верхних ${100 - percent}% ожидаемого`
                  : '; фактический поток в обычных границах'),
          допродажи:
            row.attach && row.attach.observedRate !== null
              ? row.attach.opportunities < 15
                ? `чеков за смену всего ${row.attach.opportunities} — отличить работу продавца от везения нельзя`
                : `вероятность, что продавец действительно выше нормы, ${Math.round(row.attach.probabilityAboveBaseline * 100)}%`
              : 'нет данных',
        }
      }
    } catch {
      // Теневая модель молчит, если не посчиталась: разбор важнее её.
      probability = null
    }

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
        касса: Math.round(shiftAnalysis.fact.revenue),
        обычно_касса: shiftAnalysis.expected_revenue,
        покупателей: shiftAnalysis.fact.receipts,
        обычно_покупателей: shiftAnalysis.expected_receipts,
        обычно_средний_чек: shiftAnalysis.expected_avg_ticket,
        товаров: shiftAnalysis.fact.items,
        возвраты: Math.round(shiftAnalysis.fact.refunds),
        как_отработал: scoreRu(shiftAnalysis.score),
        можно_ли_доверять: confidenceRu(shiftAnalysis.confidence),
        вывод: verdictRu(shiftAnalysis.verdict),
        сезон: shiftAnalysis.season === 'summer' ? 'лето' : 'учебный сезон',
        длительность_минут: shiftAnalysis.fact.duration_minutes,
        ...(probability
          ? { прогноз_спроса: probability.спрос, уверенность_в_допродажах: probability.допродажи }
          : {}),
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
