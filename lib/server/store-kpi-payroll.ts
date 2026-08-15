/**
 * Передача бонуса KPI в зарплату.
 *
 * Что именно платится. Только месячный бонус за статус продавца — деньги за
 * КАЧЕСТВО работы: средний чек, допродажи, товары в чеке. Сменные пороги
 * B1/B2/B3 из этого модуля не платятся: пороги по обороту уже есть в правилах
 * зарплаты (`threshold1_turnover` / `threshold2_turnover`), и начислить за одну
 * смену дважды — самая дорогая ошибка, какую здесь можно сделать.
 *
 * Защита от двойной оплаты тройная:
 *   1. уникальность начисления в `store_kpi_bonus_awards`
 *      по (точка, кассир, вид, период, смена);
 *   2. проверка перед записью: если у начисления уже есть ссылка на
 *      зарплатную корректировку, второй раз не создаём;
 *   3. корректировка помечается `source_type = 'sales_kpi'`, поэтому её видно
 *      в зарплате отдельно от ручных правок.
 */

import { writeAuditLog } from '@/lib/server/audit'

type AnyClient = any

export type PayrollAwardInput = {
  supabase: AnyClient
  organizationId: string
  companyId: string
  cashierId: string
  /** Месяц начисления, YYYY-MM. */
  month: string
  amount: number
  level: string
  status: string
  details: Record<string, unknown>
  modelVersion: string
  actorUserId: string | null
}

export type PayrollAwardResult =
  | { ok: true; created: true; adjustmentId: string; amount: number }
  | { ok: true; created: false; reason: 'already-awarded'; amount: number }
  | { ok: false; error: string }

/** Последний день месяца: бонус относится к периоду, а не к дате нажатия кнопки. */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y || 1970, m || 1, 0).getDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

/**
 * Начисляет месячный бонус и создаёт корректировку в зарплате.
 *
 * Идемпотентна: повторный вызов за тот же месяц ничего не добавит.
 */
export async function awardMonthlyBonusToPayroll(
  input: PayrollAwardInput,
): Promise<PayrollAwardResult> {
  const { supabase, companyId, cashierId, month, amount } = input

  if (!(amount > 0)) return { ok: false, error: 'nothing-to-award' }

  const periodStart = `${month}-01`

  // 1. Уже начисляли? Тогда выходим, ничего не трогая.
  const { data: existing, error: existingErr } = await supabase
    .from('store_kpi_bonus_awards')
    .select('id, amount, salary_adjustment_id, voided_at')
    .eq('company_id', companyId)
    .eq('cashier_id', cashierId)
    .eq('kind', 'monthly')
    .eq('period_start', periodStart)
    .is('shift', null)
    .maybeSingle()
  if (existingErr) return { ok: false, error: existingErr.message }

  if (existing?.salary_adjustment_id && !existing.voided_at) {
    return { ok: true, created: false, reason: 'already-awarded', amount: Number(existing.amount) }
  }

  // 2. Корректировка в зарплате. kind = 'bonus', источник помечен явно —
  // в ведомости должно быть видно, что это не ручная правка.
  const { data: adjustment, error: adjErr } = await supabase
    .from('operator_salary_adjustments')
    .insert([
      {
        operator_id: cashierId,
        company_id: companyId,
        date: monthEnd(month),
        amount: Math.round(amount),
        kind: 'bonus',
        comment: `Месячный бонус за качество продаж (${input.status}), ${month}`,
        source_type: 'sales_kpi',
      },
    ])
    .select('id')
    .single()
  if (adjErr) return { ok: false, error: adjErr.message }

  const adjustmentId = String(adjustment.id)

  // 3. Начисление со ссылкой на корректировку.
  const { error: awardErr } = await supabase.from('store_kpi_bonus_awards').upsert(
    {
      organization_id: input.organizationId,
      company_id: companyId,
      cashier_id: cashierId,
      kind: 'monthly',
      period_start: periodStart,
      shift: null,
      level: input.level,
      amount: Math.round(amount),
      details: input.details,
      model_version: input.modelVersion,
      salary_adjustment_id: adjustmentId,
      approved_by: input.actorUserId,
      approved_at: new Date().toISOString(),
      voided_at: null,
      void_reason: null,
    },
    { onConflict: 'company_id,cashier_id,kind,period_start,shift' },
  )
  if (awardErr) {
    // Корректировку уже создали — откатываем, иначе деньги повиснут в
    // зарплате без следа в начислениях.
    await supabase.from('operator_salary_adjustments').delete().eq('id', adjustmentId)
    return { ok: false, error: awardErr.message }
  }

  await writeAuditLog(supabase, {
    actorUserId: input.actorUserId,
    entityType: 'store_kpi_bonus_awards',
    entityId: companyId,
    action: 'create',
    organizationId: input.organizationId,
    payload: {
      company_id: companyId,
      cashier_id: cashierId,
      month,
      amount: Math.round(amount),
      status: input.status,
      salary_adjustment_id: adjustmentId,
    },
  })

  return { ok: true, created: true, adjustmentId, amount: Math.round(amount) }
}

/**
 * Отмена начисления: убирает деньги из зарплаты, но сохраняет след решения.
 */
export async function voidMonthlyBonus(args: {
  supabase: AnyClient
  organizationId: string
  companyId: string
  cashierId: string
  month: string
  reason: string
  actorUserId: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase, companyId, cashierId, month } = args
  const periodStart = `${month}-01`

  const { data: award, error } = await supabase
    .from('store_kpi_bonus_awards')
    .select('id, salary_adjustment_id')
    .eq('company_id', companyId)
    .eq('cashier_id', cashierId)
    .eq('kind', 'monthly')
    .eq('period_start', periodStart)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!award) return { ok: false, error: 'not-found' }

  if (award.salary_adjustment_id) {
    await supabase.from('operator_salary_adjustments').delete().eq('id', award.salary_adjustment_id)
  }

  const { error: updErr } = await supabase
    .from('store_kpi_bonus_awards')
    .update({
      salary_adjustment_id: null,
      voided_at: new Date().toISOString(),
      void_reason: args.reason,
    })
    .eq('id', award.id)
  if (updErr) return { ok: false, error: updErr.message }

  await writeAuditLog(supabase, {
    actorUserId: args.actorUserId,
    entityType: 'store_kpi_bonus_awards',
    entityId: companyId,
    action: 'delete',
    organizationId: args.organizationId,
    payload: { company_id: companyId, cashier_id: cashierId, month, reason: args.reason },
  })

  return { ok: true }
}
