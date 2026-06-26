import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { listOrganizationOperatorIds, resolveCompanyScope } from '@/lib/server/organizations'
import {
  ensureInventoryLocationAccess,
  fetchOpenTransferRequestsForLocation,
  postInventoryStocktake,
  type InventoryScope,
} from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

// Мутации акта (создать/закрыть/отменить/пересчёт/решение) меняют остатки и создают
// долги — требуем owner/manager, а не любую staffRole ('other' не должен закрывать акт).
function canMutateAudit(access: { isSuperAdmin: boolean; staffRole?: string; staffMember?: { role?: string } }) {
  if (access.isSuperAdmin) return true
  const role = String(access.staffMember?.role || access.staffRole || '').toLowerCase()
  return role === 'owner' || role === 'manager'
}

function resolveInventoryScope(access: any, allowedCompanyIds: string[] | null): InventoryScope {
  return { organizationId: access.activeOrganization?.id || null, allowedCompanyIds, isSuperAdmin: access.isSuperAdmin }
}

// Загружает акт и проверяет доступ к его локации (тенант-изоляция).
// Возвращает { act } либо { response } с готовым 403/404.
async function loadActWithGuard(
  supabase: any,
  actId: string,
  scope: InventoryScope,
): Promise<{ act: any } | { response: NextResponse }> {
  const { data: act } = await supabase.from('inventory_audit_acts').select('*').eq('id', actId).maybeSingle()
  if (!act) return { response: json({ error: 'act-not-found' }, 404) }
  try {
    await ensureInventoryLocationAccess(supabase, String((act as any).location_id), scope)
  } catch {
    return { response: json({ error: 'forbidden' }, 403) }
  }
  return { act }
}

const UUID_RE = /^[0-9a-fA-F-]{36}$/
const num = (v: unknown) => {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0
}

// Чтение товаров чанками: один .in() на сотни UUID превышает лимит URL шлюза.
async function fetchItemsByIds(supabase: any, ids: string[], columns: string) {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('inventory_items').select(columns).in('id', ids.slice(i, i + 200))
    if (error) throw error
    if (data) out.push(...(data as any[]))
  }
  return out
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({ activeOrganizationId: access.activeOrganization?.id || null, isSuperAdmin: access.isSuperAdmin })
    const inventoryScope = resolveInventoryScope(access, companyScope.allowedCompanyIds)
    const url = new URL(request.url)
    const actId = url.searchParams.get('act')
    const formLocation = url.searchParams.get('form')

    // ── Данные для формы создания (операторы точки + категории) ──────────────
    if (formLocation && UUID_RE.test(formLocation)) {
      try {
        await ensureInventoryLocationAccess(supabase, formLocation, inventoryScope)
      } catch {
        return json({ error: 'forbidden' }, 403)
      }
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

      // Операторы с ДРУГИХ точек организации — можно подключить в помощь. Подпись
      // содержит название их точки. Тенант-изоляция: только операторы своей орг.
      const allowedOpIds = await listOrganizationOperatorIds({ activeOrganizationId: access.activeOrganization?.id || null, isSuperAdmin: access.isSuperAdmin })
      const thisSet = new Set(opIds)
      const otherIds = allowedOpIds.filter((id) => !thisSet.has(id))
      let otherOperators: Array<{ id: string; name: string }> = []
      if (otherIds.length) {
        const [otherOpsRes, otherAssignRes] = await Promise.all([
          supabase.from('operators').select('id, name, short_name').in('id', otherIds).eq('is_active', true).order('name'),
          supabase.from('operator_company_assignments').select('operator_id, company:company_id(name)').in('operator_id', otherIds).eq('is_active', true),
        ])
        const pointByOp = new Map<string, string>()
        for (const r of ((otherAssignRes as any).data || []) as any[]) {
          const cmp = Array.isArray(r.company) ? r.company[0] : r.company
          const nm = cmp?.name ? String(cmp.name) : ''
          const opId = String(r.operator_id)
          if (nm && !pointByOp.has(opId)) pointByOp.set(opId, nm)
        }
        otherOperators = ((otherOpsRes as any).data || []).map((o: any) => {
          const base = o.name || o.short_name || 'Оператор'
          const pt = pointByOp.get(String(o.id))
          return { id: String(o.id), name: pt ? `${base} · ${pt}` : base }
        })
      }

      return json({
        ok: true,
        data: {
          location: loc || null,
          operators: ((ops as any[]) || []).map((o) => ({ id: String(o.id), name: o.name || o.short_name || 'Оператор' })),
          otherOperators,
          categories: ((catRes as any).data || []).map((c: any) => ({ id: String(c.id), name: c.name })),
        },
      })
    }

    // ── Детали акта ──────────────────────────────────────────────────────────
    if (actId && UUID_RE.test(actId)) {
      const guarded = await loadActWithGuard(supabase, actId, inventoryScope)
      if ('response' in guarded) return guarded.response
      const act = guarded.act
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
        fetchItemsByIds(supabase, itemIds, 'id, name, category_id'),
        opIds.length ? supabase.from('operators').select('id, name, short_name').in('id', opIds) : Promise.resolve({ data: [] as any[] }),
        catIds.length ? supabase.from('inventory_categories').select('id, name').in('id', catIds) : Promise.resolve({ data: [] as any[] }),
      ])
      const itemName = new Map((items || []).map((i: any) => [String(i.id), i.name as string]))
      const opName = new Map(((opers as any).data || []).map((o: any) => [String(o.id), (o.name || o.short_name || 'Оператор') as string]))
      const catName = new Map(((cats as any).data || []).map((c: any) => [String(c.id), c.name as string]))
      const expectedBy = new Map(snapRows.map((r) => [String(r.item_id), num(r.expected_qty)]))

      // счёты сгруппированы по товару (в режиме double их может быть несколько)
      const countsByItem = new Map<string, Array<{ qty: number; by: string | null; at: string }>>()
      for (const r of countRows) {
        const id = String(r.item_id)
        const l = countsByItem.get(id) || []
        l.push({ qty: num(r.counted_qty), by: r.counted_by ? String(r.counted_by) : null, at: String(r.counted_at) })
        countsByItem.set(id, l)
      }
      const report = Array.from(countsByItem.entries()).map(([itemId, list]) => {
        const expected = expectedBy.get(itemId) ?? 0
        const distinct = Array.from(new Set(list.map((x) => x.qty)))
        const conflict = distinct.length > 1
        const counted = list.reduce((a, b) => (b.at > a.at ? b : a)).qty
        return {
          item_id: itemId,
          name: itemName.get(itemId) || 'Товар',
          expected,
          counted,
          variance: counted - expected,
          conflict,
          counts: list.map((x) => ({ qty: x.qty, by: x.by ? opName.get(x.by) || null : null })),
          countedBy: list.length === 1 && list[0].by ? opName.get(list[0].by) || null : null,
        }
      })

      // прогресс по операторам (сколько из своей секции посчитал каждый)
      const itemCat = new Map((items || []).map((i: any) => [String(i.id), i.category_id ? String(i.category_id) : null]))
      const snapItemIds = snapRows.map((r) => String(r.item_id))
      const opCats = new Map<string, { all: boolean; cats: Set<string> }>()
      for (const a of (assigns.data || []) as any[]) {
        const op = String(a.operator_id)
        const e = opCats.get(op) || { all: false, cats: new Set<string>() }
        if (!a.category_id) e.all = true
        else e.cats.add(String(a.category_id))
        opCats.set(op, e)
      }
      const countedByOp = new Map<string, number>()
      for (const r of countRows) {
        const op = String(r.counted_by || '')
        if (op) countedByOp.set(op, (countedByOp.get(op) || 0) + 1)
      }
      const progress = Array.from(opCats.entries()).map(([op, sec]) => ({
        operatorName: opName.get(op) || 'Оператор',
        counted: countedByOp.get(op) || 0,
        total: snapItemIds.filter((id) => sec.all || (itemCat.get(id) && sec.cats.has(itemCat.get(id) as string))).length,
      }))

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
          progress,
          totalItems: snapRows.length,
          countedItems: countsByItem.size,
          report,
        },
      })
    }

    // ── Список актов (только своей орг/точек) ─────────────────────────────────
    let actsQuery = supabase
      .from('inventory_audit_acts')
      .select('id, company_id, location_id, status, comment, opened_at, closed_at, stocktake_id')
      .order('opened_at', { ascending: false })
      .limit(50)
    if (companyScope.allowedCompanyIds) {
      // [] (скоуп без компаний) → .in(..., []) вернёт 0 строк (NEVER-pattern)
      actsQuery = actsQuery.in('company_id', companyScope.allowedCompanyIds)
    }
    const { data: acts } = await actsQuery
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
    if (!canMutateAudit(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const companyScope = await resolveCompanyScope({ activeOrganizationId: access.activeOrganization?.id || null, isSuperAdmin: access.isSuperAdmin })
    const inventoryScope = resolveInventoryScope(access, companyScope.allowedCompanyIds)
    const body = (await request.json().catch(() => null)) as any
    const action = String(body?.action || '')

    // ── Создать акт ───────────────────────────────────────────────────────────
    if (action === 'create') {
      const locationId = String(body?.location_id || '').trim()
      if (!UUID_RE.test(locationId)) return json({ error: 'location-required' }, 400)
      try {
        await ensureInventoryLocationAccess(supabase as any, locationId, inventoryScope)
      } catch {
        return json({ error: 'forbidden' }, 403)
      }

      const { data: loc } = await supabase.from('inventory_locations').select('id, company_id').eq('id', locationId).maybeSingle()
      const companyId = (loc as any)?.company_id || null

      const assignments = Array.isArray(body?.assignments) ? body.assignments : []
      if (assignments.length === 0) return json({ error: 'assignments-required' }, 400)

      // Тенант-изоляция: каждый назначаемый оператор должен принадлежать организации
      // (оператор с ДРУГОЙ точки своей орг — допустим; чужой орг — нет). Проверяем ДО
      // создания акта, чтобы не плодить висячие акты при отказе.
      const requestedOpIds: string[] = Array.from(new Set(assignments.map((a: any) => String(a.operator_id || '').trim()).filter((id: string) => UUID_RE.test(id))))
      if (requestedOpIds.length === 0) return json({ error: 'assignments-required' }, 400)
      const allowedOpSet = new Set(await listOrganizationOperatorIds({ activeOrganizationId: access.activeOrganization?.id || null, isSuperAdmin: access.isSuperAdmin }))
      if (requestedOpIds.some((id) => !allowedOpSet.has(id))) {
        return json({ error: 'forbidden-operator', message: 'Можно назначать только операторов своей организации.' }, 403)
      }

      const { data: act, error: actErr } = await supabase
        .from('inventory_audit_acts')
        .insert({ company_id: companyId, location_id: locationId, status: 'open', mode: body?.mode === 'double' ? 'double' : 'single', comment: String(body?.comment || '').trim() || null, opened_by: actorUserId })
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
      // Тенант-изоляция: нельзя закрыть чужой акт (и заодно проверка существования).
      const guarded = await loadActWithGuard(supabase, actId, inventoryScope)
      if ('response' in guarded) return guarded.response
      const act = guarded.act
      if ((act as any).status !== 'open') return json({ error: 'act-not-open' }, 409)
      const locationId = String((act as any).location_id)
      const openedAt = String((act as any).opened_at)

      // Принудительное закрытие: обходит блокировки (заявки в пути, ничего не
      // посчитано, расхождения двойного счёта). Опасно — только owner/суперадмин.
      const force = body?.force === true
      if (force) {
        const role = String(access.staffMember?.role || access.staffRole || '').toLowerCase()
        if (!access.isSuperAdmin && role !== 'owner') return json({ error: 'forbidden', message: 'Принудительно закрыть акт может только владелец.' }, 403)
      }

      const openTransfers = await fetchOpenTransferRequestsForLocation(supabase as any, locationId, inventoryScope)
      if (!force && openTransfers.length > 0) {
        return json({ error: 'inventory-stocktake-open-transfers', message: 'Есть заявки склад ↔ витрина в пути. Сначала завершите их.' }, 409)
      }

      const [snap, counts] = await Promise.all([
        supabase.from('inventory_audit_snapshot').select('item_id, expected_qty').eq('act_id', actId),
        supabase.from('inventory_audit_counts').select('item_id, counted_qty, counted_at, counted_by').eq('act_id', actId),
      ])
      const expectedBy = new Map(((snap.data || []) as any[]).map((r) => [String(r.item_id), num(r.expected_qty)]))
      const countRows = (counts.data || []) as any[]
      if (!force && countRows.length === 0) return json({ error: 'nothing-counted' }, 400)

      // движения локации с момента открытия — для учёта продаж/приходов во время счёта
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

      const actMode = String((act as any).mode || 'single')
      // группируем счёты по товару (в double их несколько — от разных операторов)
      const grouped = new Map<string, Array<{ qty: number; at: string; by: string | null }>>()
      for (const r of countRows) {
        const id = String(r.item_id)
        const l = grouped.get(id) || []
        l.push({ qty: num(r.counted_qty), at: String(r.counted_at), by: r.counted_by ? String(r.counted_by) : null })
        grouped.set(id, l)
      }
      const conflicts: string[] = []
      const stocktakeItems: Array<{ item_id: string; actual_qty: number; comment: string | null }> = []
      type ReportRow = {
        item_id: string
        name: string
        expected: number
        counted: number
        movedIn: number // приход/перевод-в во время акта
        movedOut: number // продажи/перевод-из/списание во время акта (модуль)
        final: number // записано в остаток
        variance: number // итог − система (на сколько изменился остаток)
        shrinkage: number // необъяснённая недостача (исключая движения)
        surplus: number // необъяснённый излишек
        purchase_price: number // закупочная цена позиции (для недостачи в ₸)
      }
      const report: ReportRow[] = []
      // Недостача товара для долга: реальная нехватка на момент подсчёта =
      // (ожидалось при открытии + движения ДО подсчёта) − посчитано. Так продажи
      // во время ревизии не превращаются в «недостачу» оператора.
      const shortageByItem = new Map<string, { qty: number; op: string | null }>()
      for (const [itemId, list] of grouped) {
        const distinct = Array.from(new Set(list.map((x) => x.qty)))
        if (distinct.length > 1 && actMode === 'double' && !force) {
          conflicts.push(itemId)
          continue
        }
        const latest = list.reduce((a, b) => (b.at > a.at ? b : a))
        const counted = latest.qty
        const expected = expectedBy.get(itemId) ?? 0
        let deltaAfter = 0
        let deltaBefore = 0
        let movedIn = 0
        let movedOut = 0
        for (const m of movesByItem.get(itemId) || []) {
          if (m.at > latest.at) deltaAfter += m.delta
          else deltaBefore += m.delta
          if (m.delta > 0) movedIn += m.delta
          else movedOut += -m.delta
        }
        const final = Math.max(0, counted + deltaAfter)
        // Необъяснённое расхождение: факт оператора против «ожидалось на момент счёта»
        // (= снимок + движения ДО счёта). Движения не считаются пропажей.
        const expectedAtCount = expected + deltaBefore
        const shrinkage = Math.max(0, expectedAtCount - counted)
        const surplus = Math.max(0, counted - expectedAtCount)
        stocktakeItems.push({ item_id: itemId, actual_qty: final, comment: null })
        report.push({ item_id: itemId, name: '', expected, counted, movedIn, movedOut, final, variance: final - expected, shrinkage, surplus, purchase_price: 0 })
        if (shrinkage > 0) shortageByItem.set(itemId, { qty: shrinkage, op: latest.by })
      }
      if (conflicts.length > 0) {
        return json({ error: 'unresolved-conflicts', message: `Расхождение между счётчиками: ${conflicts.length} поз. Нужен пересчёт или решение владельца.`, conflicts }, 409)
      }

      // имена + закупочные цены товаров для отчёта (недостача/излишек в ₸)
      const reportItemIds = report.map((r) => r.item_id)
      if (reportItemIds.length) {
        const nameRows = await fetchItemsByIds(supabase, reportItemIds, 'id, name, default_purchase_price')
        const nameBy = new Map(nameRows.map((i: any) => [String(i.id), String(i.name || '')]))
        const priceBy = new Map(nameRows.map((i: any) => [String(i.id), num((i as any).default_purchase_price)]))
        for (const r of report) {
          r.name = nameBy.get(r.item_id) || 'Товар'
          r.purchase_price = priceBy.get(r.item_id) || 0
        }
      }

      // Атомарно «забираем» акт open → closed ДО записи стока. Если затронуто 0 строк —
      // акт уже закрыт другим запросом → не применяем стоктейк повторно.
      const closedAt = new Date().toISOString()
      const { data: claimed, error: claimErr } = await supabase
        .from('inventory_audit_acts')
        .update({ status: 'closed', closed_at: closedAt, closed_by: actorUserId })
        .eq('id', actId)
        .eq('status', 'open')
        .select('id')
      if (claimErr) throw claimErr
      if (!claimed || (claimed as any[]).length === 0) return json({ error: 'act-not-open' }, 409)

      let result: any = null
      // При force без единой посчитанной позиции стоктейка нет — просто закрываем акт
      // (RPC падает на пустом списке, и трогать остатки незачем).
      if (stocktakeItems.length > 0) {
        try {
          result = await postInventoryStocktake(supabase as any, {
            location_id: locationId,
            counted_at: new Date().toISOString().slice(0, 10),
            comment: `Аудит-акт ${actId.slice(0, 8)}${force ? ' (принудительно)' : ''}`,
            created_by: actorUserId,
            items: stocktakeItems,
          })
        } catch (stocktakeError) {
          // Откатываем статус, чтобы акт снова можно было закрыть.
          await supabase.from('inventory_audit_acts').update({ status: 'open', closed_at: null, closed_by: null }).eq('id', actId)
          throw stocktakeError
        }
      }

      await supabase.from('inventory_audit_acts').update({ stocktake_id: (result as any)?.stocktake_id || (result as any)?.id || null }).eq('id', actId)

      // Опция: недостачу повесить долгом на ответственного оператора (удержится из ЗП).
      let debtsCreated = 0
      if (body?.assignDebt === true && shortageByItem.size > 0) {
        const itemIds = Array.from(shortageByItem.keys())
        const costItems = itemIds.length ? await fetchItemsByIds(supabase, itemIds, 'id, default_purchase_price') : []
        const costBy = new Map(costItems.map((i: any) => [String(i.id), num((i as any).default_purchase_price)]))
        const companyId = (act as any)?.company_id || null
        const d = new Date()
        const dow = (d.getUTCDay() + 6) % 7
        const weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10)
        const today = new Date().toISOString().slice(0, 10)
        const shortByOp = new Map<string, number>()
        for (const [itemId, { qty, op }] of shortageByItem) {
          if (!op || qty <= 0) continue
          shortByOp.set(op, (shortByOp.get(op) || 0) + qty * (costBy.get(itemId) || 0))
        }
        const debtRows = Array.from(shortByOp.entries())
          .filter(([, amt]) => amt > 0.5)
          .map(([op, amt]) => ({ company_id: companyId, operator_id: op, amount: Math.round(amt), comment: `Недостача по аудит-акту ${actId.slice(0, 8)}`, client_name: 'Недостача (ревизия)', status: 'active', week_start: weekStart, date: today, created_by: actorUserId }))
        if (debtRows.length) {
          const { error: debtErr } = await supabase.from('debts').insert(debtRows)
          if (!debtErr) debtsCreated = debtRows.length
          else await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/audit.close:debts', message: debtErr.message })
        }
      }

      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-audit-act', entityId: actId, action: force ? 'force-close' : 'close', payload: { counted: countRows.length, debtsCreated, force } })

      // Сводка: движения во время ревизии (учтены в факте) + необъяснённое расхождение.
      const summary = report.reduce(
        (acc, r) => {
          if (r.movedIn > 0 || r.movedOut > 0) acc.movedItems += 1
          acc.movedIn += r.movedIn
          acc.movedOut += r.movedOut
          acc.shrinkageQty += r.shrinkage
          acc.surplusQty += r.surplus
          acc.shrinkageValue += r.shrinkage * (r.purchase_price || 0)
          acc.surplusValue += r.surplus * (r.purchase_price || 0)
          if (r.shrinkage > 0) acc.shrinkageItems += 1
          if (r.surplus > 0) acc.surplusItems += 1
          return acc
        },
        { movedItems: 0, movedIn: 0, movedOut: 0, shrinkageItems: 0, shrinkageQty: 0, surplusItems: 0, surplusQty: 0, shrinkageValue: 0, surplusValue: 0 },
      )

      return json({ ok: true, data: { stocktake_id: (result as any)?.stocktake_id || null, report, summary, debtsCreated } })
    }

    // ── Отменить акт ──────────────────────────────────────────────────────────
    if (action === 'cancel') {
      const actId = String(body?.act_id || '').trim()
      if (!UUID_RE.test(actId)) return json({ error: 'act-required' }, 400)
      const guarded = await loadActWithGuard(supabase, actId, inventoryScope)
      if ('response' in guarded) return guarded.response
      await supabase.from('inventory_audit_acts').update({ status: 'cancelled', closed_at: new Date().toISOString(), closed_by: actorUserId }).eq('id', actId).eq('status', 'open')
      return json({ ok: true })
    }

    // ── Пересчёт позиции: удаляем счёты, операторы считают заново ─────────────
    if (action === 'recount') {
      const actId = String(body?.act_id || '').trim()
      const itemId = String(body?.item_id || '').trim()
      if (!UUID_RE.test(actId) || !UUID_RE.test(itemId)) return json({ error: 'bad-params' }, 400)
      const guarded = await loadActWithGuard(supabase, actId, inventoryScope)
      if ('response' in guarded) return guarded.response
      if ((guarded.act as any).status !== 'open') return json({ error: 'act-not-open' }, 409)
      await supabase.from('inventory_audit_counts').delete().eq('act_id', actId).eq('item_id', itemId)
      return json({ ok: true })
    }

    // ── Решить расхождение: зафиксировать итоговое количество ──────────────────
    if (action === 'resolve') {
      const actId = String(body?.act_id || '').trim()
      const itemId = String(body?.item_id || '').trim()
      if (!UUID_RE.test(actId) || !UUID_RE.test(itemId)) return json({ error: 'bad-params' }, 400)
      const guarded = await loadActWithGuard(supabase, actId, inventoryScope)
      if ('response' in guarded) return guarded.response
      if ((guarded.act as any).status !== 'open') return json({ error: 'act-not-open' }, 409)
      const qty = Math.max(0, num(body?.qty))
      await supabase.from('inventory_audit_counts').delete().eq('act_id', actId).eq('item_id', itemId)
      const { error } = await supabase.from('inventory_audit_counts').insert({ act_id: actId, item_id: itemId, counted_qty: qty, counted_by: null, counted_at: new Date().toISOString() })
      if (error) throw error
      return json({ ok: true })
    }

    // ── Откатить проведённый акт: вернуть остатки и убрать созданные долги ──────
    if (action === 'revert') {
      const actId = String(body?.act_id || '').trim()
      if (!UUID_RE.test(actId)) return json({ error: 'act-required' }, 400)
      // Откат меняет остатки и удаляет долги — только владелец/суперадмин.
      const role = String(access.staffMember?.role || access.staffRole || '').toLowerCase()
      if (!access.isSuperAdmin && role !== 'owner') return json({ error: 'forbidden', message: 'Откатить ревизию может только владелец.' }, 403)

      const guarded = await loadActWithGuard(supabase, actId, inventoryScope)
      if ('response' in guarded) return guarded.response
      const act = guarded.act
      if ((act as any).status !== 'closed') return json({ error: 'act-not-closed', message: 'Откатить можно только проведённый (закрытый) акт.' }, 409)
      const locationId = String((act as any).location_id)
      const stocktakeId = (act as any).stocktake_id ? String((act as any).stocktake_id) : null

      // Атомарно «забираем» акт closed → cancelled, чтобы исключить двойной откат.
      const { data: claimed, error: claimErr } = await supabase
        .from('inventory_audit_acts')
        .update({ status: 'cancelled' })
        .eq('id', actId)
        .eq('status', 'closed')
        .select('id')
      if (claimErr) throw claimErr
      if (!claimed || (claimed as any[]).length === 0) return json({ error: 'act-not-closed' }, 409)

      let reversedItems = 0
      try {
        if (stocktakeId) {
          const { data: stItems } = await supabase
            .from('inventory_stocktake_items')
            .select('item_id, delta_qty')
            .eq('stocktake_id', stocktakeId)
          const changed = ((stItems as any[]) || []).filter((r) => num(r.delta_qty) !== 0)
          if (changed.length) {
            // Текущие остатки локации — для клампа ≥ 0 (нельзя уйти в минус).
            const itemIds = changed.map((r) => String(r.item_id))
            const balById = new Map<string, number>()
            for (let i = 0; i < itemIds.length; i += 200) {
              const { data: bals } = await supabase
                .from('inventory_balances')
                .select('item_id, quantity')
                .eq('location_id', locationId)
                .in('item_id', itemIds.slice(i, i + 200))
              for (const b of ((bals as any[]) || [])) balById.set(String(b.item_id), num(b.quantity))
            }
            const moves: any[] = []
            for (const r of changed) {
              const itemId = String(r.item_id)
              const current = balById.get(itemId) ?? 0
              // Разворачиваем дельту, которую наложила ревизия; не уходим ниже 0.
              let eff = -num(r.delta_qty)
              if (current + eff < 0) eff = -current
              if (eff === 0) continue
              const { error: rpcErr } = await supabase.rpc('inventory_apply_balance_delta', { p_location_id: locationId, p_item_id: itemId, p_delta: eff })
              if (rpcErr) throw rpcErr
              reversedItems += 1
              moves.push({
                item_id: itemId,
                movement_type: 'inventory_adjustment',
                from_location_id: eff < 0 ? locationId : null,
                to_location_id: eff > 0 ? locationId : null,
                quantity: Math.abs(eff),
                reference_type: 'inventory_stocktake_reversal',
                reference_id: stocktakeId,
                comment: `Откат аудит-акта ${actId.slice(0, 8)}`,
                actor_user_id: actorUserId,
              })
            }
            for (let i = 0; i < moves.length; i += 500) {
              const { error: mErr } = await supabase.from('inventory_movements').insert(moves.slice(i, i + 500))
              if (mErr) throw mErr
            }
          }
        }
      } catch (revertError) {
        // Не удалось вернуть остатки — возвращаем акт в closed, чтобы повторить позже.
        await supabase.from('inventory_audit_acts').update({ status: 'closed' }).eq('id', actId)
        throw revertError
      }

      // Удаляем созданные ревизией АКТИВНЫЕ долги (по маркеру client_name + № акта).
      // Уже учтённые/погашенные (не active) не трогаем. Скоуп — свои компании.
      let debtsRemoved = 0
      {
        let delQ = supabase
          .from('debts')
          .delete()
          .eq('client_name', 'Недостача (ревизия)')
          .eq('status', 'active')
          .ilike('comment', `%${actId.slice(0, 8)}%`)
        if (companyScope.allowedCompanyIds) delQ = delQ.in('company_id', companyScope.allowedCompanyIds)
        const { data: delRows, error: delErr } = await delQ.select('id')
        if (!delErr) debtsRemoved = ((delRows as any[]) || []).length
        else await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/audit.revert:debts', message: delErr.message })
      }

      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-audit-act', entityId: actId, action: 'revert', payload: { reversedItems, debtsRemoved, stocktake_id: stocktakeId } })
      return json({ ok: true, data: { reversedItems, debtsRemoved } })
    }

    return json({ error: 'invalid-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/audit.POST', message: error?.message || 'audit POST error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
