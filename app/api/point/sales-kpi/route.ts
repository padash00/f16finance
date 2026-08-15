/**
 * План смены для кассы.
 *
 * То, что продавец должен видеть у себя на экране: три уровня, текущая касса
 * и сколько осталось до следующего. Ничего из внутренней математики модели
 * сюда не уходит — ни баллов, ни весов, ни перцентилей. Человеку нужна цель,
 * а не устройство формулы.
 *
 * Отдаётся только зафиксированный или сохранённый план: показывать кассиру
 * цифру, которая пересчитается к вечеру, — то же самое, что не иметь плана.
 *
 * Авторизация — токеном устройства точки, как во всех `/api/point/*`.
 */
import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { normalizeStoreKpiSettings, resolveBonus, type ShiftPlan } from '@/lib/domain/store-kpi'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const companyId = device.company_id
    if (!companyId) return json({ data: { available: false, reason: 'no-company' } })

    const url = new URL(request.url)
    const date = url.searchParams.get('date') || todayISO()
    const shift = url.searchParams.get('shift') === 'night' ? 'night' : 'day'

    const { data: planRow, error: planErr } = await supabase
      .from('store_kpi_shift_plans')
      .select('*')
      .eq('company_id', companyId)
      .eq('plan_date', date)
      .eq('shift', shift)
      .maybeSingle()
    if (planErr) throw planErr

    if (!planRow) {
      return json({ data: { available: false, reason: 'no-plan', date, shift } })
    }

    const { data: settingsRow, error: settingsErr } = await supabase
      .from('store_kpi_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle()
    if (settingsErr) throw settingsErr
    const settings = normalizeStoreKpiSettings(settingsRow)

    // Текущая касса смены: продажи минус возвраты.
    const [{ data: sales }, { data: returns }] = await Promise.all([
      supabase
        .from('point_sales')
        .select('total_amount, operator_id')
        .eq('company_id', companyId)
        .eq('sale_date', date)
        .eq('shift', shift),
      supabase
        .from('point_returns')
        .select('total_amount')
        .eq('company_id', companyId)
        .eq('return_date', date)
        .eq('shift', shift),
    ])

    const gross = (sales || []).reduce((sum: number, r: any) => sum + Number(r.total_amount || 0), 0)
    const refunds = (returns || []).reduce((sum: number, r: any) => sum + Number(r.total_amount || 0), 0)
    const revenue = Math.round(gross - refunds)

    const plan: ShiftPlan = {
      control: Number(planRow.control_amount),
      b1: Number(planRow.b1_amount),
      b2: Number(planRow.b2_amount),
      b3: Number(planRow.b3_amount),
      record_threshold: planRow.record_threshold == null ? null : Number(planRow.record_threshold),
      monthly_index: Number(planRow.monthly_index) || 1,
      level: 'all',
      sample: Number(planRow.baseline_sample) || 0,
    }

    // Ворота по знанию товара: верхние уровни открываются сданным тестом.
    // Пока ворота выключены, тест не запрашиваем вовсе — лишний запрос на
    // каждое обновление экрана кассы ни к чему.
    let productTestPassed: boolean | null = null
    if (settings.require_product_test_for_top_bonus) {
      const cashierId = (sales || []).map((s: any) => s.operator_id).find(Boolean) || null
      if (cashierId) {
        const validFrom = new Date(Date.now() - settings.product_test_valid_days * 86_400_000).toISOString()
        const { data: attempts } = await supabase
          .from('operator_exam_attempts')
          .select('passed, score, completed_at')
          .eq('operator_id', cashierId)
          .eq('status', 'completed')
          .gte('completed_at', validFrom)
          .order('completed_at', { ascending: false })
          .limit(10)

        if (attempts && attempts.length > 0) {
          // Хватает одной успешной попытки в пределах срока действия.
          productTestPassed = attempts.some(
            (a: any) => a.passed === true || Number(a.score) >= settings.product_test_min_score,
          )
        }
        // attempts пуст → остаётся null: «тест не сдавался», а не «провален».
      }
    }

    const outcome = resolveBonus(revenue, plan, settings, { product_test_passed: productTestPassed })

    return json({
      data: {
        available: true,
        date,
        shift,
        locked: Boolean(planRow.locked_at),
        revenue,
        // Суммы отдаём, только если модуль их действительно платит. Иначе
        // экран обещал бы деньги, которые начисляет другое правило со своими
        // порогами — а обманутое ожидание хуже, чем отсутствие цифры.
        levels: [
          { code: 'b1', threshold: plan.b1, bonus: settings.shift_bonus_paid ? settings.b1_amount : null },
          { code: 'b2', threshold: plan.b2, bonus: settings.shift_bonus_paid ? settings.b2_amount : null },
          { code: 'b3', threshold: plan.b3, bonus: settings.shift_bonus_paid ? settings.b3_amount : null },
        ],
        bonus_paid_here: settings.shift_bonus_paid,
        payout_note: settings.shift_bonus_paid
          ? null
          : 'Уровни — цель на смену. Деньги за оборот начисляются по правилам зарплаты.',
        reached: outcome.level,
        earned: settings.shift_bonus_paid ? outcome.amount : null,
        next_level: outcome.next_level,
        to_next: outcome.to_next,
        // Уровень взят по выручке, но срезан воротами — продавцу важно видеть
        // причину, а не просто «почему-то меньше».
        capped_from: outcome.capped_from,
        product_test_required: settings.require_product_test_for_top_bonus,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/sales-kpi GET',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
