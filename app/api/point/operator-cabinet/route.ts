import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { requirePointDevice } from '@/lib/server/point-devices'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { validateAdminToken } from '@/lib/server/admin-tokens'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function requirePointOperator(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point

  const operatorId = String(request.headers.get('x-point-operator-id') || '').trim()
  const operatorAuthId = String(request.headers.get('x-point-operator-auth-id') || '').trim()

  if (!operatorId || !operatorAuthId) {
    return { response: NextResponse.json({ error: 'missing-point-operator-auth' }, { status: 401 }) }
  }

  const { supabase } = point

  const { data: operatorAuth, error: authError } = await supabase
    .from('operator_auth')
    .select('id, operator_id, is_active')
    .eq('id', operatorAuthId)
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .maybeSingle()

  if (authError || !operatorAuth) {
    return { response: NextResponse.json({ error: 'invalid-point-operator-auth' }, { status: 403 }) }
  }

  const { data: operator, error: operatorError } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, is_active, operator_profiles(*)')
    .eq('id', operatorId)
    .maybeSingle()

  if (operatorError || !operator) {
    return { response: NextResponse.json({ error: 'operator-not-found' }, { status: 404 }) }
  }

  if ((operator as { is_active?: boolean }).is_active === false) {
    return { response: NextResponse.json({ error: 'operator-inactive' }, { status: 403 }) }
  }

  return {
    ...point,
    operator,
    operatorAuth,
  }
}

export async function GET(request: Request) {
  try {
    const context = await requirePointOperator(request)
    if ('response' in context) return context.response

    const { supabase, operator } = context
    const operatorId = String(operator.id)

    const [shiftsRes, debtsRes] = await Promise.all([
      supabase
        .from('incomes')
        .select('id, date, shift, company_id, cash_amount, kaspi_amount, online_amount')
        .eq('operator_id', operatorId)
        .order('date', { ascending: false })
        .limit(400),
      supabase
        .from('point_debt_items')
        .select('id, company_id, operator_id, item_name, barcode, quantity, unit_price, total_amount, comment, week_start, created_at, status')
        .eq('operator_id', operatorId)
        .order('created_at', { ascending: false })
        .limit(400),
    ])

    if (shiftsRes.error) throw shiftsRes.error
    if (debtsRes.error) throw debtsRes.error

    const companyIds = [
      ...new Set(
        [
          ...((shiftsRes.data || []) as any[]).map((row) => row.company_id),
          ...((debtsRes.data || []) as any[]).map((row) => row.company_id),
        ].filter(Boolean),
      ),
    ]

    const companyMap = new Map<string, { name: string; code: string | null }>()
    if (companyIds.length > 0) {
      const { data: companies, error: companiesError } = await supabase
        .from('companies')
        .select('id, name, code')
        .in('id', companyIds)

      if (companiesError) throw companiesError

      for (const company of companies || []) {
        companyMap.set(String(company.id), {
          name: String(company.name),
          code: (company as any).code || null,
        })
      }
    }

    const shifts = ((shiftsRes.data || []) as any[]).map((row) => {
      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const online = Number(row.online_amount || 0)
      return {
        id: String(row.id),
        date: String(row.date),
        shift: String(row.shift || 'day'),
        company_id: row.company_id || null,
        company_name: row.company_id ? companyMap.get(String(row.company_id))?.name || null : null,
        cash_amount: cash,
        kaspi_amount: kaspi,
        online_amount: online,
        total: cash + kaspi + online,
      }
    })

    const debts = ((debtsRes.data || []) as any[]).map((row) => ({
      id: String(row.id),
      operator_id: row.operator_id || null,
      item_name: String(row.item_name || 'Товар'),
      barcode: row.barcode || null,
      quantity: Number(row.quantity || 1),
      unit_price: Number(row.unit_price || 0),
      total_amount: Number(row.total_amount || 0),
      comment: row.comment || null,
      week_start: row.week_start || null,
      created_at: String(row.created_at),
      status: String(row.status || 'active'),
      company_id: row.company_id || null,
      company_name: row.company_id ? companyMap.get(String(row.company_id))?.name || null : null,
      debtor_name: getOperatorDisplayName(operator, 'Оператор'),
    }))

    return json({
      ok: true,
      operator: {
        id: operator.id,
        name: getOperatorDisplayName(operator, 'Оператор'),
        short_name: operator.short_name,
      },
      shifts,
      debts,
    })
  } catch (error: any) {
    console.error('Point operator cabinet GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/operator-cabinet:get',
      message: error?.message || 'Point operator cabinet GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePointOperator(request)
    if ('response' in context) return context.response

    const { supabase, operator } = context
    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    const token = String(body.token || '').trim()
    if (!validateAdminToken(token)) return json({ error: 'admin-token-required' }, 403)

    if (body.action === 'markDebtPaid') {
      // debtId здесь — это id из point_debt_items
      const debtItemId = String(body.debtId || '').trim()
      if (!debtItemId) return json({ error: 'debtId-required' }, 400)

      const { data: item, error: fetchError } = await supabase
        .from('point_debt_items')
        .select('id, operator_id, total_amount, week_start, status, company_id, item_name')
        .eq('id', debtItemId)
        .eq('operator_id', String(operator.id))
        .maybeSingle()

      if (fetchError) throw fetchError
      if (!item) return json({ error: 'debt-not-found' }, 404)
      if (item.status !== 'active') return json({ ok: true, already: true })

      const paidAt = new Date().toISOString()

      // Убираем из сканера — инвентарь НЕ возвращаем (оплата деньгами, товар потреблён)
      const { error: itemUpdateError } = await supabase
        .from('point_debt_items')
        .update({ status: 'deleted', deleted_at: paidAt })
        .eq('id', debtItemId)

      if (itemUpdateError) throw itemUpdateError

      // Уменьшаем агрегат в debts
      const { data: aggDebt } = await supabase
        .from('debts')
        .select('id, amount')
        .eq('operator_id', String(operator.id))
        .eq('week_start', item.week_start)
        .eq('status', 'active')
        .maybeSingle()

      if (aggDebt) {
        const nextAmount = Math.max(0, Number(aggDebt.amount || 0) - Number(item.total_amount || 0))
        if (nextAmount <= 0) {
          await supabase.from('debts').update({ status: 'paid' }).eq('id', aggDebt.id)
        } else {
          await supabase.from('debts').update({ amount: nextAmount }).eq('id', aggDebt.id)
        }
      }

      await writeAuditLog(supabase, {
        entityType: 'point-debt-item',
        entityId: debtItemId,
        action: 'mark-paid',
        payload: {
          operator_id: String(operator.id),
          week_start: item.week_start,
          total_amount: item.total_amount,
          source: 'point-cabinet',
          admin_token: token.slice(0, 8) + '…',
        },
      })

      // Notify operator via Telegram that their debt was marked as paid
      if (operator.telegram_chat_id) {
        const item_name_for_tg = (item as any).item_name || 'Товар'
        const amt = Number(item.total_amount).toLocaleString('ru-RU')
        const text = [
          `<b>✅ Долг погашен</b>`,
          ``,
          `${escapeTelegramHtml(item_name_for_tg)}`,
          `<b>${amt} ₸</b>`,
        ].join('\n')
        await sendTelegramMessage(String(operator.telegram_chat_id), text).catch(() => null)
      }

      return json({ ok: true })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/operator-cabinet:post',
      message: error?.message || 'Point operator cabinet POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
