/**
 * Качество данных, аномалии, деловые события и начисление месячного бонуса.
 *
 * Экран для того, чтобы модель не оценивала людей по мусору. Здесь видно,
 * насколько данные вообще готовы к выводам, какие смены выглядят
 * подозрительно и что мешало работать.
 *
 * Все пометки — решение человека. Детектор только предлагает: странная смена
 * вполне может быть настоящей, а исключение её из нормы меняет планку, по
 * которой потом оценивают живых людей.
 */
import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { awardMonthlyBonusToPayroll, voidMonthlyBonus } from '@/lib/server/store-kpi-payroll'
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
  cashierMixDeviations,
  categoryShares,
  dataQualityScore,
  detectAnomalies,
  monthlyBonus,
  retailDiagnostics,
  type CategorySalesRow,
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
    const from = url.searchParams.get('from') || `${today.slice(0, 4)}-01-01`
    const { settings } = await loadStoreKpiSettings(supabase, companyId)

    const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? from
    const facts = await loadShiftFacts(supabase, { companyId, from: historyFrom, to: today })

    const quality = dataQualityScore(facts, settings)
    // Детектор смотрит на весь период: дубли и выбросы важно видеть и в
    // старых данных — они формируют норму до сих пор.
    const anomalies = detectAnomalies(facts, settings)

    const periodFacts = facts.filter((f) => f.date >= from)
    const analysis = analyzeStoreKpi({
      baselineFacts: facts.filter((f) => f.date < from),
      targetFacts: periodFacts,
      settings,
    })
    const diagnostics = retailDiagnostics(analysis.shifts)

    // Структура продаж по категориям: в балл не входит, но часто объясняет
    // его. Считается за выбранный период, а не за всю историю.
    const { data: mixRows } = await supabase.rpc('store_kpi_category_mix', {
      p_company_id: companyId,
      p_from: from,
      p_to: today,
    })
    const mix = ((mixRows || []) as any[]).map(
      (r): CategorySalesRow => ({
        category_id: r.category_id ?? null,
        category_name: String(r.category_name || 'Без категории'),
        cashier_id: r.cashier_id ?? null,
        revenue: Number(r.revenue) || 0,
        quantity: Number(r.quantity) || 0,
        lines: Number(r.lines) || 0,
      }),
    )

    const { data: flags } = await supabase
      .from('store_kpi_shift_flags')
      .select('shift_date, shift, is_anomaly, exclude_from_baseline, reason, source')
      .eq('company_id', companyId)
      .order('shift_date', { ascending: false })
      .limit(200)

    const { data: events } = await supabase
      .from('store_kpi_business_events')
      .select('id, starts_on, ends_on, shift, event_type, title, severity, notes')
      .eq('company_id', companyId)
      .order('starts_on', { ascending: false })
      .limit(100)

    const { data: awards } = await supabase
      .from('store_kpi_bonus_awards')
      .select('cashier_id, kind, period_start, level, amount, salary_adjustment_id, voided_at')
      .eq('company_id', companyId)
      .eq('kind', 'monthly')
      .order('period_start', { ascending: false })
      .limit(50)

    // Месячный бонус считается, но не начисляется сам: начисление —
    // отдельное решение человека, оно уходит в зарплату.
    const monthly = analysis.cashiers.map((c) => ({
      cashier_id: c.cashier_id,
      status: c.status,
      score: c.score,
      shifts: c.shifts,
      ...monthlyBonus(c.status, settings),
    }))

    return json({
      data: {
        company_id: companyId,
        period: { from, to: today },
        quality,
        // Уже помеченные смены из списка предложений убираем: решение принято.
        anomalies: anomalies.filter(
          (a) => !(flags || []).some((f: any) => f.shift_date === a.date && f.shift === a.shift),
        ),
        flags: flags || [],
        events: events || [],
        diagnostics,
        category_mix: categoryShares(mix),
        cashier_mix: cashierMixDeviations(mix),
        monthly,
        awards: awards || [],
        settings: {
          monthly_bonus_strong: settings.monthly_bonus_strong,
          monthly_bonus_top: settings.monthly_bonus_top,
          shift_bonus_paid: settings.shift_bonus_paid,
        },
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/quality GET',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[sales-kpi/quality]', error)
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

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id, organization_id')
      .eq('id', companyId)
      .maybeSingle()
    if (companyErr) throw companyErr
    if (!company?.organization_id) return json({ error: 'company-without-organization' }, 400)

    const organizationId = String(company.organization_id)
    const actor = access.user?.id || null
    const action = String(body.action || '')

    // ── Пометить смену ────────────────────────────────────────────────────
    if (action === 'flag_shift') {
      const date = String(body.shift_date || '')
      const shift = body.shift === 'night' ? 'night' : 'day'
      const reason = String(body.reason || '').trim()
      if (!date) return json({ error: 'shift-date-required' }, 400)
      // Пометка меняет норму для всей команды — без причины её ставить нельзя.
      if (reason.length < 3) return json({ error: 'reason-required' }, 400)

      const { error } = await supabase.from('store_kpi_shift_flags').upsert(
        {
          organization_id: organizationId,
          company_id: companyId,
          shift_date: date,
          shift,
          is_anomaly: body.is_anomaly !== false,
          exclude_from_baseline: body.exclude_from_baseline === true,
          reason,
          source: 'manual',
          created_by: actor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id,shift_date,shift' },
      )
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_shift_flags',
        entityId: companyId,
        action: 'update',
        organizationId,
        payload: {
          company_id: companyId,
          shift_date: date,
          shift,
          exclude_from_baseline: body.exclude_from_baseline === true,
          reason,
        },
      })

      return json({ ok: true })
    }

    if (action === 'unflag_shift') {
      const date = String(body.shift_date || '')
      const shift = body.shift === 'night' ? 'night' : 'day'
      if (!date) return json({ error: 'shift-date-required' }, 400)

      const { error } = await supabase
        .from('store_kpi_shift_flags')
        .delete()
        .eq('company_id', companyId)
        .eq('shift_date', date)
        .eq('shift', shift)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_shift_flags',
        entityId: companyId,
        action: 'delete',
        organizationId,
        payload: { company_id: companyId, shift_date: date, shift },
      })

      return json({ ok: true })
    }

    // ── Деловое событие ───────────────────────────────────────────────────
    if (action === 'add_event') {
      const starts = String(body.starts_on || '')
      const ends = String(body.ends_on || starts)
      const title = String(body.title || '').trim()
      if (!starts || !title) return json({ error: 'event-invalid' }, 400)
      if (ends < starts) return json({ error: 'event-range-invalid' }, 400)

      const { error } = await supabase.from('store_kpi_business_events').insert({
        organization_id: organizationId,
        company_id: companyId,
        starts_on: starts,
        ends_on: ends,
        shift: body.shift === 'day' || body.shift === 'night' ? body.shift : null,
        event_type: String(body.event_type || 'CUSTOM'),
        title,
        notes: body.notes ? String(body.notes) : null,
        severity: ['low', 'medium', 'high'].includes(body.severity) ? body.severity : 'medium',
        created_by: actor,
      })
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_business_events',
        entityId: companyId,
        action: 'create',
        organizationId,
        payload: { company_id: companyId, starts, ends, title, event_type: body.event_type },
      })

      return json({ ok: true })
    }

    if (action === 'delete_event') {
      const id = String(body.event_id || '')
      if (!id) return json({ error: 'event-required' }, 400)

      // Событие ищется по id, поэтому принадлежность точке проверяем явно.
      const { data: row, error: rowErr } = await supabase
        .from('store_kpi_business_events')
        .select('id, company_id')
        .eq('id', id)
        .maybeSingle()
      if (rowErr) throw rowErr
      if (!row) return json({ error: 'not-found' }, 404)
      if (!inScope(scope, String(row.company_id))) {
        return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)
      }

      const { error } = await supabase.from('store_kpi_business_events').delete().eq('id', id)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_business_events',
        entityId: companyId,
        action: 'delete',
        organizationId,
        payload: { company_id: companyId, event_id: id },
      })

      return json({ ok: true })
    }

    // ── Начисление месячного бонуса ───────────────────────────────────────
    if (action === 'award_monthly') {
      const month = String(body.month || '')
      const cashierId = String(body.cashier_id || '')
      if (!/^\d{4}-\d{2}$/.test(month) || !cashierId) return json({ error: 'award-invalid' }, 400)

      const { settings } = await loadStoreKpiSettings(supabase, companyId)
      const status = String(body.status || '')
      const bonus = monthlyBonus(status as any, settings)

      /**
       * Разовая правка суммы.
       *
       * Обычная сумма зависит от статуса — это правило, к которому человек
       * может стремиться. Но бывает месяц, когда правило не описывает
       * происходящего, и владелец должен уметь заплатить иначе.
       *
       * Причина обязательна и уходит в журнал: сумма, отличающаяся от правила
       * без объяснения, через полгода выглядит ошибкой, а не решением.
       */
      const overrideRaw = body.amount
      const hasOverride = overrideRaw != null && overrideRaw !== ''
      const overrideAmount = Math.round(Number(overrideRaw))
      const overrideReason = String(body.override_reason || '').trim()

      if (hasOverride) {
        if (!Number.isFinite(overrideAmount) || overrideAmount < 0 || overrideAmount > 10_000_000) {
          return json({ error: 'amount-invalid' }, 400)
        }
        if (overrideAmount !== bonus.amount && overrideReason.length < 5) {
          return json({ error: 'override-reason-required' }, 400)
        }
      }

      const amount = hasOverride ? overrideAmount : bonus.amount
      // Платить за статус, которого мы не смогли определить, нельзя — но
      // если владелец назвал сумму сам, это его решение.
      if (amount <= 0) return json({ error: 'nothing-to-award' }, 400)

      const result = await awardMonthlyBonusToPayroll({
        supabase,
        organizationId,
        companyId,
        cashierId,
        month,
        amount,
        level: bonus.level,
        status,
        details: {
          status,
          score: body.score ?? null,
          shifts: body.shifts ?? null,
          by_rule: bonus.amount,
          overridden: hasOverride && amount !== bonus.amount,
          override_reason: hasOverride && amount !== bonus.amount ? overrideReason : null,
        },
        modelVersion: settings.model_version,
        actorUserId: actor,
      })

      if (!result.ok) return json({ error: result.error }, 400)
      return json({ ok: true, amount: result.amount, created: result.created })
    }

    // ── Отмена начисления ─────────────────────────────────────────────────
    if (action === 'void_monthly') {
      const month = String(body.month || '')
      const cashierId = String(body.cashier_id || '')
      const reason = String(body.reason || '').trim()
      if (!/^\d{4}-\d{2}$/.test(month) || !cashierId) return json({ error: 'award-invalid' }, 400)
      // Снятие денег у человека требует причины не меньше, чем начисление.
      if (reason.length < 5) return json({ error: 'reason-required' }, 400)

      const result = await voidMonthlyBonus({
        supabase,
        organizationId,
        companyId,
        cashierId,
        month,
        reason,
        actorUserId: actor,
      })
      if (!result.ok) return json({ error: result.error || 'void-failed' }, 400)
      return json({ ok: true })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/quality POST',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[sales-kpi/quality]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
