import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireOperator } from '@/lib/server/operator-context'

/**
 * Отчёт смены из приложения.
 *
 * Закрытие смены и отчёт — разные вещи, и это не формальность. Закрытие
 * фиксирует пересчёт кассы, а отчёт создаёт доход за смену: именно он попадает
 * в выручку дня, в ОПиУ и в зарплату. В программе на точке отчёт отправляют
 * отдельной кнопкой, а из приложения смену можно было закрыть — но выручка за
 * неё никуда не записывалась.
 *
 * Состав повторяет отчёт на точке: купюры, мелочь, Kaspi по видам, долги,
 * старт кассы, wipon. В доход идут только деньги, которые реально пришли за
 * смену — купюры и безнал; мелочь, старт и wipon остаются в `meta` и видны в
 * отчёте смены.
 *
 *   POST /api/operator/shift-report
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function num(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

type Body = {
  date?: string
  shift?: 'day' | 'night'
  shift_id?: string | null
  /** Купюры без мелочи. */
  cash?: number
  coins?: number
  kaspi_pos?: number
  kaspi_online?: number
  /** Часть Kaspi до полуночи — только для ночной смены. */
  kaspi_before_midnight?: number | null
  /** Долги, взятые под запись за смену. */
  debts?: number
  /** Сколько было в кассе на начало. */
  start_cash?: number
  wipon?: number
  comment?: string | null
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOperator(request)
    if ('response' in ctx) return ctx.response

    const { supabase, companyId, operatorId } = ctx
    const body = (await request.json().catch(() => null)) as Body | null

    const date = String(body?.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'date-required' }, 400)
    if (body?.shift !== 'day' && body?.shift !== 'night') return json({ error: 'shift-invalid' }, 400)

    const cash = num(body?.cash)
    const coins = num(body?.coins)
    const kaspiPos = num(body?.kaspi_pos)
    const kaspiOnline = num(body?.kaspi_online)
    const debts = num(body?.debts)
    const startCash = num(body?.start_cash)
    const wipon = num(body?.wipon)

    // Тот же расчёт, что показывает программа на точке: факт минус старт кассы,
    // за вычетом wipon. Считаем на сервере, чтобы «итог» в приложении и в
    // отчёте не разошёлся.
    const fact = cash + coins + kaspiPos + debts - startCash
    const total = fact - wipon

    // Один отчёт на смену. Повторная отправка — почти всегда второе нажатие на
    // медленной сети, а не второй отчёт: два дохода за смену раздувают выручку
    // вдвое, и разбираться с этим приходится через неделю по журналу.
    // shift_id приходит из тела: он обязан быть сменой своей компании. Иначе
    // (а) по чужому id можно было узнать, есть ли у него доход, и получить его
    // id, (б) доход этой точки прикреплялся к смене другого арендатора и портил
    // его отчёты.
    let shiftId: string | null = null
    if (body?.shift_id) {
      const { data: shiftRow } = await supabase
        .from('point_shifts')
        .select('id')
        .eq('id', body.shift_id)
        .eq('company_id', companyId)
        .maybeSingle()
      if (!shiftRow) return json({ error: 'point-shift-not-allowed' }, 403)
      shiftId = String((shiftRow as any).id)

      const { data: existing } = await supabase
        .from('incomes')
        .select('id')
        .eq('shift_id', shiftId)
        .eq('company_id', companyId)
        .limit(1)
      if (existing && existing.length > 0) {
        return json({ ok: true, income_id: String((existing as any)[0].id), duplicate: true })
      }
    }

    const cashless = kaspiPos + kaspiOnline
    if (cash + cashless + coins + debts <= 0) {
      return json({ error: 'amount-required', message: 'Отчёт без сумм не отправляется' }, 400)
    }

    const { data: created, error } = await supabase
      .from('incomes')
      .insert([
        {
          date,
          company_id: companyId,
          operator_id: operatorId,
          shift: body.shift,
          shift_id: shiftId,
          // В доход идут купюры и безнал. Мелочь остаётся в кассе на размен, а
          // долги — это ещё не деньги: они попадут в доход, когда их вернут.
          cash_amount: cash,
          kaspi_amount: cashless,
          kaspi_before_midnight:
            body.shift === 'night' && body?.kaspi_before_midnight != null
              ? num(body.kaspi_before_midnight)
              : null,
          online_amount: 0,
          card_amount: 0,
          comment: body?.comment?.trim() || null,
          is_virtual: false,
          meta: {
            cash_only: cash,
            coins,
            kaspi_pos: kaspiPos,
            kaspi_online: kaspiOnline,
            debts,
            start_cash: startCash,
            wipon,
            diff: total,
            source: 'ios',
          },
        },
      ])
      .select('id')
      .single()

    if (error) throw error

    await writeAuditLog(supabase as any, {
      entityType: 'point-shift-report',
      entityId: String((created as any).id),
      action: 'create',
      payload: { company_id: companyId, operator_id: operatorId, date, shift: body.shift, source: 'ios' },
    })

    return json({ ok: true, income_id: String((created as any).id), total })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/shift-report POST',
      message: error?.message || 'error',
    })
    return json({ error: 'shift-report-failed' }, 500)
  }
}
