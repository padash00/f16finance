import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { createInventoryRequest } from '@/lib/server/repositories/inventory'
import { requirePointDevice, resolveCompanyOrganizationId } from '@/lib/server/point-devices'
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
} | {
  action: 'receiveRequest'
  requestId?: string | null
} | {
  action: 'cancelRequest'
  requestId?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// PostgREST молча режет ответ до 1000 строк — каталог и остатки склада забираем
// постранично, иначе в заявке не видно товары после 1000-го.
const PAGE = 1000
async function fetchAllPages(buildQuery: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
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
    // v8: target — point_display точки (туда заявка переносит товар).
    supabase
      .from('inventory_locations')
      .select('id, name, code, location_type')
      .eq('company_id', companyId)
      .eq('location_type', 'point_display')
      .eq('is_active', true)
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

    const [balances, { data: requests, error: requestsError }] =
      await Promise.all([
        fetchAllPages((from, to) =>
          supabase
            .from('inventory_balances')
            .select('item_id, quantity')
            .eq('location_id', sourceLocation.id)
            .order('item_id')
            .range(from, to),
        ),
        supabase
          .from('inventory_requests')
          .select(
            'id, status, comment, decision_comment, created_at, approved_at, issued_at, received_at, items:inventory_request_items(id, item_id, requested_qty, approved_qty, comment, item:item_id(id, name, barcode))',
          )
          .eq('requesting_company_id', device.company_id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

    if (requestsError) throw requestsError

    const balanceRows = (balances || [])
      .map((row: any) => ({ item_id: String(row.item_id || ''), quantity: Number(row.quantity || 0) }))
      .filter((row: any) => row.item_id && row.quantity > 0)

    const requestCatalogOrgId = await resolveCompanyOrganizationId(supabase, device.company_id)
    const items: any[] = await fetchAllPages((from, to) =>
      supabase
        .from('inventory_items')
        .select('id, name, barcode, unit, sale_price, category:category_id(id, name)')
        .eq('organization_id', requestCatalogOrgId)
        .eq('is_active', true)
        .order('name', { ascending: true })
        .order('id')
        .range(from, to),
    )

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
    return json({ error: humanizeDbError(error, 'Не удалось загрузить заявки точки') }, 500)
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
    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    if (body.action === 'receiveRequest') {
      const requestId = String(body.requestId || '').trim()
      if (!requestId) return json({ error: 'request-id-required' }, 400)

      const actor = await resolveActor({ request, supabase, companyId: device.company_id })
      const { data: req, error: reqError } = await supabase
        .from('inventory_requests')
        .select('id, status, requesting_company_id, target_location_id')
        .eq('id', requestId)
        .eq('requesting_company_id', device.company_id)
        .maybeSingle()

      if (reqError) throw reqError
      if (!req?.id) return json({ error: 'inventory-request-not-found' }, 404)
      if (req.status === 'received') return json({ ok: true, data: { status: 'received', idempotent: true } })
      if (req.status !== 'issued') return json({ error: 'inventory-request-not-issued' }, 409)

      const { targetLocation } = await resolvePointInventoryContext(supabase, device.company_id)
      if (String(req.target_location_id || '') !== String(targetLocation.id || '')) {
        return json({ error: 'inventory-request-target-mismatch' }, 403)
      }

      const { error: rpcErr } = await supabase.rpc('inventory_receive_request', {
        p_request_id: requestId,
        p_actor_user_id: actor.actorUserId,
      })
      if (rpcErr) throw rpcErr

      await writeAuditLog(supabase, {
        actorUserId: actor.actorUserId,
        entityType: 'point-inventory-request',
        entityId: requestId,
        action: 'receive',
        payload: {
          point_device_id: device.id,
          company_id: device.company_id,
          operator_id: actor.operatorId,
        },
      })

      return json({ ok: true, data: { status: 'received' } })
    }

    // v2.10: отмена своей заявки, пока склад её не рассмотрел (status='new')
    if (body.action === 'cancelRequest') {
      const requestId = String((body as any).requestId || '').trim()
      if (!requestId) return json({ error: 'request-id-required' }, 400)

      const actor = await resolveActor({ request, supabase, companyId: device.company_id })
      const { data: req, error: reqError } = await supabase
        .from('inventory_requests')
        .select('id, status')
        .eq('id', requestId)
        .eq('requesting_company_id', device.company_id)
        .maybeSingle()
      if (reqError) throw reqError
      if (!req?.id) return json({ error: 'inventory-request-not-found' }, 404)
      if (req.status !== 'new') return json({ error: 'Заявку уже рассмотрел склад — отмена только через администратора' }, 409)

      const { error: updErr } = await supabase
        .from('inventory_requests')
        .update({ status: 'rejected', decision_comment: 'Отменена кассиром', updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('status', 'new')
      if (updErr) throw updErr

      await writeAuditLog(supabase, {
        actorUserId: actor.actorUserId,
        entityType: 'point-inventory-request',
        entityId: requestId,
        action: 'cancel',
        payload: { point_device_id: device.id, company_id: device.company_id, operator_id: actor.operatorId },
      })

      return json({ ok: true, data: { status: 'rejected' } })
    }

    if (body.action !== 'createRequest') return json({ error: 'invalid-action' }, 400)

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

    // v2.10: жёсткий кап — нельзя заявить больше, чем лежит на складе.
    // Клиент тоже ограничивает, но его каталог может быть устаревшим.
    {
      const itemIds = items.map((i) => i.item_id)
      const { data: balRows, error: balErr } = await supabase
        .from('inventory_balances')
        .select('item_id, quantity')
        .eq('location_id', sourceLocation.id)
        .in('item_id', itemIds)
      if (balErr) throw balErr
      const balMap = new Map<string, number>()
      for (const b of balRows || []) balMap.set(String((b as any).item_id), Number((b as any).quantity || 0))
      const over = items.find((i) => i.requested_qty > (balMap.get(i.item_id) || 0) + 0.0005)
      if (over) {
        const { data: itemRow } = await supabase.from('inventory_items').select('name').eq('id', over.item_id).maybeSingle()
        const available = balMap.get(over.item_id) || 0
        return json(
          { error: `Недостаточно на складе: «${(itemRow as any)?.name || 'товар'}» — доступно ${available}, запрошено ${over.requested_qty}` },
          400,
        )
      }
    }

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

        // staff не имеет company_id — скоуп по организации компании (была ошибка 42703).
        const { data: orgRow } = await supabase.from('companies').select('organization_id').eq('id', device.company_id).maybeSingle()
        let staffQuery = supabase
          .from('staff')
          .select('telegram_chat_id')
          .in('role', ['owner', 'manager'])
          .not('telegram_chat_id', 'is', null)
        if (orgRow?.organization_id) staffQuery = staffQuery.eq('organization_id', orgRow.organization_id)
        const { data: staffRows } = await staffQuery

        const chatIds = [
          ...(staffRows || []).map((s: any) => String(s.telegram_chat_id)),
          process.env.TELEGRAM_ADMIN_CHAT_ID,
        ].filter(Boolean) as string[]

        await notifyInventoryRequestCreated({
          requestId: requestId,
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
    return json({ error: humanizeDbError(error, 'Не удалось создать заявку точки') }, 500)
  }
}
