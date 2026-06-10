import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'shifts-reports.view')
    if (denied) return denied as any
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const { id } = await params
    if (!id) return json({ error: 'invalid-shift-id' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const { data: shift, error } = await supabase
      .from('point_shifts')
      .select(
        `id, company_id, organization_id, operator_id, point_device_id,
         status, shift_type, opened_at, closed_at,
         opening_cash, opening_notes,
         closing_cash, closing_kaspi, closing_kaspi_before_midnight, closing_kaspi_after_midnight, closing_notes,
         z_report_url, x_report_url, totals_json,
         handover_from_shift_id, closed_by, created_at, updated_at,
         company:company_id ( id, name, code ),
         closer:staff!closed_by ( id, full_name, short_name )`,
      )
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (!shift) return json({ error: 'shift-not-found' }, 404)

    if (
      companyScope.allowedCompanyIds &&
      !companyScope.allowedCompanyIds.includes((shift as any).company_id)
    ) {
      return json({ error: 'forbidden' }, 403)
    }

    const [salesRes, returnsRes, runsRes, incidentsRes, incomeRes, debtsRes] = await Promise.all([
      supabase
        .from('point_sales')
        .select(
          'id, sale_date, shift, payment_method, cash_amount, kaspi_amount, total_amount, comment, sold_at, source, operator_id, customer_id, discount_amount, loyalty_points_earned, loyalty_points_spent, loyalty_discount_amount',
        )
        .eq('shift_id', id)
        .order('sold_at', { ascending: false }),
      supabase
        .from('point_returns')
        .select(
          'id, return_date, shift, payment_method, cash_amount, kaspi_amount, total_amount, comment, returned_at, source',
        )
        .eq('shift_id', id)
        .order('returned_at', { ascending: false }),
      supabase
        .from('checklist_runs')
        .select(
          `id, template_id, status, started_at, completed_at, scheduled_at,
           responses, fines_total, bonuses_total, run_by, co_signed_by,
           template:template_id ( id, title, schedule_type, recurrence_minutes, blocks_shift ),
           runner:staff!run_by ( id, full_name, short_name ),
           cosigner:staff!co_signed_by ( id, full_name, short_name )`,
        )
        .eq('shift_id', id)
        .order('started_at', { ascending: false }),
      supabase
        .from('incidents')
        .select(
          `id, kind, title, description, fine_amount, bonus_amount,
           severity, status, source, occurred_at,
           subject_staff_id, reported_by, article_id, checklist_run_id,
           subject:staff!subject_staff_id ( id, full_name, short_name ),
           reporter:staff!reported_by ( id, full_name, short_name ),
           article:article_id ( id, title, slug )`,
        )
        .eq('shift_id', id)
        .order('occurred_at', { ascending: false }),
      // Связанная запись в incomes (с meta: coins, wipon, debts, start_cash, diff)
      supabase
        .from('incomes')
        .select('id, date, cash_amount, kaspi_amount, kaspi_before_midnight, total_amount, comment, meta')
        .eq('shift_id', id)
        .maybeSingle(),
      // Долги клиентов созданные на этой смене — через company_id + временной интервал
      supabase
        .from('point_debt_items')
        .select('id, client_name, item_name, quantity, unit_price, total_amount, comment, status, created_at')
        .eq('company_id', (shift as any).company_id)
        .gte('created_at', (shift as any).opened_at || new Date(0).toISOString())
        .lte('created_at', (shift as any).closed_at || new Date().toISOString())
        .order('created_at', { ascending: false }),
    ])

    const incidents = (incidentsRes.data || []) as any[]
    let finesTotal = 0
    let bonusesTotal = 0
    for (const inc of incidents) {
      if (inc.status !== 'confirmed') continue
      if (inc.kind === 'violation') finesTotal += Number(inc.fine_amount || 0)
      if (inc.kind === 'bonus') bonusesTotal += Number(inc.bonus_amount || 0)
    }

    // Логируем ошибки выборок (нужно для отладки — раньше падали молча)
    if (salesRes.error) console.error('[shift-detail] sales error', salesRes.error)
    if (returnsRes.error) console.error('[shift-detail] returns error', returnsRes.error)

    const salesRows = (salesRes.data || []) as any[]
    const returnsRows = (returnsRes.data || []) as any[]
    const saleIds = salesRows.map((s) => s.id)
    const returnIds = returnsRows.map((r) => r.id)
    const operatorIds = Array.from(
      new Set(salesRows.map((s) => s.operator_id).filter(Boolean) as string[]),
    )
    const customerIds = Array.from(
      new Set(salesRows.map((s) => s.customer_id).filter(Boolean) as string[]),
    )

    const [
      saleItemsRes,
      returnItemsRes,
      operatorsRes,
      customersRes,
    ] = await Promise.all([
      saleIds.length
        ? supabase
            .from('point_sale_items')
            .select('id, sale_id, item_id, quantity, unit_price, total_price, universal_name')
            .in('sale_id', saleIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      returnIds.length
        ? supabase
            .from('point_return_items')
            .select('id, return_id, item_id, quantity, unit_price')
            .in('return_id', returnIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      operatorIds.length
        ? supabase
            .from('operators')
            .select('id, full_name:name, short_name')
            .in('id', operatorIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      customerIds.length
        ? supabase.from('customers').select('id, name').in('id', customerIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ])

    if ((saleItemsRes as any).error) console.error('[shift-detail] sale items', (saleItemsRes as any).error)
    if ((returnItemsRes as any).error) console.error('[shift-detail] return items', (returnItemsRes as any).error)

    // Имена товаров по item_id
    const allItemIds = Array.from(
      new Set([
        ...((saleItemsRes.data || []) as any[]).map((it) => it.item_id).filter(Boolean),
        ...((returnItemsRes.data || []) as any[]).map((it) => it.item_id).filter(Boolean),
      ]),
    ) as string[]
    const itemsByIdRes = allItemIds.length
      ? await supabase.from('inventory_items').select('id, name').in('id', allItemIds)
      : { data: [] as any[], error: null }
    const itemNameById = new Map<string, string>(
      ((itemsByIdRes.data || []) as any[]).map((it) => [String(it.id), String(it.name || '')]),
    )

    const operatorById = new Map<string, any>(
      ((operatorsRes.data || []) as any[]).map((o) => [String(o.id), o]),
    )
    const customerById = new Map<string, any>(
      ((customersRes.data || []) as any[]).map((c) => [String(c.id), c]),
    )

    // Оператор смены — кассир из таблицы `operators` (а НЕ админ-`staff`).
    // Резолвим по operator_id: сначала из уже загруженных операторов продаж,
    // потом прямым запросом в operators, staff — как запас.
    let shiftOperator: any = null
    if ((shift as any).operator_id) {
      const opId = String((shift as any).operator_id)
      shiftOperator = operatorById.get(opId) || null
      if (!shiftOperator) {
        const [opRes, stRes] = await Promise.all([
          supabase.from('operators').select('id, full_name:name, short_name').eq('id', opId).maybeSingle(),
          supabase.from('staff').select('id, full_name, short_name').eq('id', opId).maybeSingle(),
        ])
        shiftOperator = (opRes.data as any) || (stRes.data as any) || null
      }
    }
    // Если оператора смены нет (operator_id пуст — нет линка operator→staff),
    // берём настоящий operator_id из аудит-лога открытия смены, имя — из operators.
    if (!shiftOperator) {
      const { data: openLog } = await supabase
        .from('audit_log')
        .select('payload')
        .eq('action', 'point_shift.open')
        .eq('entity_id', id)
        .limit(1)
        .maybeSingle()
      const opId = (openLog as any)?.payload?.operator_id
      if (opId) {
        const { data: op } = await supabase
          .from('operators')
          .select('id, full_name:name, short_name')
          .eq('id', String(opId))
          .maybeSingle()
        if (op?.id) shiftOperator = op
      }
    }

    // Группируем позиции по продаже/возврату
    const saleItemsBySale = new Map<string, any[]>()
    for (const it of (saleItemsRes.data || []) as any[]) {
      const sid = String(it.sale_id)
      const name = it.item_id ? itemNameById.get(String(it.item_id)) : null
      const arr = saleItemsBySale.get(sid) || []
      arr.push({
        id: it.id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        total_price: it.total_price,
        universal_name: it.universal_name || null,
        item: name ? { id: it.item_id, name } : null,
      })
      saleItemsBySale.set(sid, arr)
    }
    const returnItemsByReturn = new Map<string, any[]>()
    for (const it of (returnItemsRes.data || []) as any[]) {
      const rid = String(it.return_id)
      const name = it.item_id ? itemNameById.get(String(it.item_id)) : null
      const arr = returnItemsByReturn.get(rid) || []
      arr.push({
        id: it.id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        item: name ? { id: it.item_id, name } : null,
      })
      returnItemsByReturn.set(rid, arr)
    }

    const sales = salesRows.map((s) => ({
      ...s,
      // Если у продажи нет своего оператора — показываем оператора смены.
      operator:
        (s.operator_id ? operatorById.get(String(s.operator_id)) || null : null) ||
        shiftOperator ||
        null,
      customer: s.customer_id ? customerById.get(String(s.customer_id)) || null : null,
      items: saleItemsBySale.get(String(s.id)) || [],
    }))
    const returns = returnsRows.map((r) => ({
      ...r,
      items: returnItemsByReturn.get(String(r.id)) || [],
    }))

    const shiftWithOperator = shift as any
    if (shiftOperator?.id) {
      shiftWithOperator.operator = {
        id: shiftOperator.id,
        full_name: shiftOperator.full_name,
        short_name: shiftOperator.short_name,
      }
    }
    // Крайний fallback: если оператора смены так и нет — берём из первой продажи
    if (!shiftWithOperator.operator || !shiftWithOperator.operator.id) {
      const { data: firstSale } = await supabase
        .from('point_sales')
        .select('operator_id, operator:operators!operator_id(id, full_name:name, short_name)')
        .eq('shift_id', id)
        .not('operator_id', 'is', null)
        .order('sold_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (firstSale && (firstSale as any).operator) {
        const op = (firstSale as any).operator
        const opObj = Array.isArray(op) ? op[0] : op
        if (opObj?.id) {
          shiftWithOperator.operator = {
            id: opObj.id,
            full_name: opObj.full_name,
            short_name: opObj.short_name,
          }
          shiftWithOperator.operator_source = 'sales'
        }
      }
    }

    return json({
      ok: true,
      data: {
        shift: shiftWithOperator,
        sales,
        returns,
        checklist_runs: runsRes.data || [],
        incidents,
        incidents_summary: {
          fines_total: finesTotal,
          bonuses_total: bonusesTotal,
          count: incidents.length,
        },
        income: incomeRes.data || null,
        client_debts: debtsRes.data || [],
      },
    })
  } catch (error) {
    return json(
      { error: 'admin-shift-detail-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}

// ─── Админ-действия над сменой: closeForce, purge ───────────────────────────
function canManageShift(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageShift(access)) return json({ error: 'forbidden' }, 403)

    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'closeForce' | 'purge'
      note?: string
      confirm?: string
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null

    if (body.action === 'closeForce') {
      const deniedClose = await requireCapability(access, 'shifts-reports.close_force')
      if (deniedClose) return deniedClose as any
      const { error: rpcErr } = await supabase.rpc('point_shift_admin_close', {
        p_shift_id: id,
        p_actor_user_id: actorUserId,
        p_note: (body.note || '').trim() || null,
      })
      if (rpcErr) {
        const msg = String(rpcErr.message || '')
        if (msg.includes('shift-not-found')) return json({ error: 'shift-not-found' }, 404)
        if (msg.includes('shift-already-closed')) return json({ error: 'shift-already-closed' }, 409)
        throw rpcErr
      }
      return json({ ok: true })
    }

    if (body.action === 'purge') {
      const deniedPurge = await requireCapability(access, 'shifts-reports.purge')
      if (deniedPurge) return deniedPurge as any
      // Только super-admin может удалять смены целиком
      if (!access.isSuperAdmin) return json({ error: 'forbidden', message: 'Удаление смены — только для суперадмина' }, 403)
      if (body.confirm !== 'УДАЛИТЬ СМЕНУ') {
        return json({ error: 'confirm-phrase-required', message: 'Введите фразу подтверждения: УДАЛИТЬ СМЕНУ' }, 400)
      }
      const { data, error: rpcErr } = await supabase.rpc('point_shift_admin_purge', {
        p_shift_id: id,
        p_actor_user_id: actorUserId,
      })
      if (rpcErr) throw rpcErr
      const result = Array.isArray(data) ? data[0] : data
      return json({ ok: true, data: result })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    return json(
      { error: 'admin-shift-action-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
