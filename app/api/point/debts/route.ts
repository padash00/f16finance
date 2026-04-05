import { NextResponse } from 'next/server'

import { weekStartUtcISO } from '@/lib/core/date'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { sendOperatorDebtTelegramSnapshot } from '@/lib/server/services/salary'
import { validateAdminToken } from '@/lib/server/admin-tokens'

type CreateDebtBody = {
  action: 'createDebt'
  payload: {
    operator_id?: string | null
    client_name?: string | null
    item_name: string
    barcode?: string | null
    quantity?: number | null
    unit_price?: number | null
    total_amount?: number | null
    comment?: string | null
    local_ref?: string | null
    occurred_at?: string | null
    created_by_operator_id?: string | null
  }
}

type DeleteDebtBody = {
  action: 'deleteDebt'
  itemId: string
  operatorId?: string | null
  adminToken?: string | null
}

type AdminPayDebtBody = {
  action: 'adminPayDebt'
  itemId: string
  adminToken: string
}

type Body = CreateDebtBody | DeleteDebtBody | AdminPayDebtBody

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Map Postgres/Supabase messages to stable client-facing codes for point debts. */
function mapPointDebtErrorMessage(raw: string | undefined): string {
  const m = (raw || '').toLowerCase()
  if (m.includes('inventory_balances_quantity_check') || m.includes('inventory-insufficient-stock')) {
    return 'inventory-insufficient-stock'
  }
  return raw || 'Не удалось обработать долг точки'
}

function canDebtReport(input: Record<string, unknown> | null | undefined) {
  return input?.debt_report === true
}

function startOfWeekISO(dateLike?: string | null) {
  if (dateLike) {
    const base = new Date(dateLike)
    return weekStartUtcISO(Number.isNaN(base.getTime()) ? new Date() : base)
  }
  return weekStartUtcISO(new Date())
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

const DEBTOR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * UI uses synthetic ids `staff:<uuid>` / `orgmember:<uuid>` for non-operator debtors.
 * They must never be sent to uuid columns — convert to operator_id null + client_name.
 */
async function normalizePointDebtDebtor(params: {
  supabase: any
  rawOperatorId: string | null
  payloadClientName: string | null
}): Promise<{ operatorId: string | null; clientName: string | null }> {
  const raw = params.rawOperatorId?.trim() || null
  let clientName = params.payloadClientName?.trim() || null

  if (!raw) {
    return { operatorId: null, clientName }
  }

  if (raw.startsWith('staff:')) {
    const staffId = raw.slice('staff:'.length)
    if (!DEBTOR_UUID_RE.test(staffId)) {
      return { operatorId: null, clientName }
    }
    if (!clientName) {
      const { data: st, error } = await params.supabase
        .from('staff')
        .select('full_name, short_name')
        .eq('id', staffId)
        .maybeSingle()
      if (error) throw error
      clientName = (st?.short_name || st?.full_name || '').trim() || null
    }
    return { operatorId: null, clientName }
  }

  if (raw.startsWith('orgmember:')) {
    const omId = raw.slice('orgmember:'.length)
    if (!DEBTOR_UUID_RE.test(omId)) {
      return { operatorId: null, clientName }
    }
    if (!clientName) {
      const { data: om, error } = await params.supabase
        .from('organization_members')
        .select('email')
        .eq('id', omId)
        .maybeSingle()
      if (error) throw error
      clientName = om?.email?.trim() || null
    }
    return { operatorId: null, clientName }
  }

  return { operatorId: raw, clientName }
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

  if (params.operatorId) {
    query = query.eq('operator_id', params.operatorId)
  } else {
    query = query.is('operator_id', null).eq('client_name', params.clientName)
  }

  const { data, error } = await query
  if (error) throw error

  if (!data || data.length === 0) return null

  // If duplicates exist (race condition) — merge them into the first record
  if (data.length > 1) {
    const [keep, ...extras] = data as any[]
    const mergedAmount = data.reduce((sum: number, r: any) => sum + normalizeMoney(r.amount), 0)
    await params.supabase.from('debts').update({ amount: mergedAmount }).eq('id', keep.id)
    const extraIds = extras.map((r: any) => r.id)
    await params.supabase.from('debts').delete().in('id', extraIds)
    return { ...keep, amount: mergedAmount }
  }

  return data[0]
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
        'id, company_id, operator_id, created_by_operator_id, point_device_id, client_name, item_name, quantity, unit_price, total_amount, comment, week_start, source, local_ref, status, created_at, deleted_at, operator:operator_id(id, name, short_name)',
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
        created_by_operator_id: row.created_by_operator_id || null,
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
    // Rate limit: 60 debt operations per device per minute
    const ip = getClientIp(request)
    const rl = checkRateLimit(`point-debts:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return json({ error: 'too-many-requests' }, 429)
    }

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
      const barcode = payload.barcode?.trim() || null
      const weekStart = startOfWeekISO(payload.occurred_at || null)
      const createdByOperatorId = payload.created_by_operator_id?.trim() || null

      if (!itemName) return json({ error: 'item-name-required' }, 400)
      if (totalAmount <= 0) return json({ error: 'amount-required' }, 400)

      let { operatorId, clientName } = await normalizePointDebtDebtor({
        supabase,
        rawOperatorId: payload.operator_id?.trim() || null,
        payloadClientName: payload.client_name?.trim() || null,
      })

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
      const { data: createdRpc, error: insertError } = await supabase.rpc('inventory_create_point_debt', {
        p_company_id: device.company_id,
        p_location_id: null,
        p_point_device_id: device.id,
        p_operator_id: operatorId,
        p_client_name: clientName,
        p_item_name: itemName,
        p_barcode: barcode,
        p_quantity: quantity,
        p_unit_price: unitPrice,
        p_total_amount: totalAmount,
        p_comment: note,
        p_week_start: weekStart,
        p_source: 'point-client',
        p_local_ref: payload.local_ref?.trim() || null,
        p_created_by_operator_id: createdByOperatorId,
      })

      if (insertError) throw insertError

      const createdId = Array.isArray(createdRpc) ? createdRpc[0]?.debt_item_id : createdRpc?.debt_item_id
      const createdInventoryItemId = Array.isArray(createdRpc)
        ? createdRpc[0]?.inventory_item_id
        : createdRpc?.inventory_item_id

      const { data: created, error: createdError } = await supabase
        .from('point_debt_items')
        .select('id, client_name, item_name, quantity, unit_price, total_amount, comment, week_start, created_at, status, inventory_item_id')
        .eq('id', createdId)
        .single()

      if (createdError) throw createdError

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
          inventory_item_id: createdInventoryItemId || created.inventory_item_id || null,
          inventory_location_id: null,
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

    // ─── ADMIN PAY DEBT (mark paid, no inventory restore) ─────────────────────
    if (body.action === 'adminPayDebt') {
      const adminTok = (body as AdminPayDebtBody).adminToken?.trim()
      if (!adminTok || !validateAdminToken(adminTok)) {
        return json({ error: 'admin-token-required' }, 403)
      }

      const payItemId = (body as AdminPayDebtBody).itemId?.trim()
      if (!payItemId) return json({ error: 'item-id-required' }, 400)

      const { data: payItem, error: payItemError } = await supabase
        .from('point_debt_items')
        .select('id, operator_id, total_amount, week_start, status, item_name, client_name')
        .eq('id', payItemId)
        .eq('company_id', device.company_id)
        .maybeSingle()

      if (payItemError) throw payItemError
      if (!payItem) return json({ error: 'debt-item-not-found' }, 404)
      if (payItem.status !== 'active') return json({ ok: true, already: true })

      const { error: payUpdateError } = await supabase
        .from('point_debt_items')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .eq('id', payItemId)

      if (payUpdateError) throw payUpdateError

      const aggDebt = await findAggregateDebt({
        supabase,
        companyId: device.company_id,
        operatorId: payItem.operator_id || null,
        clientName: (payItem.client_name || 'Должник').trim() || 'Должник',
        weekStart: payItem.week_start,
      })
      if (aggDebt) {
        const next = Math.max(0, normalizeMoney(aggDebt.amount) - normalizeMoney(payItem.total_amount))
        if (next <= 0) {
          await supabase.from('debts').update({ status: 'paid' }).eq('id', aggDebt.id)
        } else {
          await supabase.from('debts').update({ amount: next }).eq('id', aggDebt.id)
        }
      }

      await writeAuditLog(supabase, {
        entityType: 'point-debt-item',
        entityId: payItemId,
        action: 'admin-mark-paid',
        payload: { point_device_id: device.id, item_name: payItem.item_name, total_amount: payItem.total_amount },
      })

      return json({ ok: true, data: { id: payItemId, paid: true } })
    }

    const itemId = body.itemId?.trim()
    if (!itemId) return json({ error: 'item-id-required' }, 400)

    const { data: item, error: itemError } = await supabase
      .from('point_debt_items')
      .select('id, company_id, operator_id, created_by_operator_id, client_name, item_name, quantity, unit_price, total_amount, comment, week_start, status, created_at')
      .eq('id', itemId)
      .eq('company_id', device.company_id)
      .limit(1)
      .maybeSingle()

    if (itemError) throw itemError
    if (!item) return json({ error: 'debt-item-not-found' }, 404)
    if (item.status !== 'active') return json({ error: 'debt-item-already-deleted' }, 409)

    // Admin token bypasses all operator/time checks
    const adminToken = (body as DeleteDebtBody).adminToken?.trim() || null
    const isAdmin = adminToken ? validateAdminToken(adminToken) : false

    if (!isAdmin) {
      // Разрешаем удаление: либо сам должник, либо тот кто добавил долг
      const requestingOperatorId = (body as DeleteDebtBody).operatorId?.trim() || null
      const isDebtor = item.operator_id && requestingOperatorId && item.operator_id === requestingOperatorId
      const isCreator = item.created_by_operator_id && requestingOperatorId && item.created_by_operator_id === requestingOperatorId
      if (item.operator_id && requestingOperatorId && !isDebtor && !isCreator) {
        return json({ error: 'debt-belongs-to-another-operator' }, 403)
      }
      // Creator (not the debtor) can only delete within 15 minutes
      if (isCreator && !isDebtor) {
        const createdAt = new Date((item as any).created_at).getTime()
        if (Date.now() - createdAt > 15 * 60_000) {
          return json({ error: 'debt-delete-window-expired' }, 403)
        }
      }
    }

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

    const { error: updateError } = await supabase.rpc('inventory_delete_point_debt', {
      p_debt_item_id: item.id,
    })

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

    return json({ ok: true, data: { id: item.id, deleted: true } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-debts:post',
      message: error?.message || 'Point debts POST error',
    })
    return json({ error: mapPointDebtErrorMessage(error?.message) }, 500)
  }
}
