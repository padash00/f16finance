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
import { listStorePoints, resolveStoreKpiContext, inScope } from '@/lib/server/store-kpi'
import { buildStoreKpiReport } from '@/lib/server/store-kpi-report'

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

    const report = await buildStoreKpiReport(supabase, {
      companyId: company.id,
      organizationId: company.organization_id ?? null,
      from,
      to,
      // Вероятностный прогноз считается рядом с рабочим разбором и ничего в
      // нём не меняет. Экрану он нужен, поэтому здесь включён.
      withProbability: true,
    })

    const { settings } = report

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
          configured: report.settingsConfigured,
        },
        coverage: report.coverage,
        totals: report.totals,
        shifts: report.shifts,
        cashiers: report.cashiers,
        model_version: report.model_version,
        // Новое поле, старые не тронуты: страница и выгрузки, которые о нём
        // не знают, продолжают работать ровно как раньше.
        probabilistic_forecast: report.probabilistic,
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
