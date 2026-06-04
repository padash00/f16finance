import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import {
  ensureInventoryLocationAccess,
  fetchOpenTransferRequestsForLocation,
  postInventoryStocktake,
} from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

const UUID_RE = /^[0-9a-fA-F-]{36}$/
const num = (v: unknown) => {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const actId = url.searchParams.get('act')
    const formLocation = url.searchParams.get('form')

    // ── Данные для формы создания (операторы точки + категории) ──────────────
    if (formLocation && UUID_RE.test(formLocation)) {
      const { data: loc } = await supabase.from('inventory_locations').select('id, company_id, name, location_type').eq('id', formLocation).maybeSingle()
      const companyId = (loc as any)?.company_id || null
      const [assignRes, catRes] = await Promise.all([
        companyId
          ? supabase.from('operator_company_assignments').select('operator_id').eq('company_id', companyId).eq('is_active', true)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('inventory_categories').select('id, name').eq('is_active', true).order('name'),
      ])
      const opIds = Array.from(new Set(((assignRes as any).data || []).map((r: any) => String(r.operator_id)).filter(Boolean)))
      const { data: ops } = opIds.length
        ? await supabase.from('operators').select('id, name, short_name').in('id', opIds).eq('is_active', true).order('name')
        : { data: [] as any[] }
      return json({
        ok: true,
        data: {
          location: loc || null,
          operators: ((ops as any[]) || []).map((o) => ({ id: String(o.id), name: o.name || o.short_name || 'Оператор' })),
          categories: ((catRes as any).data || []).map((c: any) => ({ id: String(c.id), name: c.name })),
        },
      })
    }

    // ── Детали акта ──────────────────────────────────────────────────────────
    if (actId && UUID_RE.test(actId)) {
      const { data: act } = await supabase.from('inventory_audit_acts').select('*').eq('id', actId).maybeSingle()
      if (!act) return json({ error: 'act-not-found' }, 404)
      const [assigns, snap, counts, loc] = await Promise.all([
        supabase.from('inventory_audit_assignments').select('id, operator_id, category_id, label').eq('act_id', actId),
        supabase.from('inventory_audit_snapshot').select('item_id, expected_qty').eq('act_id', actId),
        supabase.from('inventory_audit_counts').select('item_id, counted_qty, counted_by, counted_at').eq('act_id', actId),
        supabase.from('inventory_locations').select('id, name, location_type, company_id').eq('id', (act as any).location_id).maybeSingle(),
      ])
      const snapRows = (snap.data || []) as any[]
      const countRows = (counts.data || []) as any[]
      const itemIds = Array.from(new Set([...snapRows.map((r) => String(r.item_id)), ...countRows.map((r) => String(r.item_id))]))
      const opIds = Array.from(new Set([...((assigns.data || []) as any[]).map((r) => String(r.operator_id)), ...countRows.map((r) => String(r.counted_by || '')).filter(Boolean)]))
      const catIds = Array.from(new Set(((assigns.data || []) as any[]).map((r) => String(r.category_id || '')).filter(Boolean)))
      const [items, opers, cats] = await Promise.all([
        itemIds.length ? supabase.from('inventory_items').select('id, name, category_id').in('id', itemIds) : Promise.resolve({ data: [] as any[] }),
        opIds.length ? supabase.from('operators').select('id, name, short_name').in('id', opIds) : Promise.resolve({ data: [] as any[] }),
        catIds.length ? supabase.from('inventory_categories').select('id, name').in('id', catIds) : Promise.resolve({ data: [] as any[] }),
      ])
      const itemName = new Map(((items as any).data || []).map((i: any) => [String(i.id), i.name as string]))
      const opName = new Map(((opers as any).data || []).map((o: any) => [String(o.id), (o.name || o.short_name || 'Оператор') as string]))
      const catName = new Map(((cats as any).data || []).map((c: any) => [String(c.id), c.name as string]))
      const expectedBy = new Map(snapRows.map((r) => [String(r.item_id), num(r.expected_qty)]))

      // отчёт по позициям (расхождение раскрывается только когда есть подсчёт)
      const report = countRows.map((r) => {
        const expected = expectedBy.get(String(r.item_id)) ?? 0
        const counted = num(r.counted_qty)
        return {
          item_id: String(r.item_id),
          name: itemName.get(String(r.item_id)) || 'Товар',
          expected,
          counted,
          variance: counted - expected,
          countedBy: r.counted_by ? opName.get(String(r.counted_by)) || null : null,
          counted_at: r.counted_at,
        }
      })

      return json({
        ok: true,
        data: {
          act,
          location: loc.data || null,
          assignments: ((assigns.data || []) as any[]).map((a) => ({
            id: String(a.id),
            operator_id: String(a.operator_id),
            operatorName: opName.get(String(a.operator_id)) || 'Оператор',
            category_id: a.category_id ? String(a.category_id) : null,
            categoryName: a.category_id ? catName.get(String(a.category_id)) || null : 'Вся локация',
            label: a.label || null,
          })),
          totalItems: snapRows.length,
          countedItems: countRows.length,
          report,
        },
      })
    }

    // ── Список актов ─────────────────────────────────────────────────────────
    const { data: acts } = await supabase
      .from('inventory_audit_acts')
      .select('id, company_id, location_id, status, comment, opened_at, closed_at, stocktake_id')
      .order('opened_at', { ascending: false })
      .limit(50)
    const actRows = (acts || []) as any[]
    const locIds = Array.from(new Set(actRows.map((a) => String(a.location_id))))
    const actIds = actRows.map((a) => String(a.id))
    const [locs, snapCounts, cntCounts] = await Promise.all([
      locIds.length ? supabase.from('inventory_locations').select('id, name, location_type, company_id, companies(name)').in('id', locIds) : Promise.resolve({ data: [] as any[] }),
      actIds.length ? supabase.from('inventory_audit_snapshot').select('act_id').in('act_id', actIds) : Promise.resolve({ data: [] as any[] }),
      actIds.length ? supabase.from('inventory_audit_counts').select('act_id').in('act_id', actIds) : Promise.resolve({ data: [] as any[] }),
    ])
    const locById = new Map(((locs as any).data || []).map((l: any) => [String(l.id), l]))
    const totalByAct = new Map<string, number>()
    for (const r of ((snapCounts as any).data || []) as any[]) totalByAct.set(String(r.act_id), (totalByAct.get(String(r.act_id)) || 0) + 1)
    const countedByAct = new Map<string, number>()
    for (const r of ((cntCounts as any).data || []) as any[]) countedByAct.set(String(r.act_id), (countedByAct.get(String(r.act_id)) || 0) + 1)

    return json({
      ok: true,
      data: actRows.map((a) => {
        const loc = locById.get(String(a.location_id)) as any
        return {
          id: String(a.id),
          status: a.status,
          comment: a.comment || null,
          opened_at: a.opened_at,
          closed_at: a.closed_at,
          locationName: loc ? `${loc.companies?.name ? loc.companies.name + ' · ' : ''}${loc.location_type === 'point_display' ? 'Витрина' : loc.location_type === 'warehouse' ? 'Склад' : loc.name}` : '—',
          totalItems: totalByAct.get(String(a.id)) || 0,
          countedItems: countedByAct.get(String(a.id)) || 0,
        }
      }),
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/audit.GET', message: error?.message || 'audit GET error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const companyScope = await resolveCompanyScope({ activeOrganizationId: access.activeOrganization?.id || null, isSuperAdmin: access.isSuperAdmin })
    const inventoryScope = { organizationId: access.activeOrganization?.id || null, allowedCompanyIds: companyScope.allowedCompanyIds, isSuperAdmin: access.isSuperAdmin }
    const body = (await request.json().catch(() => null)) as any
    const action = String(body?.action || '')

    // ── Создать акт ───────────────────────────────────────────────────────────
    if (action === 'create') {
      const locationId = String(body?.location_id || '').trim()
      if (!UUID_RE.test(locationId)) return json({ error: 'location-required' }, 400)
      await ensureInventoryLocationAccess(supabase as any, locationId, inventoryScope)

      const { data: loc } = await supabase.from('inventory_locations').select('id, company_id').eq('id', locationId).maybeSingle()
      const companyId = (loc as any)?.company_id || null

      const assignments = Array.isArray(body?.assignments) ? body.assignments : []
      if (assignments.length === 0) return json({ error: 'assignments-required' }, 400)

      const { data: act, error: actErr } = await supabase
        .from('inventory_audit_acts')
        .insert({ company_id: companyId, location_id: locationId, status: 'open', comment: String(body?.comment || '').trim() || null, opened_by: actorUserId })
        .select('id, opened_at')
        .single()
      if (actErr) throw actErr
      const actId = String((act as any).id)

      // назначения
      const assignRows = assignments
        .map((a: any) => ({
          act_id: actId,
          operator_id: String(a.operator_id || '').trim(),
          category_id: a.category_id && UUID_RE.test(String(a.category_id)) ? String(a.category_id) : null,
          label: String(a.label || '').trim() || null,
        }))
        .filter((a: any) => UUID_RE.test(a.operator_id))
      if (assignRows.length) {
        const { error } = await supabase.from('inventory_audit_assignments').insert(assignRows)
        if (error) throw error
      }

      // снимок текущих остатков локации
      const { data: balances } = await supabase.from('inventory_balances').select('item_id, quantity').eq('location_id', locationId)
      const snapRows = ((balances as any[]) || []).map((b: any) => ({ act_id: actId, item_id: String(b.item_id), expected_qty: num(b.quantity) }))
      for (let i = 0; i < snapRows.length; i += 500) {
        const { error } = await supabase.from('inventory_audit_snapshot').insert(snapRows.slice(i, i + 500))
        if (error) throw error
      }

      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-audit-act', entityId: actId, action: 'open', payload: { location_id: locationId, assignments: assignRows.length, items: snapRows.length } })
      return json({ ok: true, data: { id: actId } })
    }

    // ── Закрыть акт ───────────────────────────────────────────────────────────
    if (action === 'close') {
      const actId = String(body?.act_id || '').trim()
      if (!UUID_RE.test(actId)) return json({ error: 'act-required' }, 400)
      const { data: act } = await supabase.from('inventory_audit_acts').select('*').eq('id', actId).maybeSingle()
      if (!act) return json({ error: 'act-not-found' }, 404)
      if ((act as any).status !== 'open') return json({ error: 'act-not-open' }, 409)
      const locationId = String((act as any).location_id)
      const openedAt = String((act as any).opened_at)

      const openTransfers = await fetchOpenTransferRequestsForLocation(supabase as any, locationId, inventoryScope)
      if (openTransfers.length > 0) {
        return json({ error: 'inventory-stocktake-open-transfers', message: 'Есть заявки склад ↔ витрина в пути. Сначала завершите их.' }, 409)
      }

      const [snap, counts] = await Promise.all([
        supabase.from('inventory_audit_snapshot').select('item_id, expected_qty').eq('act_id', actId),
        supabase.from('inventory_audit_counts').select('item_id, counted_qty, counted_at').eq('act_id', actId),
      ])
      const expectedBy = new Map(((snap.data || []) as any[]).map((r) => [String(r.item_id), num(r.expected_qty)]))
      const countRows = (counts.data || []) as any[]
      if (countRows.length === 0) return json({ error: 'nothing-counted' }, 400)

      // движения локации с момента открытия — для учёта продаж после подсчёта позиции
      const { data: moves } = await supabase
        .from('inventory_movements')
        .select('item_id, quantity, from_location_id, to_location_id, created_at')
        .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
        .gte('created_at', openedAt)
        .limit(5000)
      const movesByItem = new Map<string, Array<{ delta: number; at: string }>>()
      for (const m of ((moves as any[]) || [])) {
        const itemId = String(m.item_id)
        const inn = String(m.to_location_id) === locationId
        const out = String(m.from_location_id) === locationId
        const delta = (inn ? num(m.quantity) : 0) - (out ? num(m.quantity) : 0)
        if (delta === 0) continue
        const list = movesByItem.get(itemId) || []
        list.push({ delta, at: String(m.created_at) })
        movesByItem.set(itemId, list)
      }

      const stocktakeItems: Array<{ item_id: string; actual_qty: number; comment: string | null }> = []
      const report: Array<{ item_id: string; counted: number; expected: number; variance: number; soldAfter: number; final: number }> = []
      for (const r of countRows) {
        const itemId = String(r.item_id)
        const counted = num(r.counted_qty)
        const expected = expectedBy.get(itemId) ?? 0
        const countedAt = String(r.counted_at)
        // изменения остатка ПОСЛЕ того, как позицию посчитали
        let deltaAfter = 0
        for (const m of movesByItem.get(itemId) || []) if (m.at > countedAt) deltaAfter += m.delta
        const final = Math.max(0, counted + deltaAfter)
        stocktakeItems.push({ item_id: itemId, actual_qty: final, comment: null })
        report.push({ item_id: itemId, counted, expected, variance: counted - expected, soldAfter: -Math.min(0, deltaAfter), final })
      }

      const result = await postInventoryStocktake(supabase as any, {
        location_id: locationId,
        counted_at: new Date().toISOString().slice(0, 10),
        comment: `Аудит-акт ${actId.slice(0, 8)}`,
        created_by: actorUserId,
        items: stocktakeItems,
      })

      await supabase.from('inventory_audit_acts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: actorUserId, stocktake_id: (result as any)?.stocktake_id || (result as any)?.id || null }).eq('id', actId)
      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-audit-act', entityId: actId, action: 'close', payload: { counted: countRows.length } })

      return json({ ok: true, data: { stocktake_id: (result as any)?.stocktake_id || null, report } })
    }

    // ── Отменить акт ──────────────────────────────────────────────────────────
    if (action === 'cancel') {
      const actId = String(body?.act_id || '').trim()
      if (!UUID_RE.test(actId)) return json({ error: 'act-required' }, 400)
      await supabase.from('inventory_audit_acts').update({ status: 'cancelled', closed_at: new Date().toISOString(), closed_by: actorUserId }).eq('id', actId).eq('status', 'open')
      return json({ ok: true })
    }

    return json({ error: 'invalid-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/audit.POST', message: error?.message || 'audit POST error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
