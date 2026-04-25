import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createInventoryRequest } from '@/lib/server/repositories/inventory'
import { requirePointDevice } from '@/lib/server/point-devices'
import { requireCurrentOpenShiftId } from '@/lib/server/point-shifts'
import { notifyInventoryRequestCreated } from '@/lib/server/telegram'

type Body = {
  action: 'createRequest'
  payload: {
    comment?: string | null
    items: Array<{
      item_id: string
      requested_qty: number
      comment?: string | null
    }>
  }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canUseInventoryRequests(pointMode: string | null | undefined) {
  const normalized = String(pointMode || '').trim().toLowerCase()
  return new Set(['cash-desk', 'universal', 'debts']).has(normalized)
}

function normalizeMoney(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

async function resolvePointInventoryContext(supabase: any, companyId: string) {
  const [{ data: sourceLocation, error: sourceError }, { data: targetLocation, error: targetError }] = await Promise.all([
    // Prefer company-specific warehouse; fall back to global warehouse (company_id is null)
    supabase
      .from('inventory_locations')
      .select('id, name, code, location_type')
      .eq('location_type', 'warehouse')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
      .then(async (res: any) => {
        if (res.data?.id) return res
        // Fallback: global warehouse without company_id
        return supabase
          .from('inventory_locations')
          .select('id, name, code, location_type')
          .eq('location_type', 'warehouse')
          .is('company_id', null)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
      }),
    // Target — в catalog-модели нужен только для audit (decide не трогает target balance).
    // Prefer point_display (legacy), fall back to catalog_total.
    supabase
      .from('inventory_locations')
      .select('id, name, code, location_type')
      .eq('company_id', companyId)
      .in('location_type', ['point_display', 'catalog_total'])
      .eq('is_active', true)
      .order('location_type', { ascending: false }) // point_display > catalog_total alphabetically
      .limit(1)
      .maybeSingle(),
  ])

  if (sourceError) throw sourceError
  if (targetError) throw targetError

  if (!sourceLocation?.id) throw new Error('inventory-source-warehouse-not-found')
  if (!targetLocation?.id) throw new Error('inventory-target-location-not-found')

  return { sourceLocation, targetLocation }
}

async function resolveActor(params: {
  request: Request
  supabase: any
  companyId: string
}) {
  const operatorId = params.request.headers.get('x-point-operator-id')?.trim() || null
  const operatorAuthId = params.request.headers.get('x-point-operator-auth-id')?.trim() || null
  if (!operatorId || !operatorAuthId) return { operatorId: null, actorUserId: null }

  const { data, error } = await params.supabase
    .from('operator_company_assignments')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) return { operatorId: null, actorUserId: null }

  return { operatorId, actorUserId: operatorAuthId }
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canUseInventoryRequests(device.point_mode)) {
      return json({ error: 'inventory-requests-disabled-for-device' }, 403)
    }

    const { sourceLocation, targetLocation } = await resolvePointInventoryContext(supabase, device.company_id)

    const [{ data: balances, error: balancesError }, { data: requests, error: requestsError }] =
      await Promise.all([
        supabase
          .from('inventory_balances')
          .select('item_id, quantity')
          .eq('location_id', sourceLocation.id),
        supabase
          .from('inventory_requests')
          .select(
            'id, status, comment, decision_comment, created_at, approved_at, items:inventory_request_items(id, item_id, requested_qty, approved_qty, comment, item:item_id(id, name, barcode))',
          )
          .eq('requesting_company_id', device.company_id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

    if (balancesError) throw balancesError
    if (requestsError) throw requestsError

    const balanceRows = (balances || [])
      .map((row: any) => ({ item_id: String(row.item_id || ''), quantity: Number(row.quantity || 0) }))
      .filter((row: any) => row.item_id && row.quantity > 0)

    const { data: fetchedItems, error: itemsError } = await supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, sale_price, category:category_id(id, name)')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (itemsError) throw itemsError
    const items: any[] = fetchedItems || []

    const balanceMap = new Map<string, number>(balanceRows.map((row) => [row.item_id, row.quantity]))

    return json({
      ok: true,
      data: {
        company: {
          id: device.company_id,
          name: device.company?.name || 'Точка',
          code: device.company?.code || null,
        },
        sourceLocation,
        targetLocation,
        items: (items || [])
          .map((item: any) => ({
            ...item,
            warehouse_qty: balanceMap.get(item.id) || 0,
          }))
          .filter((item: any) => item.warehouse_qty > 0),
        requests: requests || [],
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-inventory-requests:get',
      message: error?.message || 'Point inventory requests GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить заявки точки' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canUseInventoryRequests(device.point_mode)) {
      return json({ error: 'inventory-requests-disabled-for-device' }, 403)
    }

    const body = (await request.json().catch(() => null)) as Body | null
    if (body?.action !== 'createRequest') return json({ error: 'invalid-action' }, 400)

    const { sourceLocation, targetLocation } = await resolvePointInventoryContext(supabase, device.company_id)
    const actor = await resolveActor({ request, supabase, companyId: device.company_id })

    const items = Array.isArray(body.payload?.items)
      ? body.payload.items
          .map((item) => ({
            item_id: String(item.item_id || '').trim(),
            requested_qty: normalizeMoney(item.requested_qty),
            comment: item.comment?.trim() || null,
          }))
          .filter((item) => item.item_id && item.requested_qty > 0)
      : []

    if (items.length === 0) return json({ error: 'inventory-request-items-required' }, 400)

    const requestId = await createInventoryRequest(supabase, {
      source_location_id: sourceLocation.id,
      target_location_id: targetLocation.id,
      requesting_company_id: device.company_id,
      comment: body.payload?.comment?.trim() || null,
      created_by: actor.actorUserId,
      items,
    })

    // Phase 1: best-effort привязка заявки к открытой смене.
    const shiftIdAttach = await requireCurrentOpenShiftId(supabase, device.company_id)
    if (shiftIdAttach && requestId) {
      await supabase.from('inventory_requests').update({ shift_id: shiftIdAttach }).eq('id', requestId)
    }

    await writeAuditLog(supabase, {
      actorUserId: actor.actorUserId,
      entityType: 'point-inventory-request',
      entityId: String(requestId || ''),
      action: 'create',
      payload: {
        point_device_id: device.id,
        company_id: device.company_id,
        operator_id: actor.operatorId,
        source_location_id: sourceLocation.id,
        target_location_id: targetLocation.id,
        item_count: items.length,
      },
    })

    void (async () => {
      try {
        const itemIds = items.map((item) => item.item_id)
        const { data: itemRows } = await supabase
          .from('inventory_items')
          .select('id, name, unit')
          .in('id', itemIds)
        const itemMap: Record<string, { name: string; unit: string }> = {}
        for (const row of itemRows || []) itemMap[String((row as any).id)] = { name: String((row as any).name || ''), unit: String((row as any).unit || 'шт') }

        const { data: staffRows } = await supabase
          .from('staff')
          .select('telegram_chat_id')
          .eq('company_id', device.company_id)
          .in('role', ['owner', 'manager'])
          .not('telegram_chat_id', 'is', null)

        const chatIds = [
          ...(staffRows || []).map((s: any) => String(s.telegram_chat_id)),
          process.env.TELEGRAM_ADMIN_CHAT_ID,
        ].filter(Boolean) as string[]

        await notifyInventoryRequestCreated({
          companyName: device.company?.name || device.company_id,
          createdByName: actor.operatorId || null,
          comment: body.payload?.comment?.trim() || null,
          items: items.map((i) => ({
            name: itemMap[i.item_id]?.name || i.item_id,
            requested_qty: i.requested_qty,
            unit: itemMap[i.item_id]?.unit || 'шт',
          })),
          chatIds: [...new Set(chatIds)],
        })
      } catch {
        /* do not break request flow */
      }
    })()

    return json({ ok: true, data: { request_id: requestId } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-inventory-requests:post',
      message: error?.message || 'Point inventory requests POST error',
    })
    return json({ error: error?.message || 'Не удалось создать заявку точки' }, 500)
  }
}
