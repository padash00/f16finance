/**
 * Кому сколько доплатить за месяц.
 *
 * Самый простой экран модуля и единственный, который касается денег напрямую.
 * Отвечает на один вопрос: кому из продавцов и сколько доплатить за качество
 * работы в этом месяце.
 *
 * Всё остальное — ставка за смену и бонусы за оборот — считает зарплата, как
 * и раньше. Здесь только доплата за то, чего в правилах зарплаты нет: средний
 * чек, допродажи, товары в чеке.
 */
import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe, describeError } from '@/lib/server/audit'
import {
  earliestSaleDate,
  inScope,
  loadShiftFacts,
  loadStoreKpiSettings,
  resolveStoreKpiContext,
  todayISO,
} from '@/lib/server/store-kpi'
import { analyzeStoreKpi, monthlyBonus } from '@/lib/domain/store-kpi'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y || 1970, m || 1, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** Почему человеку ничего не начисляется — это важнее самой суммы. */
function explainZero(status: string, shifts: number, minShifts: number): string | null {
  if (status === 'INSUFFICIENT_DATA') {
    return `Отработано ${shifts} смен, а статус ставится от ${minShifts}. Оценивать человека по нескольким сменам нельзя — разброс слишком велик.`
  }
  if (status === 'NORMAL') return 'Работал в пределах обычного — доплата за качество начинается со статуса «сильный».'
  if (status === 'NEEDS_TRAINING') {
    return 'Метрики ниже нормы несколько смен подряд. Это повод разобрать смены вместе, а не наказывать.'
  }
  return null
}

const STATUS_LABELS: Record<string, string> = {
  TOP: 'Топ',
  STRONG: 'Сильный',
  NORMAL: 'Норма',
  NEEDS_TRAINING: 'Нужно обучение',
  INSUFFICIENT_DATA: 'Мало смен',
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
    const month = url.searchParams.get('month') || today.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'month-invalid' }, 400)

    const { from, to } = monthBounds(month)
    const { settings } = await loadStoreKpiSettings(supabase, companyId)

    // История нужна целиком: норма, с которой сравнивают месяц, строится по
    // всему, что было до него.
    const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? from
    const facts = await loadShiftFacts(supabase, { companyId, from: historyFrom, to })

    const result = analyzeStoreKpi({
      baselineFacts: facts.filter((f) => f.date < from),
      targetFacts: facts.filter((f) => f.date >= from && f.date <= to),
      settings,
    })

    const cashierIds = result.cashiers.map((c) => c.cashier_id)
    const names = new Map<string, string>()
    if (cashierIds.length) {
      const { data: ops } = await supabase
        .from('operators')
        .select('id, name, short_name')
        .in('id', cashierIds)
      for (const op of ops || []) {
        names.set(String(op.id), String(op.short_name || op.name || 'Без имени'))
      }
    }

    const { data: awards } = await supabase
      .from('store_kpi_bonus_awards')
      .select('cashier_id, amount, salary_adjustment_id, voided_at, approved_at')
      .eq('company_id', companyId)
      .eq('kind', 'monthly')
      .eq('period_start', from)

    const awardByCashier = new Map(
      ((awards || []) as any[]).map((a) => [String(a.cashier_id), a]),
    )

    const rows = result.cashiers.map((c) => {
      const bonus = monthlyBonus(c.status, settings)
      const award = awardByCashier.get(c.cashier_id)
      const paid = Boolean(award && award.salary_adjustment_id && !award.voided_at)

      return {
        cashier_id: c.cashier_id,
        name: names.get(c.cashier_id) || 'Без имени',
        shifts: c.shifts,
        revenue: c.revenue,
        receipts: c.receipts,
        score: c.score,
        status: c.status,
        status_label: STATUS_LABELS[c.status] || c.status,
        confidence: c.confidence,
        amount: bonus.amount,
        level: bonus.level,
        paid,
        paid_at: paid ? award.approved_at : null,
        zero_reason: bonus.amount > 0 ? null : explainZero(c.status, c.shifts, settings.min_qualifying_shifts),
        // Что именно у человека хорошо и что плохо — чтобы разговор был
        // предметным, а не «работай лучше».
        strengths: c.strengths,
        weaknesses: c.weaknesses,
      }
    })

    const toPay = rows.filter((r) => r.amount > 0 && !r.paid)
    const alreadyPaid = rows.filter((r) => r.paid)

    return json({
      data: {
        month,
        company_id: companyId,
        rows: rows.sort((a, b) => b.amount - a.amount || (b.score ?? 0) - (a.score ?? 0)),
        totals: {
          to_pay: toPay.reduce((sum, r) => sum + r.amount, 0),
          to_pay_people: toPay.length,
          already_paid: alreadyPaid.reduce((sum, r) => sum + r.amount, 0),
          already_paid_people: alreadyPaid.length,
          people: rows.length,
        },
        settings: {
          monthly_bonus_strong: settings.monthly_bonus_strong,
          monthly_bonus_top: settings.monthly_bonus_top,
          min_qualifying_shifts: settings.min_qualifying_shifts,
          shift_bonus_paid: settings.shift_bonus_paid,
        },
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/payout GET',
      message: describeError(error),
    })
    console.error('[sales-kpi/payout]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
