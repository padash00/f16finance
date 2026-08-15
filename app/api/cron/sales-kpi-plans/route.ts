/**
 * Cron: планы смен магазина.
 *
 * Раз в сутки, до начала смен:
 *   1. считает планы на ближайшие дни для каждой точки с настроенным модулем;
 *   2. фиксирует завтрашний план — после фиксации он уже не пересчитывается.
 *
 * Фиксация и есть смысл этой задачи. План, который считается в момент
 * открытия страницы, зависит от того, когда на неё зашли, — а продавец должен
 * знать свою планку заранее и одну и ту же.
 *
 * В конце месяца дополнительно пересчитывает месячный индекс на следующий
 * месяц. Большое изменение не применяется само — оно уходит в очередь на
 * подтверждение владельцем, а до подтверждения планы считаются по 1.00.
 *
 * Расписание — 15:00 UTC, то есть 20:00 по Казахстану: план на завтра
 * фиксируется вечером накануне, задолго до открытия дневной смены.
 *
 * Запуск: GET /api/cron/sales-kpi-plans с Authorization: Bearer ${CRON_SECRET}
 */

import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { verifyCronRequest } from '@/lib/server/cron-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import {
  addDaysISO,
  earliestSaleDate,
  loadShiftFacts,
  todayISO,
} from '@/lib/server/store-kpi'
import {
  buildReceiptsBaseline,
  buildRevenueBaseline,
  computeMonthlyIndex,
  computeShiftPlan,
  lookupBaseline,
  normalizeStoreKpiSettings,
  type ShiftFact,
  type ShiftType,
} from '@/lib/domain/store-kpi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

function nextMonthKey(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const dt = new Date(y || 1970, (m || 1) - 1 + 1, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  let cursor = from
  while (cursor <= to && out.length < 60) {
    out.push(cursor)
    cursor = addDaysISO(cursor, 1)
  }
  return out
}

function activeShifts(facts: ShiftFact[], since: string): ShiftType[] {
  const seen = new Set<ShiftType>()
  for (const f of facts) if (f.date >= since) seen.add(f.shift)
  return seen.size ? ([...seen].sort() as ShiftType[]) : ['day']
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const tomorrow = addDaysISO(today, 1)

  const report: Record<string, unknown>[] = []

  try {
    // Модуль работает только там, где он настроен: без строки настроек точка
    // не знает своей точки-клуба, и планы для неё считать рано.
    const { data: settingsRows, error: settingsErr } = await supabase
      .from('store_kpi_settings')
      .select('*')
    if (settingsErr) throw settingsErr

    for (const row of settingsRows || []) {
      const companyId = String(row.company_id)
      const organizationId = row.organization_id ? String(row.organization_id) : null
      if (!organizationId) continue

      const settings = normalizeStoreKpiSettings(row)

      try {
        const planTo = addDaysISO(today, settings.plan_lock_days_ahead)

        const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? today
        const facts = await loadShiftFacts(supabase, {
          companyId,
          from: historyFrom,
          to: addDaysISO(tomorrow, -1),
        })

        const revenueBase = buildRevenueBaseline(facts, settings)
        const receiptsBase = buildReceiptsBaseline(facts, settings)
        const shifts = activeShifts(facts, addDaysISO(today, -60))

        // Индексы месяцев, попадающих в горизонт планирования.
        const months = [...new Set(datesBetween(tomorrow, planTo).map(monthKeyOf))]
        const { data: indexRows } = await supabase
          .from('store_kpi_monthly_indices')
          .select('month, value, status')
          .eq('company_id', companyId)
          .in('month', months.map((m) => `${m}-01`))
        const indexByMonth = new Map<string, number>()
        for (const idx of indexRows || []) {
          // Неподтверждённый индекс в расчёт не идёт.
          if (String(idx.status) !== 'applied') continue
          indexByMonth.set(String(idx.month).slice(0, 7), Number(idx.value) || 1)
        }

        const { data: existing } = await supabase
          .from('store_kpi_shift_plans')
          .select('plan_date, shift, locked_at')
          .eq('company_id', companyId)
          .gte('plan_date', tomorrow)
          .lte('plan_date', planTo)
        const lockedKeys = new Set(
          (existing || []).filter((r: any) => r.locked_at).map((r: any) => `${r.plan_date}|${r.shift}`),
        )

        const rows: Record<string, unknown>[] = []
        let locked = 0
        let skippedThin = 0

        for (const date of datesBetween(tomorrow, planTo)) {
          for (const shift of shifts) {
            if (lockedKeys.has(`${date}|${shift}`)) continue

            const target = { company_id: companyId, date, shift } as ShiftFact
            const index = indexByMonth.get(monthKeyOf(date)) ?? 1
            const plan = computeShiftPlan(revenueBase, target, index, settings)
            if (!plan) {
              skippedThin += 1
              continue
            }

            const expected = lookupBaseline(revenueBase, target, {
              minSample: settings.min_sample_size,
              summerMonths: settings.summer_months,
            })
            const expectedReceipts = lookupBaseline(receiptsBase, target, {
              minSample: settings.min_sample_size,
              summerMonths: settings.summer_months,
            })

            // Фиксируем только завтрашний день: он начнётся раньше, чем крон
            // отработает снова. Дальние дни остаются пересчитываемыми, пока
            // история не устаканится.
            const shouldLock = date === tomorrow
            if (shouldLock) locked += 1

            rows.push({
              organization_id: organizationId,
              company_id: companyId,
              plan_date: date,
              shift,
              control_amount: plan.control,
              b1_amount: plan.b1,
              b2_amount: plan.b2,
              b3_amount: plan.b3,
              record_threshold: plan.record_threshold,
              expected_revenue: expected ? Math.round(expected.value) : null,
              expected_receipts: expectedReceipts ? Math.round(expectedReceipts.value) : null,
              monthly_index: plan.monthly_index,
              baseline_level: plan.level,
              baseline_sample: plan.sample,
              locked_at: shouldLock ? new Date().toISOString() : null,
              model_version: settings.model_version,
              updated_at: new Date().toISOString(),
            })
          }
        }

        if (rows.length) {
          const { error } = await supabase
            .from('store_kpi_shift_plans')
            .upsert(rows, { onConflict: 'company_id,plan_date,shift' })
          if (error) throw error
        }

        // ── Месячный индекс на следующий месяц ──────────────────────────
        let monthly: Record<string, unknown> | null = null
        const dayOfMonth = Number(today.slice(8, 10))
        if (dayOfMonth >= 25) {
          const targetMonth = nextMonthKey(today)
          const { data: prevRows } = await supabase
            .from('store_kpi_monthly_indices')
            .select('value')
            .eq('company_id', companyId)
            .lt('month', `${targetMonth}-01`)
            .order('month', { ascending: false })
            .limit(1)
          const previousIndex = prevRows?.[0]?.value != null ? Number(prevRows[0].value) : null

          const trendCutoff = addDaysISO(today, -30)
          const trendBase = buildRevenueBaseline(
            facts.filter((f) => f.date < trendCutoff),
            settings,
          )
          const trend = facts
            .filter((f) => f.date >= trendCutoff && f.receipts > 0)
            .map((f) => {
              const expected = lookupBaseline(trendBase, f, {
                minSample: settings.min_sample_size,
                summerMonths: settings.summer_months,
              })
              return expected ? { date: f.date, actual: f.revenue, expected: expected.value } : null
            })
            .filter(Boolean) as { date: string; actual: number; expected: number }[]

          const [{ data: periods }, { data: days }] = await Promise.all([
            supabase
              .from('store_kpi_academic_periods')
              .select('start_date, end_date, manual_index')
              .eq('organization_id', organizationId)
              .eq('is_confirmed', true),
            supabase
              .from('store_kpi_calendar_days')
              .select('day, impact_index, company_id')
              .eq('organization_id', organizationId),
          ])

          const result = computeMonthlyIndex({
            targetMonth,
            asOf: today,
            history: facts,
            trend,
            academicPeriods: (periods || []).map((p: any) => ({
              start_date: String(p.start_date),
              end_date: String(p.end_date),
              index: Number(p.manual_index) || 1,
            })),
            specialDays: (days || [])
              .filter((d: any) => !d.company_id || d.company_id === companyId)
              .map((d: any) => ({ date: String(d.day), impact_index: Number(d.impact_index) || 1 })),
            previousIndex,
            settings,
          })

          const { error: idxErr } = await supabase.from('store_kpi_monthly_indices').upsert(
            {
              organization_id: organizationId,
              company_id: companyId,
              month: `${targetMonth}-01`,
              value: result.value,
              recommended: result.recommended,
              components: result.components,
              confidence: result.confidence,
              status: result.approval_required ? 'pending_approval' : 'applied',
              source: 'auto',
              approval_reason: result.approval_reason,
              model_version: settings.model_version,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'company_id,month' },
          )
          if (idxErr) throw idxErr

          monthly = {
            month: targetMonth,
            value: result.value,
            approval_required: result.approval_required,
            confidence: result.confidence,
          }
        }

        if (rows.length || monthly) {
          await writeAuditLog(supabase, {
            actorUserId: null,
            entityType: 'store_kpi_shift_plans',
            entityId: companyId,
            action: 'lock',
            organizationId,
            payload: { company_id: companyId, planned: rows.length, locked, monthly },
          })
        }

        report.push({
          company_id: companyId,
          planned: rows.length,
          locked,
          skipped_no_history: skippedThin,
          monthly,
        })
      } catch (companyError) {
        // Одна сломанная точка не должна оставить без планов остальные.
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'cron/sales-kpi-plans company',
          message: `${companyId}: ${companyError instanceof Error ? companyError.message : String(companyError)}`,
        })
        report.push({ company_id: companyId, error: true })
      }
    }

    return json({ ok: true, date: today, companies: report })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'cron/sales-kpi-plans',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[cron/sales-kpi-plans]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
