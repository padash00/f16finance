import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks (если есть выше) уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const status = (url.searchParams.get('status') || 'closed').trim()
    const companyId = url.searchParams.get('company_id') || null
    const operatorId = url.searchParams.get('operator_id') || null
    const dateFrom = url.searchParams.get('date_from') || null
    const dateTo = url.searchParams.get('date_to') || null
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500)

    let query = supabase
      .from('point_shifts')
      .select(
        `id, company_id, organization_id, operator_id, point_device_id,
         status, shift_type, opened_at, closed_at,
         opening_cash, closing_cash, closing_kaspi, totals_json,
         z_report_url, x_report_url, handover_from_shift_id,
         company:company_id ( id, name, code )`,
      )
      .order('opened_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (companyId) query = query.eq('company_id', companyId)
    if (operatorId) query = query.eq('operator_id', operatorId)
    if (dateFrom) query = query.gte('opened_at', dateFrom)
    if (dateTo) query = query.lte('opened_at', dateTo)

    if (companyScope.allowedCompanyIds) {
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    const shifts = (data || []) as any[]

    // Оператор смены — это кассир из таблицы `operators` (а НЕ админ-`staff`).
    // Прямой lookup по operator_id; staff — как запас (если смену открыл админ).
    const directOpIds = Array.from(
      new Set(shifts.map((s) => s.operator_id).filter(Boolean) as string[]),
    )
    if (directOpIds.length > 0) {
      const [opsRes, staffRes] = await Promise.all([
        supabase.from('operators').select('id, full_name:name, short_name').in('id', directOpIds),
        supabase.from('staff').select('id, full_name, short_name').in('id', directOpIds),
      ])
      const byId = new Map<string, any>()
      for (const o of (opsRes.data || []) as any[]) byId.set(String(o.id), o)
      for (const st of (staffRes.data || []) as any[]) if (!byId.has(String(st.id))) byId.set(String(st.id), st)
      for (const s of shifts) {
        const op = s.operator_id ? byId.get(String(s.operator_id)) : null
        if (op) s.operator = { id: op.id, full_name: op.full_name, short_name: op.short_name }
      }
    }

    // Fallback: для смен без оператора подтягиваем оператора-кассира
    // (а) из первой продажи смены через shift_id
    // (б) если shift_id не проставлен в продажах — через окно времени смены и компанию
    const shiftsWithoutOperator = shifts.filter((s) => !s.operator || !s.operator.id)
    if (shiftsWithoutOperator.length > 0) {
      const shiftIds = shiftsWithoutOperator.map((s) => s.id)
      const firstOperatorIdByShift = new Map<string, string>()

      // Способ 0 (самый надёжный): аудит-лог открытия смены. При открытии пишется
      // настоящий operator_id (из operators), даже если в point_shifts.operator_id
      // (staff) пусто из-за отсутствия линка operator→staff.
      const { data: openLogs } = await supabase
        .from('audit_log')
        .select('entity_id, payload')
        .eq('action', 'point_shift.open')
        .in('entity_id', shiftIds)
      for (const log of (openLogs || []) as any[]) {
        const sid = String(log.entity_id || '')
        const opId = log.payload?.operator_id
        if (sid && opId && !firstOperatorIdByShift.has(sid)) {
          firstOperatorIdByShift.set(sid, String(opId))
        }
      }

      // Способ A: одной выборкой — без вложенного join, только operator_id
      const { data: salesByShift } = await supabase
        .from('point_sales')
        .select('shift_id, operator_id, sold_at')
        .in('shift_id', shiftIds)
        .not('operator_id', 'is', null)
        .order('sold_at', { ascending: true })

      for (const row of salesByShift || []) {
        const sid = String((row as any).shift_id || '')
        const opId = (row as any).operator_id
        if (!sid || !opId) continue
        if (!firstOperatorIdByShift.has(sid)) firstOperatorIdByShift.set(sid, String(opId))
      }

      // Способ B: для оставшихся — параллельно через company_id + временное окно
      const stillMissing = shiftsWithoutOperator.filter(
        (s) => !firstOperatorIdByShift.has(s.id) && s.company_id && s.opened_at,
      )
      if (stillMissing.length > 0) {
        const fallback = await Promise.all(
          stillMissing.map((s) =>
            supabase
              .from('point_sales')
              .select('operator_id')
              .eq('company_id', s.company_id)
              .gte('sold_at', s.opened_at)
              .lte('sold_at', s.closed_at || new Date().toISOString())
              .not('operator_id', 'is', null)
              .order('sold_at', { ascending: true })
              .limit(1)
              .maybeSingle()
              .then((res) => ({ shiftId: s.id, opId: (res?.data as any)?.operator_id || null })),
          ),
        )
        for (const r of fallback) {
          if (r.opId) firstOperatorIdByShift.set(r.shiftId, String(r.opId))
        }
      }

      // Одной выборкой подтянуть имена операторов
      const operatorIds = Array.from(new Set(Array.from(firstOperatorIdByShift.values())))
      if (operatorIds.length > 0) {
        const { data: opsData } = await supabase
          .from('operators')
          .select('id, full_name:name, short_name')
          .in('id', operatorIds)
        const operatorById = new Map<string, any>(
          (opsData || []).map((o: any) => [String(o.id), o]),
        )
        for (const s of shifts) {
          if (s.operator && s.operator.id) continue
          const opId = firstOperatorIdByShift.get(s.id)
          if (!opId) continue
          const op = operatorById.get(opId)
          if (op) {
            s.operator = { id: op.id, full_name: op.full_name, short_name: op.short_name }
            s.operator_source = 'sales'
          }
        }
      }
    }

    // Живые суммы для ОТКРЫТЫХ смен (closing_cash/kaspi ещё пустые → берём из продаж).
    const openShiftIds = shifts.filter((s) => s.status === 'open').map((s) => s.id)
    if (openShiftIds.length > 0) {
      const { data: openSales } = await supabase
        .from('point_sales')
        .select('shift_id, cash_amount, kaspi_amount, total_amount')
        .in('shift_id', openShiftIds)
      const byShift = new Map<string, { sales: number; cash: number; kaspi: number; count: number }>()
      for (const r of (openSales || []) as any[]) {
        const k = String(r.shift_id || '')
        if (!k) continue
        const a = byShift.get(k) || { sales: 0, cash: 0, kaspi: 0, count: 0 }
        a.sales += Number(r.total_amount || 0)
        a.cash += Number(r.cash_amount || 0)
        a.kaspi += Number(r.kaspi_amount || 0)
        a.count += 1
        byShift.set(k, a)
      }
      for (const s of shifts) {
        if (s.status === 'open') s.live_totals = byShift.get(String(s.id)) || { sales: 0, cash: 0, kaspi: 0, count: 0 }
      }
    }

    return json({ ok: true, data: { shifts } })
  } catch (error) {
    return json(
      { error: 'admin-shifts-reports-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
