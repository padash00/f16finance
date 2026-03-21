import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

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
        .from('debts')
        .select('id, company_id, operator_id, amount, comment, week_start, date, status')
        .eq('operator_id', operatorId)
        .order('week_start', { ascending: false })
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
      item_name: 'Долг недели',
      quantity: 1,
      total_amount: Number(row.amount || 0),
      comment: row.comment || null,
      week_start: row.week_start || null,
      created_at: String(row.date || row.week_start),
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
