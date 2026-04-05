import { NextResponse } from 'next/server'

import { addDaysISO } from '@/lib/core/date'
import { listOrganizationCompanyIds, resolveCompanyScope } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
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

function normalizeMoney(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.max(0, Math.round(amount))
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

async function settleOneDebtItem(params: {
  supabase: any
  item: {
    id: string
    company_id: string
    operator_id: string | null
    client_name: string | null
    week_start: string
    total_amount: unknown
    item_name: string | null
  }
}) {
  const { supabase, item } = params
  const { error: payUpdateError } = await supabase
    .from('point_debt_items')
    .update({ status: 'deleted', deleted_at: new Date().toISOString() })
    .eq('id', item.id)
    .eq('status', 'active')

  if (payUpdateError) throw payUpdateError

  const aggDebt = await findAggregateDebt({
    supabase,
    companyId: item.company_id,
    operatorId: item.operator_id || null,
    clientName: ((item.client_name || 'Должник').trim() || 'Должник') as string,
    weekStart: item.week_start,
  })
  if (aggDebt) {
    const next = Math.max(0, normalizeMoney(aggDebt.amount) - normalizeMoney(item.total_amount))
    if (next <= 0) {
      await supabase.from('debts').update({ status: 'paid' }).eq('id', aggDebt.id)
    } else {
      await supabase.from('debts').update({ amount: next }).eq('id', aggDebt.id)
    }
  }
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const url = new URL(req.url)
    const weekStart = normalizeIsoDate(url.searchParams.get('weekStart'))
    if (!weekStart) {
      return json({ error: 'weekStart обязателен (YYYY-MM-DD, понедельник недели)' }, 400)
    }

    const companyFilter = url.searchParams.get('companyId')?.trim() || null
    let companyIds = allowedCompanyIds
    if (companyFilter) {
      try {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: companyFilter,
        })
        companyIds = [companyFilter]
      } catch {
        return json({ error: 'Точка вне доступа' }, 403)
      }
    }

    if (!companyIds.length) {
      const weekEnd = addDaysISO(weekStart, 6)
      return json({
        ok: true,
        data: {
          weekStart,
          weekEnd,
          companies: [],
          items: [],
          totals: { count: 0, amount: 0 },
          legacyAggregates: [],
          legacyTotals: { count: 0, amount: 0 },
          pointClientAggregateHint: null,
        },
      })
    }

    const supabase = createAdminSupabaseClient()

    const [{ data: companyRows }, { data: rawItems, error: itemsError }, { data: rawDebts, error: debtsError }] =
      await Promise.all([
        supabase.from('companies').select('id, name, code').in('id', companyIds),
        supabase
          .from('point_debt_items')
          .select(
            'id, company_id, operator_id, created_by_operator_id, point_device_id, client_name, item_name, barcode, quantity, unit_price, total_amount, comment, week_start, source, local_ref, status, created_at',
          )
          .eq('week_start', weekStart)
          .eq('status', 'active')
          .in('company_id', companyIds)
          .order('created_at', { ascending: false })
          .limit(3000),
        supabase
          .from('debts')
          .select('id, company_id, operator_id, client_name, amount, comment, week_start, status, source, created_at')
          .eq('week_start', weekStart)
          .eq('status', 'active')
          .in('company_id', companyIds),
      ])

    if (itemsError) throw itemsError
    if (debtsError) throw debtsError

    const items = (rawItems || []) as any[]
    /** Строки `debts` не из сканера: `point-client` — это зеркало суммы `point_debt_items`, не показываем второй раз. */
    const legacyDebtRows = ((rawDebts || []) as any[]).filter(
      (d) => String(d.source || '').trim().toLowerCase() !== 'point-client',
    )

    const opIds = new Set<string>()
    const devIds = new Set<string>()
    for (const row of items) {
      if (row.operator_id) opIds.add(String(row.operator_id))
      if (row.created_by_operator_id) opIds.add(String(row.created_by_operator_id))
      if (row.point_device_id) devIds.add(String(row.point_device_id))
    }
    for (const d of legacyDebtRows) {
      if (d.operator_id) opIds.add(String(d.operator_id))
    }

    const [opsRes, devRes] = await Promise.all([
      opIds.size
        ? supabase.from('operators').select('id, name, short_name').in('id', [...opIds])
        : Promise.resolve({ data: [] as any[] }),
      devIds.size
        ? supabase.from('point_devices').select('id, name').in('id', [...devIds])
        : Promise.resolve({ data: [] as any[] }),
    ])

    const opMap = new Map<string, { name: string | null; short_name: string | null }>()
    for (const o of (opsRes as any).data || []) {
      if (o?.id) opMap.set(String(o.id), { name: o.name || null, short_name: o.short_name || null })
    }
    const devMap = new Map<string, string>()
    for (const d of (devRes as any).data || []) {
      if (d?.id) devMap.set(String(d.id), String(d.name || ''))
    }

    const companyMap = new Map<string, { name: string | null; code: string | null }>()
    for (const c of companyRows || []) {
      if ((c as any)?.id) companyMap.set(String((c as any).id), { name: (c as any).name || null, code: (c as any).code || null })
    }

    const mapped = items.map((row) => {
      const debtorOp = row.operator_id ? opMap.get(String(row.operator_id)) : null
      const debtorName =
        debtorOp?.short_name?.trim() ||
        debtorOp?.name?.trim() ||
        (row.client_name || '').trim() ||
        'Должник'
      const creator = row.created_by_operator_id ? opMap.get(String(row.created_by_operator_id)) : null
      const creatorName =
        creator?.short_name?.trim() || creator?.name?.trim() || (row.created_by_operator_id ? 'Оператор' : '—')
      const co = companyMap.get(String(row.company_id))
      return {
        id: row.id,
        company_id: row.company_id,
        company_name: co?.name || co?.code || row.company_id,
        company_code: co?.code || null,
        point_device_id: row.point_device_id || null,
        point_device_name: row.point_device_id ? devMap.get(String(row.point_device_id)) || null : null,
        operator_id: row.operator_id || null,
        client_name: row.client_name || null,
        debtor_name: debtorName,
        created_by_operator_id: row.created_by_operator_id || null,
        created_by_name: creatorName,
        item_name: row.item_name,
        barcode: row.barcode || null,
        quantity: Number(row.quantity || 0),
        unit_price: Number(row.unit_price || 0),
        total_amount: Number(row.total_amount || 0),
        comment: row.comment || null,
        week_start: row.week_start,
        source: row.source || null,
        local_ref: row.local_ref || null,
        created_at: row.created_at,
      }
    })

    const totals = mapped.reduce(
      (acc, r) => {
        acc.count += 1
        acc.amount += normalizeMoney(r.total_amount)
        return acc
      },
      { count: 0, amount: 0 },
    )

    const legacyAggregates = legacyDebtRows.map((d: any) => {
      const debtorOp = d.operator_id ? opMap.get(String(d.operator_id)) : null
      const debtorName =
        debtorOp?.short_name?.trim() ||
        debtorOp?.name?.trim() ||
        (d.client_name || '').trim() ||
        'Должник'
      const co = d.company_id ? companyMap.get(String(d.company_id)) : null
      return {
        id: d.id,
        company_id: d.company_id || null,
        company_name: co?.name || co?.code || d.company_id || '—',
        company_code: co?.code || null,
        operator_id: d.operator_id || null,
        client_name: d.client_name || null,
        debtor_name: debtorName,
        amount: Number(d.amount || 0),
        comment: d.comment || null,
        source: d.source || null,
        week_start: d.week_start,
        created_at: d.created_at || null,
      }
    })

    const legacyTotals = legacyAggregates.reduce(
      (acc, r) => {
        acc.count += 1
        acc.amount += normalizeMoney(r.amount)
        return acc
      },
      { count: 0, amount: 0 },
    )

    const pointClientDebtRows = ((rawDebts || []) as any[]).filter(
      (d) => String(d.source || '').trim().toLowerCase() === 'point-client',
    )
    const pointClientAggregateHint =
      mapped.length === 0 && pointClientDebtRows.length > 0
        ? {
            count: pointClientDebtRows.length,
            amount: pointClientDebtRows.reduce((s, d) => s + normalizeMoney(d.amount), 0),
          }
        : null

    const companies = (companyRows || []).map((c: any) => ({
      id: String(c.id),
      name: c.name || null,
      code: c.code || null,
    }))

    return json({
      ok: true,
      data: {
        weekStart,
        weekEnd: addDaysISO(weekStart, 6),
        companies,
        items: mapped,
        totals,
        legacyAggregates,
        legacyTotals,
        pointClientAggregateHint,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/point-debts:get',
      message: error?.message || 'Admin point debts GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

type PostBody = { action: 'markPaid'; itemIds: string[] }

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedSet = new Set(allowedCompanyIds)

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const body = (await req.json().catch(() => null)) as PostBody | null
    if (!body?.action || body.action !== 'markPaid') {
      return json({ error: 'action: markPaid и itemIds обязательны' }, 400)
    }
    const rawIds = Array.isArray(body.itemIds) ? body.itemIds : []
    const itemIds = [...new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))]
    if (!itemIds.length) {
      return json({ error: 'Выберите хотя бы одну позицию' }, 400)
    }
    if (itemIds.length > 500) {
      return json({ error: 'Не более 500 позиций за раз' }, 400)
    }

    const supabase = createAdminSupabaseClient()
    const { data: rows, error: fetchError } = await supabase
      .from('point_debt_items')
      .select('id, company_id, operator_id, client_name, week_start, total_amount, item_name, status')
      .in('id', itemIds)

    if (fetchError) throw fetchError

    const byId = new Map((rows || []).map((r: any) => [String(r.id), r]))
    const settled: string[] = []
    const skipped: { id: string; reason: string }[] = []

    for (const id of itemIds) {
      const row = byId.get(id)
      if (!row) {
        skipped.push({ id, reason: 'not-found' })
        continue
      }
      if (!allowedSet.has(String(row.company_id))) {
        skipped.push({ id, reason: 'forbidden-company' })
        continue
      }
      if (row.status !== 'active') {
        skipped.push({ id, reason: 'not-active' })
        continue
      }
      try {
        await settleOneDebtItem({ supabase, item: row })
        settled.push(id)
      } catch (e: any) {
        skipped.push({ id, reason: e?.message || 'error' })
      }
    }

    if (settled.length) {
      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'point-debt-item',
        entityId: settled[0],
        action: 'admin-mark-paid-bulk',
        payload: {
          item_ids: settled,
          count: settled.length,
        },
      })
    }

    return json({
      ok: true,
      data: {
        settled,
        skipped,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/point-debts:post',
      message: error?.message || 'Admin point debts POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
