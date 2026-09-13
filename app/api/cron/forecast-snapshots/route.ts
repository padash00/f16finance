/**
 * Cron: фиксация месячных прогнозов и сверка с фактом (/analysis).
 *
 * Раз в сутки для каждой организации:
 *   1. если на начавшийся месяц прогноз ещё не зафиксирован — считает его по
 *      закрытым месяцам и сохраняет (вся организация + каждая точка). Прогноз
 *      после вставки заморожен триггером в базе;
 *   2. дописывает факт в прогнозы закрытых месяцев. Последние три закрытых
 *      месяца пересчитываются каждый раз: доходы прошлого месяца часто вносят
 *      задним числом, и факт должен это догнать.
 *
 * Расписание — 07:00 UTC, то есть 12:00 по Казахстану: 1-го числа к обеду
 * прошлый месяц уже внесён, а в прогноз идут только закрытые месяцы — продажи
 * начавшегося дня на него не влияют. Задача идемпотентна: повторный запуск
 * ничего не перезапишет.
 *
 * Запуск: GET /api/cron/forecast-snapshots с Authorization: Bearer ${CRON_SECRET}
 */

import { NextResponse } from 'next/server'

import {
  FORECAST_MODEL_VERSION,
  buildMonthPoints,
  learnForecast,
  monthTotals,
  shiftMonth,
} from '@/lib/analysis/forecast-learning'
import { describeError, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { verifyCronRequest } from '@/lib/server/cron-auth'
import { kzTodayISO, loadForecastInputs } from '@/lib/server/forecast-inputs'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const money = (v: number) => Math.round(v * 100) / 100

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return json({ error: 'unauthorized' }, 401)
  if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

  const supabase = createAdminSupabaseClient()
  const today = kzTodayISO()
  const currentMonth = today.slice(0, 7)
  const monthStart = `${currentMonth}-01`
  const dayOfMonth = Number(today.slice(8, 10))
  const report: Record<string, unknown>[] = []

  try {
    const { data: companies, error: companiesError } = await supabase
      .from('companies')
      .select('id, organization_id')
      .not('organization_id', 'is', null)
    if (companiesError) throw companiesError

    const byOrganization = new Map<string, string[]>()
    for (const row of (companies || []) as Array<{ id: string; organization_id: string }>) {
      const list = byOrganization.get(String(row.organization_id)) || []
      list.push(String(row.id))
      byOrganization.set(String(row.organization_id), list)
    }

    for (const [organizationId, companyIds] of byOrganization) {
      try {
        const inputs = await loadForecastInputs(supabase, {
          companyIds,
          organizationId,
          isSuperAdmin: false,
          to: today,
        })
        const rowsFor = (companyId: string | null) => ({
          incomes: companyId ? inputs.incomes.filter((r) => r.company_id === companyId) : inputs.incomes,
          expenses: companyId ? inputs.expenses.filter((r) => r.company_id === companyId) : inputs.expenses,
        })
        const scopes = [{ key: 'all', companyId: null as string | null }, ...companyIds.map((id) => ({ key: id, companyId: id }))]

        // ── 1. Фиксация прогноза на начавшийся месяц ─────────────────────────
        const { data: existing, error: existingError } = await supabase
          .from('forecast_snapshots')
          .select('scope_key')
          .eq('organization_id', organizationId)
          .eq('target_month', monthStart)
        if (existingError) throw existingError
        const frozen = new Set(((existing || []) as Array<{ scope_key: string }>).map((r) => String(r.scope_key)))

        const inserts: Record<string, unknown>[] = []
        for (const scope of scopes) {
          if (frozen.has(scope.key)) continue
          const { incomes, expenses } = rowsFor(scope.companyId)
          const points = buildMonthPoints(incomes, expenses, inputs.categoryGroups, currentMonth)
          if (!points.length) continue
          const learned = learnForecast(points, currentMonth)
          const s = learned.scenarios
          if (!s) continue
          inserts.push({
            organization_id: organizationId,
            scope_key: scope.key,
            company_id: scope.companyId,
            target_month: monthStart,
            model_version: FORECAST_MODEL_VERSION,
            income_pessimistic: money(s.pessimistic.income),
            income_realistic: money(s.realistic.income),
            income_optimistic: money(s.optimistic.income),
            expense_pessimistic: money(s.pessimistic.expense),
            expense_realistic: money(s.realistic.expense),
            expense_optimistic: money(s.optimistic.expense),
            profit_pessimistic: money(s.pessimistic.profit),
            profit_realistic: money(s.realistic.profit),
            profit_optimistic: money(s.optimistic.profit),
            details: {
              calibration: learned.calibration,
              accuracy: learned.accuracy,
              months_of_data: learned.monthsOfData,
              created_on_day: dayOfMonth,
              // Крон пропустил начало месяца — прогноз всё равно по закрытым месяцам, но честно помечаем
              late: dayOfMonth > 1,
            },
          })
        }
        if (inserts.length) {
          const { error: insertError } = await supabase
            .from('forecast_snapshots')
            .upsert(inserts, { onConflict: 'organization_id,scope_key,target_month', ignoreDuplicates: true })
          if (insertError) throw insertError
        }

        // ── 2. Сверка: факт закрытых месяцев ─────────────────────────────────
        const refreshFrom = `${shiftMonth(currentMonth, -3)}-01`
        const { data: toEvaluate, error: evaluateError } = await supabase
          .from('forecast_snapshots')
          .select('id, scope_key, company_id, target_month, evaluated_at')
          .eq('organization_id', organizationId)
          .lt('target_month', monthStart)
          .or(`evaluated_at.is.null,target_month.gte.${refreshFrom}`)
        if (evaluateError) throw evaluateError

        const totalsByScope = new Map<string, ReturnType<typeof monthTotals>>()
        let evaluated = 0
        for (const snap of (toEvaluate || []) as Array<Record<string, any>>) {
          const key = String(snap.scope_key)
          let totals = totalsByScope.get(key)
          if (!totals) {
            const { incomes, expenses } = rowsFor(snap.company_id ? String(snap.company_id) : null)
            totals = monthTotals(incomes, expenses, inputs.categoryGroups)
            totalsByScope.set(key, totals)
          }
          const fact = totals.get(String(snap.target_month).slice(0, 7)) ?? { income: 0, expense: 0 }
          const { error: updateError } = await supabase
            .from('forecast_snapshots')
            .update({
              actual_income: money(fact.income),
              actual_expense: money(fact.expense),
              actual_profit: money(fact.income - fact.expense),
              evaluated_at: snap.evaluated_at ?? new Date().toISOString(),
            })
            .eq('id', snap.id)
          if (updateError) throw updateError
          evaluated += 1
        }

        report.push({ organization_id: organizationId, frozen: inserts.length, evaluated })
      } catch (organizationError) {
        // Одна организация с проблемой не должна оставить остальных без фиксации
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'cron/forecast-snapshots organization',
          message: `${organizationId}: ${describeError(organizationError)}`,
        })
        report.push({ organization_id: organizationId, error: true })
      }
    }

    return json({ ok: true, date: today, organizations: report })
  } catch (error) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'cron/forecast-snapshots', message: describeError(error) })
    return json({ error: 'internal-error' }, 500)
  }
}
