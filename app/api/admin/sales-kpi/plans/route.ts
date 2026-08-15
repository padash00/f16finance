/**
 * Планы смен и месячный индекс спроса.
 *
 * Главное правило модуля здесь: план объявляется ДО смены и после фиксации
 * автоматически не меняется. Если утром план был 90 000, а к вечеру поток
 * оказался лучше прогноза, поднять планку задним числом нельзя — человек
 * работал под ту цифру, которую ему назвали.
 *
 * Поэтому у плана два состояния. Незафиксированный пересчитывается свободно
 * (крон и кнопка «пересчитать»). Зафиксированный меняется только руками,
 * только с причиной, и правка уходит в журнал действий.
 */
import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  addDaysISO,
  earliestSaleDate,
  inScope,
  loadPriceIndex,
  loadShiftFacts,
  loadStoreKpiSettings,
  resolveStoreKpiContext,
  todayISO,
} from '@/lib/server/store-kpi'
import {
  buildReceiptsBaseline,
  buildRevenueBaseline,
  computeMonthlyIndex,
  computeShiftPlan,
  priceIndexFor,
  estimateWeatherEffects,
  weatherForShift,
  lookupBaseline,
  weatherFactor,
  WEATHER_BUCKET_LABELS,
  type ShiftFact,
  type ShiftPlan,
  type ShiftType,
  type HourlySeries,
  type WeatherObservation,
} from '@/lib/domain/store-kpi'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function monthStart(monthKeyValue: string): string {
  return `${monthKeyValue}-01`
}

function datesBetween(from: string, to: string, limit = 120): string[] {
  const out: string[] = []
  let cursor = from
  while (cursor <= to && out.length < limit) {
    out.push(cursor)
    cursor = addDaysISO(cursor, 1)
  }
  return out
}

/**
 * Какие смены вообще бывают на точке.
 *
 * Планировать ночную смену там, где её не бывает, — значит засорять экран
 * планами, которые никто не выполнит.
 */
function activeShifts(facts: ShiftFact[], since: string): ShiftType[] {
  const seen = new Set<ShiftType>()
  for (const f of facts) {
    if (f.date >= since) seen.add(f.shift)
  }
  if (seen.size === 0) return ['day']
  return [...seen].sort()
}

type WeatherRow = {
  day: string
  kind: string
  captured_on: string
  temperature_max: number | null
  temperature_min: number | null
  precipitation_mm: number | null
  rain: boolean | null
  snow: boolean | null
  hourly: HourlySeries | null
}

/**
 * Погода по дням.
 *
 * Для прошедших дней берём факт, для будущих — самый свежий прогноз. Прогнозы
 * хранятся снимками, поэтому «самый свежий» выбирается по `captured_on`, а не
 * перезаписывается — иначе мы потеряли бы возможность честно оценить, что
 * знали заранее.
 */
async function loadWeather(
  supabase: any,
  companyId: string,
  from: string,
  to: string,
): Promise<{ daily: Map<string, WeatherObservation>; hourly: Map<string, HourlySeries> }> {
  const out = new Map<string, WeatherObservation>()
  const hourly = new Map<string, HourlySeries>()
  const { data, error } = await supabase
    .from('store_kpi_weather')
    .select('day, kind, captured_on, temperature_max, temperature_min, precipitation_mm, rain, snow, hourly')
    .eq('company_id', companyId)
    .gte('day', from)
    .lte('day', to)
    .order('captured_on', { ascending: true })
  if (error) throw error

  const best = new Map<string, WeatherRow>()
  for (const row of (data || []) as WeatherRow[]) {
    const current = best.get(row.day)
    // Факт всегда важнее прогноза; среди прогнозов — самый поздний снимок.
    const better =
      !current ||
      (row.kind === 'actual' && current.kind !== 'actual') ||
      (row.kind === current.kind && row.captured_on >= current.captured_on)
    if (better) best.set(row.day, row)
  }

  for (const [day, row] of best) {
    out.set(day, {
      day,
      temperature_max: row.temperature_max,
      temperature_min: row.temperature_min,
      precipitation_mm: row.precipitation_mm,
      rain: row.rain,
      snow: row.snow,
    })
    if (row.hourly) hourly.set(day, row.hourly as HourlySeries)
  }
  return { daily: out, hourly }
}

async function loadCompanyOrg(supabase: any, companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('organization_id')
    .eq('id', companyId)
    .maybeSingle()
  if (error) throw error
  return data?.organization_id ? String(data.organization_id) : null
}

/** Месячные индексы точки за перечисленные месяцы. */
async function loadMonthlyIndices(
  supabase: any,
  companyId: string,
  months: string[],
): Promise<Map<string, MonthlyIndexRow>> {
  const out = new Map<string, MonthlyIndexRow>()
  if (months.length === 0) return out

  const { data, error } = await supabase
    .from('store_kpi_monthly_indices')
    // components — разбор по частям. Он и так хранится, но наружу не отдавался,
    // и владелец видел «цели выше на 9%» без единого слова о том, откуда 9%.
    .select('month, value, status, recommended, components, confidence, approval_reason, updated_at')
    .eq('company_id', companyId)
    .in('month', months.map(monthStart))
  if (error) throw error

  for (const row of data || []) {
    out.set(String(row.month).slice(0, 7), {
      value: Number(row.value) || 1,
      status: String(row.status || 'applied'),
      recommended: row.recommended == null ? null : Number(row.recommended),
      components: Array.isArray(row.components) ? row.components : [],
      confidence: row.confidence == null ? null : Number(row.confidence),
      approval_reason: row.approval_reason ?? null,
      updated_at: row.updated_at ?? null,
    })
  }
  return out
}

type MonthlyIndexRow = {
  value: number
  status: string
  recommended: number | null
  components: unknown[]
  confidence: number | null
  approval_reason: string | null
  updated_at: string | null
}

/** Индекс, который реально применяется: неподтверждённый в расчёт не идёт. */
function effectiveIndex(
  indices: Map<string, { value: number; status: string }>,
  month: string,
): number {
  const row = indices.get(month)
  if (!row) return 1
  return row.status === 'applied' ? row.value : 1
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
    const from = url.searchParams.get('from') || today
    const to = url.searchParams.get('to') || addDaysISO(today, 13)

    const { settings } = await loadStoreKpiSettings(supabase, companyId)

    // История для распределения выручки — строго ДО начала планируемого
    // периода: план не должен опираться на смены, которые ещё не случились.
    const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? from
    const historyTo = addDaysISO(from, -1)
    const facts =
      historyTo >= historyFrom
        ? await loadShiftFacts(supabase, { companyId, from: historyFrom, to: historyTo })
        : []

    const revenueBase = buildRevenueBaseline(facts, settings)
    const receiptsBase = buildReceiptsBaseline(facts, settings)
    // Пороги и ожидания объявляются в сегодняшних деньгах, хотя база хранится
    // в ценах базового месяца.
    const priceIndex = await loadPriceIndex(supabase, companyId, historyFrom, to)

    const dates = datesBetween(from, to)
    const months = [...new Set(dates.map(monthKey))]
    const indices = await loadMonthlyIndices(supabase, companyId, months)

    // ── Погода ────────────────────────────────────────────────────────────
    // Влияет ТОЛЬКО на ожидаемую выручку. Бонусные пороги считаются без неё:
    // продавец не отвечает за дождь и не должен терять из-за него деньги.
    const historyWeather =
      facts.length > 0
        ? await loadWeather(supabase, companyId, facts[0].date, historyTo)
        : { daily: new Map<string, WeatherObservation>(), hourly: new Map<string, HourlySeries>() }
    const upcomingWeather = await loadWeather(supabase, companyId, from, to)

    // Погода берётся в окне каждой смены: ночная смена не видела дневной жары,
    // и приписывать ей «жарко» значит объяснять её кассу тем, чего не было.
    const weatherObservations = facts
      .filter((f) => f.receipts > 0)
      .map((f) => {
        const expected = lookupBaseline(revenueBase, f, {
          minSample: settings.min_sample_size,
          summerMonths: settings.summer_months,
        })
        if (!expected) return null
        const { observation } = weatherForShift(f, historyWeather.hourly, historyWeather.daily)
        return { actual: f.revenue, expected: expected.value, weather: observation }
      })
      .filter(Boolean) as { actual: number; expected: number; weather: WeatherObservation | null }[]

    const weatherEffects = estimateWeatherEffects(weatherObservations, settings)

    const { data: savedRows, error: savedErr } = await supabase
      .from('store_kpi_shift_plans')
      .select('*')
      .eq('company_id', companyId)
      .gte('plan_date', from)
      .lte('plan_date', to)
      .order('plan_date')
    if (savedErr) throw savedErr

    const saved = new Map<string, any>()
    for (const row of savedRows || []) saved.set(`${row.plan_date}|${row.shift}`, row)

    const shifts = activeShifts(facts, addDaysISO(today, -60))

    const plans = dates.flatMap((date) =>
      shifts.map((shift) => {
        const key = `${date}|${shift}`
        const savedRow = saved.get(key)
        const index = effectiveIndex(indices, monthKey(date))
        // Плана ещё нет — фактического времени открытия тоже, поэтому окно
        // берётся типовое для дневной или ночной смены.
        const { observation: dayWeather, windowed } = weatherForShift(
          { date, shift },
          upcomingWeather.hourly,
          upcomingWeather.daily,
        )
        const weather = weatherFactor(dayWeather, weatherEffects)
        const weatherInfo = {
          bucket: weather.bucket,
          bucket_label: WEATHER_BUCKET_LABELS[weather.bucket],
          factor: weather.usable ? weather.factor : 1,
          usable: weather.usable,
          sample: weather.sample,
          temperature_max: dayWeather?.temperature_max ?? null,
          precipitation_mm: dayWeather?.precipitation_mm ?? null,
          known: Boolean(dayWeather),
          // false — погода взята за сутки целиком, потому что почасового ряда
          // на этот день нет.
          windowed,
        }

        if (savedRow) {
          return {
            date,
            shift,
            source: 'saved' as const,
            locked: Boolean(savedRow.locked_at),
            locked_at: savedRow.locked_at,
            override_reason: savedRow.override_reason,
            control: savedRow.control_amount,
            b1: savedRow.b1_amount,
            b2: savedRow.b2_amount,
            b3: savedRow.b3_amount,
            record_threshold: savedRow.record_threshold,
            expected_revenue: savedRow.expected_revenue,
            expected_receipts: savedRow.expected_receipts,
            monthly_index: Number(savedRow.monthly_index) || 1,
            baseline_level: savedRow.baseline_level,
            baseline_sample: savedRow.baseline_sample,
            weather: weatherInfo,
          }
        }

        const target = { company_id: companyId, date, shift } as ShiftFact
        const prices = priceIndexFor(priceIndex, date)
        const plan = computeShiftPlan(revenueBase, target, index, settings, prices)
        const expected = lookupBaseline(revenueBase, target, {
          minSample: settings.min_sample_size,
          summerMonths: settings.summer_months,
        })
        const expectedReceipts = lookupBaseline(receiptsBase, target, {
          minSample: settings.min_sample_size,
          summerMonths: settings.summer_months,
        })

        return {
          date,
          shift,
          source: 'preview' as const,
          locked: false,
          locked_at: null,
          override_reason: null,
          control: plan?.control ?? null,
          b1: plan?.b1 ?? null,
          b2: plan?.b2 ?? null,
          b3: plan?.b3 ?? null,
          record_threshold: plan?.record_threshold ?? null,
          // Прогноз показывается рядом с планом, но планом не является — и
          // только он поправляется погодой. Уровни выше остались нетронутыми.
          expected_revenue: expected ? Math.round(expected.value * prices * weatherInfo.factor) : null,
          expected_receipts: expectedReceipts ? Math.round(expectedReceipts.value * weatherInfo.factor) : null,
          monthly_index: index,
          baseline_level: plan?.level ?? null,
          baseline_sample: plan?.sample ?? 0,
          weather: weatherInfo,
        }
      }),
    )

    return json({
      data: {
        company_id: companyId,
        period: { from, to },
        shifts,
        plans,
        monthly: months.map((m) => ({
          month: m,
          value: indices.get(m)?.value ?? null,
          status: indices.get(m)?.status ?? null,
          recommended: indices.get(m)?.recommended ?? null,
          components: indices.get(m)?.components ?? [],
          confidence: indices.get(m)?.confidence ?? null,
          approval_reason: indices.get(m)?.approval_reason ?? null,
          updated_at: indices.get(m)?.updated_at ?? null,
          effective: effectiveIndex(indices, m),
        })),
        settings: {
          rounding_step: settings.rounding_step,
          b1_amount: settings.b1_amount,
          b2_amount: settings.b2_amount,
          b3_amount: settings.b3_amount,
          record_amount: settings.record_amount,
          min_sample_size: settings.min_sample_size,
          monthly_index_min: settings.monthly_index_min,
          monthly_index_max: settings.monthly_index_max,
          auto_adjust_max_delta: settings.auto_adjust_max_delta,
          plan_lock_days_ahead: settings.plan_lock_days_ahead,
        },
        model_version: settings.model_version,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/plans GET',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[sales-kpi/plans]', error)
    return json({ error: 'internal-error' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveStoreKpiContext(request, 'sales-kpi.manage', json)
    if ('response' in ctx) return ctx.response
    const { supabase, scope, access } = ctx

    const body = (await request.json().catch(() => ({}))) as Record<string, any>
    const companyId = String(body.company_id || '')
    if (!companyId) return json({ error: 'company-required' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    const organizationId = await loadCompanyOrg(supabase, companyId)
    if (!organizationId) return json({ error: 'company-without-organization' }, 400)

    const action = String(body.action || '')
    const { settings } = await loadStoreKpiSettings(supabase, companyId)
    const actor = access.user?.id || null
    const today = todayISO()

    // ── Пересчёт и фиксация планов ────────────────────────────────────────
    if (action === 'generate') {
      const from = String(body.from || today)
      const to = String(body.to || addDaysISO(today, settings.plan_lock_days_ahead))
      const lock = Boolean(body.lock)

      const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? from
      const historyTo = addDaysISO(from, -1)
      const facts =
        historyTo >= historyFrom
          ? await loadShiftFacts(supabase, { companyId, from: historyFrom, to: historyTo })
          : []

      const revenueBase = buildRevenueBaseline(facts, settings)
      const receiptsBase = buildReceiptsBaseline(facts, settings)
      const priceIndex = await loadPriceIndex(supabase, companyId, historyFrom, to)
      const dates = datesBetween(from, to)
      const indices = await loadMonthlyIndices(supabase, companyId, [...new Set(dates.map(monthKey))])
      const shifts = activeShifts(facts, addDaysISO(today, -60))

      const { data: existing } = await supabase
        .from('store_kpi_shift_plans')
        .select('plan_date, shift, locked_at')
        .eq('company_id', companyId)
        .gte('plan_date', from)
        .lte('plan_date', to)
      const lockedKeys = new Set(
        (existing || []).filter((r: any) => r.locked_at).map((r: any) => `${r.plan_date}|${r.shift}`),
      )

      const rows: Record<string, unknown>[] = []
      let skippedLocked = 0
      let skippedThin = 0

      for (const date of dates) {
        for (const shift of shifts) {
          // Зафиксированный план не трогаем: это и есть защита обещания,
          // данного продавцу.
          if (lockedKeys.has(`${date}|${shift}`)) {
            skippedLocked += 1
            continue
          }

          const target = { company_id: companyId, date, shift } as ShiftFact
          const index = effectiveIndex(indices, monthKey(date))
          const prices = priceIndexFor(priceIndex, date)
          const plan: ShiftPlan | null = computeShiftPlan(revenueBase, target, index, settings, prices)
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
            expected_revenue: expected ? Math.round(expected.value * prices) : null,
            expected_receipts: expectedReceipts ? Math.round(expectedReceipts.value) : null,
            monthly_index: plan.monthly_index,
            baseline_level: plan.level,
            baseline_sample: plan.sample,
            locked_at: lock ? new Date().toISOString() : null,
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

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_shift_plans',
        entityId: companyId,
        action: lock ? 'lock' : 'update',
        organizationId,
        payload: { company_id: companyId, from, to, saved: rows.length, skipped_locked: skippedLocked },
      })

      return json({
        ok: true,
        saved: rows.length,
        skipped_locked: skippedLocked,
        skipped_no_history: skippedThin,
      })
    }

    // ── Фиксация одного плана ─────────────────────────────────────────────
    if (action === 'lock') {
      const date = String(body.plan_date || '')
      const shift = body.shift === 'night' ? 'night' : 'day'
      if (!date) return json({ error: 'plan-date-required' }, 400)

      const { error } = await supabase
        .from('store_kpi_shift_plans')
        .update({ locked_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('plan_date', date)
        .eq('shift', shift)
        .is('locked_at', null)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_shift_plans',
        entityId: companyId,
        action: 'lock',
        organizationId,
        payload: { company_id: companyId, plan_date: date, shift },
      })

      return json({ ok: true })
    }

    // ── Ручная правка плана ───────────────────────────────────────────────
    if (action === 'override') {
      const date = String(body.plan_date || '')
      const shift = body.shift === 'night' ? 'night' : 'day'
      const reason = String(body.reason || '').trim()
      if (!date) return json({ error: 'plan-date-required' }, 400)
      // Причина обязательна: правка планки после фиксации — это изменение
      // условий, под которые человек уже вышел работать.
      if (reason.length < 5) return json({ error: 'reason-required' }, 400)

      const levels = ['control', 'b1', 'b2', 'b3'].map((k) => Math.round(Number(body[k])))
      if (levels.some((v) => !Number.isFinite(v) || v < 0)) return json({ error: 'levels-invalid' }, 400)
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] <= levels[i - 1]) return json({ error: 'levels-not-increasing' }, 400)
      }

      const { data: before, error: beforeErr } = await supabase
        .from('store_kpi_shift_plans')
        .select('*')
        .eq('company_id', companyId)
        .eq('plan_date', date)
        .eq('shift', shift)
        .maybeSingle()
      if (beforeErr) throw beforeErr
      if (!before) return json({ error: 'plan-not-found' }, 404)

      const now = new Date().toISOString()
      const { error } = await supabase
        .from('store_kpi_shift_plans')
        .update({
          control_amount: levels[0],
          b1_amount: levels[1],
          b2_amount: levels[2],
          b3_amount: levels[3],
          override_reason: reason,
          overridden_by: actor,
          overridden_at: now,
          updated_at: now,
        })
        .eq('id', before.id)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_shift_plans',
        entityId: companyId,
        action: 'override',
        organizationId,
        payload: {
          company_id: companyId,
          plan_date: date,
          shift,
          reason,
          before: {
            control: before.control_amount,
            b1: before.b1_amount,
            b2: before.b2_amount,
            b3: before.b3_amount,
          },
          after: { control: levels[0], b1: levels[1], b2: levels[2], b3: levels[3] },
        },
      })

      return json({ ok: true })
    }

    // ── Месячный индекс ───────────────────────────────────────────────────
    if (action === 'recompute_monthly_index' || action === 'set_monthly_index') {
      const month = String(body.month || monthKey(today))
      if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'month-invalid' }, 400)

      const { data: prevRows } = await supabase
        .from('store_kpi_monthly_indices')
        .select('month, value')
        .eq('company_id', companyId)
        .lt('month', monthStart(month))
        .order('month', { ascending: false })
        .limit(1)
      const previousIndex = prevRows?.[0]?.value != null ? Number(prevRows[0].value) : null

      // Ручная установка: значение задаёт человек, но границы всё равно
      // действуют — иначе ограничение обходится вводом любого числа.
      if (action === 'set_monthly_index') {
        const value = Number(body.value)
        const reason = String(body.reason || '').trim()
        if (!Number.isFinite(value)) return json({ error: 'value-invalid' }, 400)
        if (value < settings.monthly_index_min || value > settings.monthly_index_max) {
          return json({ error: 'value-out-of-bounds' }, 400)
        }
        if (reason.length < 5) return json({ error: 'reason-required' }, 400)

        const { error } = await supabase.from('store_kpi_monthly_indices').upsert(
          {
            organization_id: organizationId,
            company_id: companyId,
            month: monthStart(month),
            value: Math.round(value * 100) / 100,
            status: 'applied',
            source: 'manual',
            override_reason: reason,
            approved_by: actor,
            approved_at: new Date().toISOString(),
            model_version: settings.model_version,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'company_id,month' },
        )
        if (error) throw error

        await writeAuditLog(supabase, {
          actorUserId: actor,
          entityType: 'store_kpi_monthly_indices',
          entityId: companyId,
          action: 'override',
          organizationId,
          payload: { company_id: companyId, month, value, previous: previousIndex, reason },
        })

        return json({ ok: true, value })
      }

      // Автоматический расчёт.
      const asOf = String(body.as_of || today)
      const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? asOf
      const facts = await loadShiftFacts(supabase, {
        companyId,
        from: historyFrom,
        to: addDaysISO(asOf, -1),
      })

      // Тренд: факт против ожидания по сопоставимым сменам. Ожидание берём из
      // истории ДО последних 30 дней, чтобы окно тренда не сравнивалось само
      // с собой.
      const trendCutoff = addDaysISO(asOf, -30)
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
          .select('start_date, end_date, manual_index, is_confirmed')
          .eq('organization_id', organizationId)
          .eq('is_confirmed', true),
        supabase
          .from('store_kpi_calendar_days')
          .select('day, impact_index, company_id')
          .eq('organization_id', organizationId),
      ])

      const result = computeMonthlyIndex({
        targetMonth: month,
        asOf,
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

      // Большое изменение не применяется само: оно ложится в очередь на
      // подтверждение, а до подтверждения в расчёт планов идёт 1.00.
      const status = result.approval_required ? 'pending_approval' : 'applied'

      const { error } = await supabase.from('store_kpi_monthly_indices').upsert(
        {
          organization_id: organizationId,
          company_id: companyId,
          month: monthStart(month),
          value: result.value,
          recommended: result.recommended,
          components: result.components,
          confidence: result.confidence,
          status,
          source: 'auto',
          approval_reason: result.approval_reason,
          model_version: settings.model_version,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id,month' },
      )
      if (error) throw error

      return json({ ok: true, data: { ...result, status, month, previous: previousIndex } })
    }

    if (action === 'approve_monthly_index') {
      const month = String(body.month || '')
      if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'month-invalid' }, 400)

      const { data: row, error: rowErr } = await supabase
        .from('store_kpi_monthly_indices')
        .select('*')
        .eq('company_id', companyId)
        .eq('month', monthStart(month))
        .maybeSingle()
      if (rowErr) throw rowErr
      if (!row) return json({ error: 'index-not-found' }, 404)

      const { error } = await supabase
        .from('store_kpi_monthly_indices')
        .update({
          status: 'applied',
          approved_by: actor,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_monthly_indices',
        entityId: companyId,
        action: 'approve',
        organizationId,
        payload: { company_id: companyId, month, value: row.value, recommended: row.recommended },
      })

      return json({ ok: true })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/plans POST',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[sales-kpi/plans]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
