/**
 * Debts rollover — еженедельный перенос непогашенных долгов.
 *
 * Запускать в воскресенье поздно вечером, когда «текущая» неделя уже
 * закончилась и все выплаты сделаны. Cron в vercel.json:
 *   { "path": "/api/cron/debts-rollover", "schedule": "0 21 * * 0" }
 *   (21:00 UTC воскресенья = 02:00 понедельника UTC+5 — Алматы)
 *
 * Алгоритм:
 *   1. Определяем "текущую" неделю — ту что только что завершилась.
 *      Если сегодня воскресенье → currentWeekStart = понедельник этой
 *      же недели. Иначе берём предыдущий понедельник.
 *   2. Для каждого active-долга с week_start = currentWeekStart:
 *        a) status='rolled_over', rolled_over_at=now, rolled_over_to_id=NEW
 *        b) Создаём новый долг: amount=старая_сумма, week_start=next_week,
 *           rolled_over_from_id=старый
 *        c) Audit log
 *
 * Защита: header `x-cron-secret` или query `?secret=` должен совпадать
 * с env CRON_SECRET. Иначе 401.
 */

import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function mondayOf(d: Date): Date {
  const date = new Date(d)
  const day = date.getUTCDay() // 0=Sunday, 1=Monday, ..., 6=Saturday
  const offset = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + offset)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + days)
  return r
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const provided = request.headers.get('x-cron-secret') || url.searchParams.get('secret')
  const expected = process.env.CRON_SECRET
  if (expected && provided !== expected) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!hasAdminSupabaseCredentials()) {
    return json({ error: 'no_admin_creds' }, 500)
  }

  const supabase = createAdminSupabaseClient()
  const now = new Date()

  // currentWeekStart — понедельник той недели которая только что закончилась
  // (или сейчас идёт воскресенье — её последний день).
  const currentWeekStart = mondayOf(now)
  const nextWeekStart = addDays(currentWeekStart, 7)
  const currentWeekStartIso = toIso(currentWeekStart)
  const nextWeekStartIso = toIso(nextWeekStart)

  // Можно вручную указать ?week=YYYY-MM-DD чтобы прокрутить любую неделю
  const overrideWeek = url.searchParams.get('week')
  const fromWeek = overrideWeek && /^\d{4}-\d{2}-\d{2}$/.test(overrideWeek) ? overrideWeek : currentWeekStartIso
  const toWeek = overrideWeek
    ? toIso(addDays(new Date(overrideWeek), 7))
    : nextWeekStartIso

  // Берём только active долги конкретно этой недели
  const { data: activeDebts, error: fetchError } = await supabase
    .from('debts')
    .select('id, operator_id, company_id, amount, week_start, comment, organization_id, client_name')
    .eq('status', 'active')
    .eq('week_start', fromWeek)

  if (fetchError) {
    return json({ error: fetchError.message }, 500)
  }

  if (!activeDebts || activeDebts.length === 0) {
    return json({
      ok: true,
      rolled_over: 0,
      from_week: fromWeek,
      to_week: toWeek,
      message: 'Нет активных долгов для переноса',
    })
  }

  let rolledCount = 0
  const errors: string[] = []

  for (const debt of activeDebts as any[]) {
    try {
      // 1. Создаём дочерний долг в следующей неделе
      const { data: newDebt, error: insertErr } = await supabase
        .from('debts')
        .insert({
          organization_id: debt.organization_id,
          company_id: debt.company_id,
          operator_id: debt.operator_id,
          client_name: debt.client_name,
          amount: debt.amount,
          week_start: toWeek,
          status: 'active',
          comment: debt.comment,
          rolled_over_from_id: debt.id,
        })
        .select('id')
        .single()

      if (insertErr) throw insertErr

      // 2. Старый долг → status='rolled_over' + ссылка на дочерний
      const { error: updateErr } = await supabase
        .from('debts')
        .update({
          status: 'rolled_over',
          rolled_over_at: new Date().toISOString(),
          rolled_over_to_id: (newDebt as any).id,
        })
        .eq('id', debt.id)

      if (updateErr) throw updateErr

      await writeAuditLog(supabase, {
        actorUserId: null,
        entityType: 'debt',
        entityId: debt.id,
        action: 'rollover',
        payload: {
          from_week: fromWeek,
          to_week: toWeek,
          new_debt_id: (newDebt as any).id,
          amount: debt.amount,
          source: 'cron/debts-rollover',
        },
      })

      rolledCount++
    } catch (e: any) {
      errors.push(`${debt.id}: ${e?.message || 'error'}`)
    }
  }

  return json({
    ok: true,
    rolled_over: rolledCount,
    from_week: fromWeek,
    to_week: toWeek,
    errors: errors.length > 0 ? errors : undefined,
  })
}
