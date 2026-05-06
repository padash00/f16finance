import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { decideInventoryRequest, ensureInventoryRequestAccess, fetchInventoryRequests } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { notifyInventoryRequestDecided } from '@/lib/server/telegram'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageInventory(access: { isSuperAdmin: boolean; staffRole: 'manager' | 'marketer' | 'owner' | 'other' }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

function normalizeQty(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

function humanizeDecisionError(raw: string | null | undefined): string {
  const code = String(raw || '').trim()
  const lowered = code.toLowerCase()
  if (code === 'inventory-request-not-found') return 'Заявка не найдена'
  if (code === 'inventory-request-already-decided') return 'Решение по заявке уже принято'
  if (code === 'inventory-request-decision-items-required') return 'Не переданы позиции заявки'
  if (code === 'inventory-request-decision-line-missing') return 'В решении отсутствует одна из позиций заявки'
  if (code === 'inventory-request-approved-qty-invalid') return 'Количество не может быть отрицательным'
  if (code === 'inventory-request-approved-qty-too-high') {
    return 'В базе пока старая функция: одобрить больше запрошенного нельзя. Примените миграцию 20260421_inventory_decide_request_allow_overapproval.sql.'
  }
  if (code === 'inventory-insufficient-stock' || lowered.includes('inventory-insufficient-stock') || lowered.includes('inventory_balances_quantity_check')) {
    return 'Недостаточно остатка на складе для одобрения в текущем количестве. Уменьшите количество по позициям или пополните склад.'
  }
  return code || 'Не удалось обработать заявку'
}

function normalizeUserDisplayName(user: any): string | null {
  const meta = (user?.user_metadata || {}) as Record<string, unknown>
  const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : ''
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  const email = typeof user?.email === 'string' ? user.email.trim() : ''
  if (fullName) return fullName
  if (name) return name
  if (email) return email
  return null
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-requests.view')
    if (denied) return denied as any
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const requests = await fetchInventoryRequests(supabase as any, {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    })

    const sourceLocationIds = Array.from(
      new Set(
        (requests || [])
          .map((r: any) => String(r?.source_location_id || '').trim())
          .filter(Boolean),
      ),
    )
    const itemIds = Array.from(
      new Set(
        (requests || [])
          .flatMap((r: any) => (Array.isArray(r?.items) ? r.items : []))
          .map((it: any) => String(it?.item_id || '').trim())
          .filter(Boolean),
      ),
    )
    const balanceByLocationAndItem: Record<string, number> = {}
    if (sourceLocationIds.length > 0 && itemIds.length > 0) {
      const { data: balanceRows, error: balanceErr } = await supabase
        .from('inventory_balances')
        .select('location_id, item_id, quantity')
        .in('location_id', sourceLocationIds)
        .in('item_id', itemIds)
      if (balanceErr) throw balanceErr
      for (const row of balanceRows || []) {
        const locationId = String((row as any)?.location_id || '').trim()
        const itemId = String((row as any)?.item_id || '').trim()
        if (!locationId || !itemId) continue
        balanceByLocationAndItem[`${locationId}:${itemId}`] = Number((row as any)?.quantity || 0)
      }
    }

    // Enrich with actor names for full request history timeline.
    // Actors may be staff (admin web UI) or operators (point desktop — created_by stores operator_auth.user_id).
    const actorIds = Array.from(
      new Set(
        (requests || [])
          .flatMap((r: any) => [r.created_by, r.approved_by, r.issued_by])
          .map((v: any) => String(v || '').trim())
          .filter(Boolean),
      ),
    )
    const actorById: Record<string, { id: string; full_name: string | null; role: string | null }> = {}
    const creatorOperatorFallbackByRequestId: Record<string, string> = {}
    const approvedActorFallbackByRequestId: Record<string, string> = {}
    if (actorIds.length > 0) {
      const [
        { data: staffRows },
        { data: operatorAuthByUserRows },
        { data: operatorAuthByIdRows },
        { data: orgMemberRows },
      ] = await Promise.all([
        supabase.from('staff').select('id, full_name, role').in('id', actorIds),
        supabase
          .from('operator_auth')
          .select('user_id, role, operator:operator_id(name, short_name)')
          .in('user_id', actorIds),
        supabase
          .from('operator_auth')
          .select('id, user_id, role, operator:operator_id(name, short_name)')
          .in('id', actorIds),
        access.activeOrganization?.id
          ? supabase
              .from('organization_members')
              .select('user_id, staff_id, role, email')
              .eq('organization_id', access.activeOrganization.id)
              .eq('status', 'active')
              .in('user_id', actorIds)
          : Promise.resolve({ data: [] as any[] }),
      ])
      for (const s of staffRows || []) {
        actorById[String((s as any).id)] = {
          id: String((s as any).id),
          full_name: ((s as any).full_name as string) || null,
          role: ((s as any).role as string) || null,
        }
      }
      const memberRows = (orgMemberRows || []) as any[]
      const memberStaffIds = Array.from(
        new Set(
          memberRows
            .map((row) => String(row?.staff_id || '').trim())
            .filter(Boolean),
        ),
      )
      const staffById = new Map<string, { full_name: string | null; role: string | null }>()
      if (memberStaffIds.length > 0) {
        const { data: staffByMemberRows } = await supabase
          .from('staff')
          .select('id, full_name, role')
          .in('id', memberStaffIds)
        for (const s of staffByMemberRows || []) {
          const id = String((s as any).id || '').trim()
          if (!id) continue
          staffById.set(id, {
            full_name: ((s as any).full_name as string) || null,
            role: ((s as any).role as string) || null,
          })
        }
      }
      for (const m of memberRows) {
        const userId = String((m as any).user_id || '').trim()
        if (!userId || actorById[userId]) continue
        const staffId = String((m as any).staff_id || '').trim()
        const staffMeta = staffId ? staffById.get(staffId) : null
        const fallbackEmail = String((m as any).email || '').trim() || null
        actorById[userId] = {
          id: userId,
          full_name: staffMeta?.full_name || fallbackEmail,
          role: staffMeta?.role || ((m as any).role as string) || null,
        }
      }
      for (const row of operatorAuthByUserRows || []) {
        const userId = String((row as any).user_id || '').trim()
        if (!userId || actorById[userId]) continue
        const op = Array.isArray((row as any).operator) ? (row as any).operator[0] : (row as any).operator
        const name = op?.name || op?.short_name || null
        actorById[userId] = {
          id: userId,
          full_name: name,
          role: ((row as any).role as string) || 'operator',
        }
      }
      for (const row of operatorAuthByIdRows || []) {
        const authId = String((row as any).id || '').trim()
        if (!authId || actorById[authId]) continue
        const op = Array.isArray((row as any).operator) ? (row as any).operator[0] : (row as any).operator
        const name = op?.name || op?.short_name || null
        actorById[authId] = {
          id: authId,
          full_name: name,
          role: ((row as any).role as string) || 'operator',
        }
      }
    }

    const requestsNeedingApprovedFallback = (requests || []).filter(
      (r: any) => r?.approved_at && !r?.approved_by,
    )
    if (requestsNeedingApprovedFallback.length > 0) {
      const requestIds = requestsNeedingApprovedFallback
        .map((r: any) => String(r?.id || '').trim())
        .filter(Boolean)
      if (requestIds.length > 0) {
        const { data: auditRows } = await supabase
          .from('audit_log')
          .select('entity_id, action, actor_user_id, created_at')
          .eq('entity_type', 'inventory-request')
          .in('entity_id', requestIds)
          .in('action', ['approve', 'reject'])
          .order('created_at', { ascending: false })

        const fallbackActorIds: string[] = []
        for (const row of auditRows || []) {
          const entityId = String((row as any).entity_id || '').trim()
          const actorUserId = String((row as any).actor_user_id || '').trim()
          if (!entityId || !actorUserId || approvedActorFallbackByRequestId[entityId]) continue
          approvedActorFallbackByRequestId[entityId] = actorUserId
          fallbackActorIds.push(actorUserId)
        }
        const unresolvedFallbackActorIds = Array.from(
          new Set(fallbackActorIds.filter((id) => !actorById[id])),
        )
        if (unresolvedFallbackActorIds.length > 0) {
          const [{ data: fallbackMembers }] = await Promise.all([
            access.activeOrganization?.id
              ? supabase
                  .from('organization_members')
                  .select('user_id, staff_id, role, email')
                  .eq('organization_id', access.activeOrganization.id)
                  .eq('status', 'active')
                  .in('user_id', unresolvedFallbackActorIds)
              : Promise.resolve({ data: [] as any[] }),
          ])
          const fallbackMemberStaffIds = Array.from(
            new Set(
              (fallbackMembers || [])
                .map((row: any) => String(row?.staff_id || '').trim())
                .filter(Boolean),
            ),
          )
          const { data: fallbackStaff } =
            fallbackMemberStaffIds.length > 0
              ? await supabase.from('staff').select('id, full_name, role').in('id', fallbackMemberStaffIds)
              : ({ data: [] as any[] } as any)
          const fallbackStaffById = new Map<string, { full_name: string | null; role: string | null }>()
          for (const s of fallbackStaff || []) {
            const id = String((s as any).id || '').trim()
            if (!id) continue
            fallbackStaffById.set(id, {
              full_name: ((s as any).full_name as string) || null,
              role: ((s as any).role as string) || null,
            })
          }
          for (const m of fallbackMembers || []) {
            const userId = String((m as any).user_id || '').trim()
            if (!userId || actorById[userId]) continue
            const staffId = String((m as any).staff_id || '').trim()
            const staffMeta = staffId ? fallbackStaffById.get(staffId) : null
            const fallbackEmail = String((m as any).email || '').trim() || null
            actorById[userId] = {
              id: userId,
              full_name: staffMeta?.full_name || fallbackEmail,
              role: staffMeta?.role || ((m as any).role as string) || null,
            }
          }
        }
      }
    }
    const requestsNeedingCreatorFallback = (requests || []).filter(
      (r: any) => r?.created_by && !actorById[String(r.created_by)],
    )
    if (requestsNeedingCreatorFallback.length > 0) {
      const requestIds = requestsNeedingCreatorFallback
        .map((r: any) => String(r?.id || '').trim())
        .filter(Boolean)
      if (requestIds.length > 0) {
        const { data: createAuditRows } = await supabase
          .from('audit_log')
          .select('entity_id, action, payload, created_at')
          .eq('entity_type', 'inventory-request')
          .eq('action', 'create')
          .in('entity_id', requestIds)
          .order('created_at', { ascending: false })
        const operatorIds: string[] = []
        for (const row of createAuditRows || []) {
          const entityId = String((row as any).entity_id || '').trim()
          const payload = ((row as any).payload || {}) as Record<string, unknown>
          const operatorId = String(payload?.operator_id || '').trim()
          if (!entityId || !operatorId || creatorOperatorFallbackByRequestId[entityId]) continue
          creatorOperatorFallbackByRequestId[entityId] = operatorId
          operatorIds.push(operatorId)
        }
        const uniqueOperatorIds = Array.from(new Set(operatorIds))
        if (uniqueOperatorIds.length > 0) {
          const { data: operatorRows } = await supabase
            .from('operators')
            .select('id, name, short_name')
            .in('id', uniqueOperatorIds)
          const operatorById = new Map<string, { name: string | null }>()
          for (const row of operatorRows || []) {
            const id = String((row as any).id || '').trim()
            if (!id) continue
            operatorById.set(id, {
              name: ((row as any).name as string) || ((row as any).short_name as string) || null,
            })
          }
          for (const [requestId, operatorId] of Object.entries(creatorOperatorFallbackByRequestId)) {
            const operatorName = operatorById.get(operatorId)?.name
            if (!operatorName) continue
            const syntheticId = `operator:${operatorId}`
            actorById[syntheticId] = {
              id: syntheticId,
              full_name: operatorName,
              role: 'operator',
            }
            creatorOperatorFallbackByRequestId[requestId] = syntheticId
          }
        }
      }
    }

    const unresolvedActorIds = Array.from(
      new Set(
        actorIds.filter((id) => !actorById[id]),
      ),
    )
    if (unresolvedActorIds.length > 0 && hasAdminSupabaseCredentials()) {
      const admin = createAdminSupabaseClient()
      await Promise.all(
        unresolvedActorIds.map(async (userId) => {
          try {
            const { data, error } = await admin.auth.admin.getUserById(userId)
            if (error || !data?.user) return
            actorById[userId] = {
              id: userId,
              full_name: normalizeUserDisplayName(data.user),
              role: null,
            }
          } catch {
            // ignore unresolved ids, keep fallback rendering as ID on UI
          }
        }),
      )
    }

    const currentUserFallback = access.user
      ? {
          id: String(access.user.id),
          full_name: normalizeUserDisplayName(access.user),
          role: access.isSuperAdmin ? 'owner' : access.staffRole,
        }
      : null

    const enrichedRequests = (requests || []).map((r: any) => {
      const sourceLocationId = String(r?.source_location_id || '').trim()
      const enrichedItems = Array.isArray(r?.items)
        ? r.items.map((item: any) => {
            const itemId = String(item?.item_id || '').trim()
            const key = sourceLocationId && itemId ? `${sourceLocationId}:${itemId}` : ''
            const availableQty = key ? Number(balanceByLocationAndItem[key] || 0) : 0
            const requestedQty = Number(item?.requested_qty || 0)
            const enoughForRequested = availableQty + 0.000001 >= requestedQty
            return {
              ...item,
              available_qty: Math.round((availableQty + Number.EPSILON) * 1000) / 1000,
              enough_for_requested: enoughForRequested,
            }
          })
        : []
      return {
        ...r,
        items: enrichedItems,
        created_by_staff:
          (r.created_by ? actorById[String(r.created_by)] || null : null) ||
          (creatorOperatorFallbackByRequestId[String(r.id || '')]
            ? actorById[creatorOperatorFallbackByRequestId[String(r.id || '')]] || null
            : null),
        approved_by_staff:
          (r.approved_by ? actorById[String(r.approved_by)] || null : null) ||
          (approvedActorFallbackByRequestId[String(r.id || '')]
            ? actorById[approvedActorFallbackByRequestId[String(r.id || '')]] || null
            : null) ||
          (r.approved_at && !r.approved_by ? currentUserFallback : null),
        issued_by_staff: r.issued_by ? actorById[String(r.issued_by)] || null : null,
      }
    })

    return json({
      ok: true,
      data: {
        requests: enrichedRequests,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory/requests.GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось загрузить заявки магазина' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'action-required' }, 400)

    // ── transitionStatus ───────────────────────────────────────────���─────────
    if (body.action === 'transitionStatus') {
      const denied2 = await requireCapability(access, 'store-requests.transition_status')
      if (denied2) return denied2 as any
      const requestId = String(body.requestId || '').trim()
      if (!requestId) return json({ error: 'request-id-required' }, 400)

      const newStatus = String(body.status || '').trim()
      const allowed = ['issued', 'received']
      if (!allowed.includes(newStatus)) return json({ error: 'invalid-status' }, 400)

      await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)

      // Validate transition: issued only from approved, received only from issued
      const { data: req } = await supabase.from('inventory_requests').select('status').eq('id', requestId).maybeSingle()
      if (!req) return json({ error: 'not-found' }, 404)
      if (newStatus === 'issued' && !['approved_full', 'approved_partial'].includes(req.status)) return json({ error: 'invalid-transition' }, 400)
      if (newStatus === 'received' && req.status !== 'issued') return json({ error: 'invalid-transition' }, 400)

      const actorUserId = access.user?.id || null
      const nowIso = new Date().toISOString()

      if (newStatus === 'issued') {
        // Просто меняем статус, балансы не трогаем (товар ещё на складе резервом)
        const { error: updErr } = await supabase
          .from('inventory_requests')
          .update({ status: 'issued', issued_at: nowIso, issued_by: actorUserId, updated_at: nowIso })
          .eq('id', requestId)
        if (updErr) throw updErr
        return json({ ok: true, data: { status: 'issued' } })
      }

      if (newStatus === 'received') {
        // v7: получение точкой = атомарно списать со склада + снять резерв + начислить на витрину
        const { error: rpcErr } = await supabase.rpc('inventory_receive_request', {
          p_request_id: requestId,
          p_actor_user_id: actorUserId,
        })
        if (rpcErr) throw rpcErr
        return json({ ok: true, data: { status: 'received' } })
      }

      return json({ error: 'invalid-status' }, 400)
    }

    // ── undecideRequest: откат одобренной заявки (вернуть товар на склад) ─────
    if (body.action === 'undecideRequest') {
      const denied2 = await requireCapability(access, 'store-requests.undecide')
      if (denied2) return denied2 as any
      const actorUserId = access.user?.id || null
      const requestId = String(body.requestId || '').trim()
      if (!requestId) return json({ error: 'request-id-required' }, 400)
      const reason = String(body.reason || '').trim() || null

      await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)

      const { error: rpcErr } = await supabase.rpc('inventory_undecide_request', {
        p_request_id: requestId,
        p_reason: reason,
        p_actor_user_id: actorUserId,
      })
      if (rpcErr) {
        const msg = String(rpcErr.message || '')
        if (msg.includes('inventory-request-not-undecidable')) {
          return json({ error: 'Эту заявку нельзя откатить — она в неподходящем статусе' }, 409)
        }
        if (msg.includes('inventory-request-already-received')) {
          return json({ error: 'Заявка уже получена точкой — откат запрещён' }, 409)
        }
        throw rpcErr
      }

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-request',
        entityId: requestId,
        action: 'undecide',
        payload: { reason },
      })

      return json({ ok: true })
    }

    if (body.action !== 'decideRequest') return json({ error: 'invalid-action' }, 400)

    const deniedDecide = await requireCapability(access, 'store-requests.approve')
    if (deniedDecide) return deniedDecide as any

    const actorUserId = access.user?.id || null
    const requestId = String(body.requestId || '').trim()
    if (!requestId) return json({ error: 'request-id-required' }, 400)
    await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)

    const decision = await decideInventoryRequest(supabase as any, {
      request_id: requestId,
      approved: body.approved === true,
      decision_comment: body.decision_comment || null,
      actor_user_id: actorUserId,
      items: Array.isArray(body.items)
        ? body.items.map((item: any) => ({
            request_item_id: String(item.request_item_id || '').trim(),
            approved_qty: normalizeQty(item.approved_qty),
          }))
        : [],
    })

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-request',
      entityId: requestId,
      action: body.approved ? 'approve' : 'reject',
      payload: {
        request_id: requestId,
        approved: body.approved === true,
        decision,
      },
    })

    // ── Telegram notification ──────────────────────────────────────────────
    void (async () => {
      try {
        // Fetch request with items and company
        const { data: reqData } = await supabase
          .from('inventory_requests')
          .select(`
            requesting_company_id,
            company:companies!requesting_company_id(name),
            items:inventory_request_items(
              requested_qty, approved_qty,
              item:inventory_items(name, unit)
            )
          `)
          .eq('id', requestId)
          .maybeSingle()

        if (!reqData) return

        const companyId = reqData.requesting_company_id
        const companyName = (Array.isArray(reqData.company) ? reqData.company[0] : reqData.company)?.name || companyId

        // Staff telegram IDs
        const { data: staffRows } = await supabase
          .from('staff')
          .select('telegram_chat_id')
          .eq('company_id', companyId)
          .in('role', ['owner', 'manager'])
          .not('telegram_chat_id', 'is', null)

        const chatIds = [
          ...(staffRows || []).map((s: any) => String(s.telegram_chat_id)),
          process.env.TELEGRAM_ADMIN_CHAT_ID,
        ].filter(Boolean) as string[]

        const deciderName = access.staffMember
          ? (access.staffMember as any).full_name || (access.staffMember as any).name || null
          : null

        const items = (Array.isArray(reqData.items) ? reqData.items : []).map((ri: any) => {
          const item = Array.isArray(ri.item) ? ri.item[0] : ri.item
          return {
            name: item?.name || '?',
            unit: item?.unit || 'шт',
            requested_qty: Number(ri.requested_qty || 0),
            approved_qty: ri.approved_qty != null ? Number(ri.approved_qty) : null,
          }
        })

        await notifyInventoryRequestDecided({
          companyName,
          approved: body.approved === true,
          decisionComment: body.decision_comment || null,
          deciderName,
          items,
          chatIds: [...new Set(chatIds)],
        })
      } catch { /* не ломать основной сценарий */ }
    })()

    return json({ ok: true, data: decision })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory/requests.POST',
      message: error?.message || 'error',
    })
    return json({ error: humanizeDecisionError(error?.message) }, 500)
  }
}
