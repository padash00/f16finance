import { NextResponse } from 'next/server'

import { addDaysISO } from '@/lib/core/date'
import { requireCapability } from '@/lib/server/capabilities'
import { requireAddon } from '@/lib/server/entitlements'
import { listOrganizationCompanyIds, resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeIsoDate(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : trimmed
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    created: 'Долг создан',
    historical_created: 'Долг создан',
    amount_changed: 'Сумма изменена',
    comment_changed: 'Комментарий изменён',
    reassigned: 'Долг переназначен',
    status_changed: 'Статус изменён',
    settled_via_salary: 'Удержано из зарплаты',
    historical_settled_via_salary: 'Удержано из зарплаты',
    historical_paid: 'Долг погашен',
    deleted: 'Долг удалён',
    updated: 'Долг изменён',
    item_added: 'Товар взят в долг',
    historical_item_added: 'Товар взят в долг',
    item_settled: 'Позиция погашена',
    historical_item_settled: 'Позиция погашена',
    item_deleted: 'Позиция удалена',
    item_status_changed: 'Статус позиции изменён',
    item_changed: 'Позиция изменена',
    item_comment_changed: 'Комментарий позиции изменён',
    item_reassigned: 'Позиция переназначена',
    item_updated: 'Позиция изменена',
  }
  return labels[type] || type
}

export async function GET(req: Request) {
  const guard = await requireStaffCapabilityRequest(req, 'salary')
  if (guard) return guard

  const access = await getRequestAccessContext(req)
  if ('response' in access) return access.response

  const addonDenied = await requireAddon(access, 'addon.salary')
  if (addonDenied) return addonDenied
  const denied = await requireCapability(access, 'point-debts.view')
  if (denied) return denied

  const url = new URL(req.url)
  const weekStart = normalizeIsoDate(url.searchParams.get('weekStart'))
  if (!weekStart) return json({ error: 'weekStart обязателен (YYYY-MM-DD)' }, 400)

  const requestedCompanyId = url.searchParams.get('companyId')?.trim() || null
  const debtor = url.searchParams.get('debtor')?.trim() || null
  const type = url.searchParams.get('type')?.trim() || null
  const requestedLimit = Number(url.searchParams.get('limit') || 250)
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.floor(requestedLimit))) : 250

  const allowedCompanyIds = await listOrganizationCompanyIds({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  let companyIds = allowedCompanyIds
  if (requestedCompanyId) {
    try {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId,
      })
      companyIds = [requestedCompanyId]
    } catch {
      return json({ error: 'Точка вне доступа' }, 403)
    }
  }

  if (!companyIds.length) {
    return json({ ok: true, data: { weekStart, weekEnd: addDaysISO(weekStart, 6), events: [], total: 0 } })
  }

  const supabase = createAdminSupabaseClient()
  let query = supabase
    .from('debt_events')
    .select(
      'id, debt_id, point_debt_item_id, entity_kind, event_type, company_id, organization_id, operator_id, client_name, occurred_at, business_date, week_start, source, actor_kind, actor_user_id, actor_operator_id, actor_name, shift_id, point_device_id, delta_amount, amount_before, amount_after, status_before, status_after, local_ref, item_name, metadata',
    )
    .eq('week_start', weekStart)
    .in('company_id', companyIds)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (debtor) query = query.ilike('client_name', `%${debtor.replace(/[%_]/g, '')}%`)
  if (type) query = query.eq('event_type', type)

  const { data: rows, error } = await query
  if (error) return json({ error: error.message }, 500)

  const events = (rows || []) as any[]
  const companyIdSet = new Set<string>()
  const operatorIdSet = new Set<string>()
  const deviceIdSet = new Set<string>()

  for (const e of events) {
    if (e.company_id) companyIdSet.add(String(e.company_id))
    if (e.operator_id) operatorIdSet.add(String(e.operator_id))
    if (e.actor_operator_id) operatorIdSet.add(String(e.actor_operator_id))
    if (e.point_device_id) deviceIdSet.add(String(e.point_device_id))
  }

  const [companiesRes, operatorsRes, devicesRes] = await Promise.all([
    companyIdSet.size
      ? supabase.from('companies').select('id, name, code').in('id', [...companyIdSet])
      : Promise.resolve({ data: [] as any[] }),
    operatorIdSet.size
      ? supabase.from('operators').select('id, name, short_name').in('id', [...operatorIdSet])
      : Promise.resolve({ data: [] as any[] }),
    deviceIdSet.size
      ? supabase.from('point_devices').select('id, name').in('id', [...deviceIdSet])
      : Promise.resolve({ data: [] as any[] }),
  ])

  const companyMap = new Map<string, string>()
  for (const c of (companiesRes as any).data || []) {
    companyMap.set(String(c.id), c.name || c.code || '—')
  }
  const operatorMap = new Map<string, string>()
  for (const o of (operatorsRes as any).data || []) {
    operatorMap.set(String(o.id), o.short_name?.trim() || o.name?.trim() || 'Оператор')
  }
  const deviceMap = new Map<string, string>()
  for (const d of (devicesRes as any).data || []) {
    deviceMap.set(String(d.id), d.name || 'Точка')
  }

  const mapped = events.map((e) => {
    const debtorName = e.operator_id
      ? operatorMap.get(String(e.operator_id)) || e.client_name || 'Должник'
      : e.client_name || 'Должник'
    const actorName = e.actor_operator_id
      ? operatorMap.get(String(e.actor_operator_id)) || 'Оператор'
      : e.actor_name || (e.actor_user_id ? 'Сотрудник' : e.actor_kind === 'system' ? 'Система' : 'Неизвестно')

    return {
      ...e,
      event_label: eventLabel(String(e.event_type || '')),
      debtor_name: debtorName,
      actor_name_resolved: actorName,
      company_name: e.company_id ? companyMap.get(String(e.company_id)) || '—' : '—',
      point_device_name: e.point_device_id ? deviceMap.get(String(e.point_device_id)) || null : null,
      delta_amount: e.delta_amount == null ? null : Number(e.delta_amount),
      amount_before: e.amount_before == null ? null : Number(e.amount_before),
      amount_after: e.amount_after == null ? null : Number(e.amount_after),
    }
  })

  return json({
    ok: true,
    data: {
      weekStart,
      weekEnd: addDaysISO(weekStart, 6),
      events: mapped,
      total: mapped.length,
      truncated: mapped.length >= limit,
    },
  })
}
