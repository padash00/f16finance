import { NextResponse } from 'next/server'

import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { sendOperatorDebtTelegramSnapshot } from '@/lib/server/services/salary'

type CreateDebtBody = {
  action: 'createDebt'
  payload: {
    operator_id?: string | null
    client_name?: string | null
    item_name: string
    quantity?: number | null
    unit_price?: number | null
    total_amount?: number | null
    comment?: string | null
    local_ref?: string | null
    occurred_at?: string | null
  }
}

type DeleteDebtBody = {
  action: 'deleteDebt'
  itemId: string
}

type Body = CreateDebtBody | DeleteDebtBody

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canDebtReport(input: Record<string, unknown> | null | undefined) {
  return input?.debt_report === true
}

function startOfWeekISO(dateLike?: string | null) {
  const base = dateLike ? new Date(dateLike) : new Date()
  const date = Number.isNaN(base.getTime()) ? new Date() : base
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = copy.getUTCDay()
  const offset = day === 0 ? -6 : 1 - day
  copy.setUTCDate(copy.getUTCDate() + offset)
  return copy.toISOString().slice(0, 10)
}

function appendComment(base: string | null | undefined, line: string | null | undefined) {
  const left = (base || '').trim()
  const right = (line || '').trim()
  const joined = [left, right].filter(Boolean).join('\n')
  return joined ? joined.slice(-900) : null
}

function normalizeMoney(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.max(0, Math.round(amount))
}

async function resolveOperator(params: {
  supabase: any
  operatorId: string
}) {
  const { data, error } = await params.supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, is_active')
    .eq('id', params.operatorId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

async function findAggregateDebt(params: {
  supabase: any
  companyId: string
  operatorId?: string | null
  clientName: string
  weekStart: string
}) {
  let query = params.supabase
    .from('debts')
    .select('id, amount, comment, client_name, operator_id')
    .eq('company_id', params.companyId)
    .eq('week_start', params.weekStart)
    .eq('status', 'active')
    .limit(1)

  if (params.operatorId) {
    query = query.eq('operator_id', params.operatorId)
  } else {
    query = query.is('operator_id', null).eq('client_name', params.clientName)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

async function upsertAggregateDebt(params: {
  supabase: any
  companyId: string
  operatorId?: string | null
  clientName: string
  weekStart: string
  amount: number
  commentLine: string
}) {
  const existing = await findAggregateDebt(params)
  if (existing?.id) {
    const { error } = await params.supabase
      .from('debts')
      .update({
        amount: normalizeMoney(existing.amount) + params.amount,
        comment: appendComment(existing.comment, params.commentLine),
      })
      .eq('id', existing.id)

    if (error) throw error
    return existing.id
  }

  const payload = {
    client_name: params.clientName,
    amount: params.amount,
    date: params.weekStart,
    operator_id: params.operatorId || null,
    company_id: params.companyId,
    comment: params.commentLine || null,
    status: 'active',
    source: 'point-client',
    week_start: params.weekStart,
  }

  const { data, error } = await params.supabase.from('debts').insert([payload]).select('id').single()
  if (error) throw error
  return data?.id || null
}

async function reduceAggregateDebt(params: {
  supabase: any
  companyId: string
  operatorId?: string | null
  clientName: string
  weekStart: string
  amount: number
  commentLine: string
}) {
  const existing = await findAggregateDebt(params)
  if (!existing?.id) return null

  const nextAmount = normalizeMoney(existing.amount) - params.amount
  if (nextAmount <= 0) {
    const { error } = await params.supabase.from('debts').delete().eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  const { error } = await params.supabase
    .from('debts')
    .update({
      amount: nextAmount,
      comment: appendComment(existing.comment, params.commentLine),
    })
    .eq('id', existing.id)

  if (error) throw error
  return existing.id
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canDebtReport(device.feature_flags || {})) {
      return json({ error: 'debt-report-disabled-for-device' }, 403)
    }

    const { data, error } = await supabase
      .from('point_debt_items')
      .select(
        'id, company_id, operator_id, point_device_id, client_name, item_name, quantity, unit_price, total_amount, comment, week_start, source, local_ref, status, created_at, deleted_at, operator:operator_id(id, name, short_name)',
      )
      .eq('company_id', device.company_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw error

    const items = ((data || []) as any[]).map((row) => {
      const operator = Array.isArray(row.operator) ? row.operator[0] || null : row.operator || null
      return {
        id: row.id,
        operator_id: row.operator_id || null,
        client_name: row.client_name || null,
        debtor_name: operator?.name || row.client_name || 'Должник',
        item_name: row.item_name,
        quantity: Number(row.quantity || 0),
        unit_price: Number(row.unit_price || 0),
        total_amount: Number(row.total_amount || 0),
        comment: row.comment || null,
        week_start: row.week_start,
        created_at: row.created_at,
        source: row.source || 'point-client',
        status: row.status,
      }
    })

    return json({
      ok: true,
      data: {
        items,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-debts:get',
      message: error?.message || 'Point debts GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить долги точки' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canDebtReport(device.feature_flags || {})) {
      return json({ error: 'debt-report-disabled-for-device' }, 403)
    }

    const body = (await request.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    if (body.action === 'createDebt') {
      const payload = body.payload
      const itemName = payload.item_name?.trim()
      const quantity = Math.max(1, Number(payload.quantity || 1))
      const unitPrice = normalizeMoney(payload.unit_price)
      const totalAmount = normalizeMoney(payload.total_amount) || normalizeMoney(quantity * unitPrice)
      const operatorId = payload.operator_id?.trim() || null
      const weekStart = startOfWeekISO(payload.occurred_at || null)

      if (!itemName) return json({ error: 'item-name-required' }, 400)
      if (totalAmount <= 0) return json({ error: 'amount-required' }, 400)

      let clientName = payload.client_name?.trim() || null
      let operator: any = null

      if (operatorId) {
        operator = await resolveOperator({
          supabase,
          operatorId,
        })
        if (!operator) return json({ error: 'operator-not-found' }, 404)
        clientName = operator?.name || clientName
      }

      if (!clientName) return json({ error: 'client-name-required' }, 400)

      if (payload.local_ref?.trim()) {
        const { data: existing, error: existingError } = await supabase
          .from('point_debt_items')
          .select('id, client_name, item_name, quantity, unit_price, total_amount, status, created_at')
          .eq('point_device_id', device.id)
          .eq('local_ref', payload.local_ref.trim())
          .limit(1)
          .maybeSingle()

        if (existingError) throw existingError
        if (existing) {
          return json({
            ok: true,
            data: {
              item: existing,
              duplicate: true,
            },
          })
        }
      }

      const note = payload.comment?.trim() || null
      const commentLine = `${itemName} x${quantity} = ${totalAmount} ₸`
      const { data: created, error: insertError } = await supabase
        .from('point_debt_items')
        .insert([
          {
            company_id: device.company_id,
            operator_id: operatorId,
            point_device_id: device.id,
            client_name: clientName,
            item_name: itemName,
            quantity,
            unit_price: unitPrice,
            total_amount: totalAmount,
            comment: note,
            week_start: weekStart,
            source: 'point-client',
            local_ref: payload.local_ref?.trim() || null,
            status: 'active',
          },
        ])
        .select('id, client_name, item_name, quantity, unit_price, total_amount, comment, week_start, created_at, status')
        .single()

      if (insertError) throw insertError

      const aggregateId = await upsertAggregateDebt({
        supabase,
        companyId: device.company_id,
        operatorId,
        clientName,
        weekStart,
        amount: totalAmount,
        commentLine: note ? `${commentLine} • ${note}` : commentLine,
      })

      await writeAuditLog(supabase, {
        entityType: 'point-debt-item',
        entityId: String(created.id),
        action: 'create',
        payload: {
          point_device_id: device.id,
          point_device_name: device.name,
          company_id: device.company_id,
          operator_id: operatorId,
          client_name: clientName,
          item_name: itemName,
          quantity,
          unit_price: unitPrice,
          total_amount: totalAmount,
          week_start: weekStart,
          aggregate_debt_id: aggregateId,
        },
      })

      if (operator?.id && operator?.telegram_chat_id) {
        try {
          await sendOperatorDebtTelegramSnapshot(supabase, {
            operatorId: String(operator.id),
            operatorName: operator.short_name || operator.name || clientName,
            operatorChatId: String(operator.telegram_chat_id),
            weekStart,
            lastItem: {
              name: itemName,
              qty: quantity,
              total: totalAmount,
              pointName: device.name,
              companyName: device.company?.name || null,
            },
          })

          await writeNotificationLog(supabase, {
            channel: 'telegram',
            recipient: String(operator.telegram_chat_id),
            status: 'sent',
            payload: {
              kind: 'point-debt-notify',
              operator_id: operator.id,
              point_device_id: device.id,
              point_device_name: device.name,
              company_id: device.company_id,
              company_name: device.company?.name || null,
              item_name: itemName,
              quantity,
              total_amount: totalAmount,
              week_start: weekStart,
            },
          })
        } catch (notificationError: any) {
          await writeNotificationLog(supabase, {
            channel: 'telegram',
            recipient: String(operator.telegram_chat_id),
            status: 'failed',
            payload: {
              kind: 'point-debt-notify',
              operator_id: operator.id,
              point_device_id: device.id,
              error: notificationError?.message || 'telegram-send-failed',
            },
          })
        }
      }

      return json({
        ok: true,
        data: {
          item: created,
        },
      })
    }

    const itemId = body.itemId?.trim()
    if (!itemId) return json({ error: 'item-id-required' }, 400)

    const { data: item, error: itemError } = await supabase
      .from('point_debt_items')
      .select('id, company_id, operator_id, client_name, item_name, quantity, unit_price, total_amount, comment, week_start, status')
      .eq('id', itemId)
      .eq('company_id', device.company_id)
      .limit(1)
      .maybeSingle()

    if (itemError) throw itemError
    if (!item) return json({ error: 'debt-item-not-found' }, 404)
    if (item.status !== 'active') return json({ error: 'debt-item-already-deleted' }, 409)

    const commentLine = `[Удалено] ${item.item_name} x${item.quantity} = ${normalizeMoney(item.total_amount)} ₸`

    const aggregateId = await reduceAggregateDebt({
      supabase,
      companyId: device.company_id,
      operatorId: item.operator_id || null,
      clientName: item.client_name || 'Должник',
      weekStart: item.week_start,
      amount: normalizeMoney(item.total_amount),
      commentLine,
    })

    const { error: updateError } = await supabase
      .from('point_debt_items')
      .update({
        status: 'deleted',
        deleted_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    if (updateError) throw updateError

    await writeAuditLog(supabase, {
      entityType: 'point-debt-item',
      entityId: String(item.id),
      action: 'delete',
      payload: {
        point_device_id: device.id,
        point_device_name: device.name,
        company_id: device.company_id,
        operator_id: item.operator_id || null,
        client_name: item.client_name,
        item_name: item.item_name,
        quantity: item.quantity,
        total_amount: item.total_amount,
        week_start: item.week_start,
        aggregate_debt_id: aggregateId,
      },
    })

    return json({
      ok: true,
      data: {
        id: item.id,
        deleted: true,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-debts:post',
      message: error?.message || 'Point debts POST error',
    })
    return json({ error: error?.message || 'Не удалось обработать долг точки' }, 500)
  }
}
