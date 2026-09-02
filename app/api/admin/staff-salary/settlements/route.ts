import { NextResponse } from 'next/server'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireAddon } from '@/lib/server/entitlements'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { listOrganizationStaffIds, resolveCompanyScope } from '@/lib/server/organizations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type SettlementRow = {
  id: string
  staff_id: string
  organization_id: string | null
  period_month: string
  slot: 'first' | 'second'
  scheduled_date: string
  opened_date: string
  period_start: string
  period_end: string
  base_amount: number
  bonus_amount: number
  debt_amount: number
  fine_amount: number
  advance_amount: number
  net_due: number
  paid_amount: number
  balance_adjustment: number
  remaining_amount: number
  status: string
  source_payment_id: number | null
  snapshot: Record<string, unknown> | null
  created_at: string
  updated_at: string
  closed_at: string | null
}

type StaffRow = {
  id: string
  full_name: string
  short_name: string | null
}

type EventRow = {
  id: string
  settlement_id: string
  event_type: string
  amount: number
  balance_delta: number
  before_remaining: number
  after_remaining: number
  business_date: string
  metadata: Record<string, unknown> | null
  created_at: string
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

function toInt(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const addonDenied = await requireAddon(access, 'addon.salary')
    if (addonDenied) return addonDenied
    const capabilityDenied = await requireCapability(access, 'salary.view')
    if (capabilityDenied) return capabilityDenied

    const url = new URL(request.url)
    const requestedMonth = url.searchParams.get('month')
    const requestedStaffId = url.searchParams.get('staffId')

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedStaffIds = scope.allowedCompanyIds
      ? await listOrganizationStaffIds({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        })
      : null

    if (requestedStaffId && allowedStaffIds && !allowedStaffIds.includes(requestedStaffId)) {
      return json({ error: 'Сотрудник недоступен в выбранной организации.' }, 403)
    }

    const db = createAdminSupabaseClient()
    let settlementQuery = db
      .from('staff_salary_settlements')
      .select('*')
      .order('scheduled_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (requestedStaffId) settlementQuery = settlementQuery.eq('staff_id', requestedStaffId)
    else if (allowedStaffIds) {
      if (allowedStaffIds.length === 0) {
        return json({ rows: [], events: [], totals: { due: 0, paid: 0, remaining: 0, adjustments: 0, openCount: 0 } })
      }
      settlementQuery = settlementQuery.in('staff_id', allowedStaffIds)
    }

    if (requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)) {
      const monthStart = `${requestedMonth}-01`
      const [year, month] = requestedMonth.split('-').map(Number)
      const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
      settlementQuery = settlementQuery.gte('period_month', monthStart).lt('period_month', nextMonth)
    }

    const { data: settlements, error: settlementsError } = await settlementQuery
    if (settlementsError) throw settlementsError

    const settlementRows = (settlements ?? []) as SettlementRow[]
    const staffIds = [...new Set(settlementRows.map((row) => row.staff_id))]
    let staffRows: StaffRow[] = []
    if (staffIds.length > 0) {
      const { data: staff, error: staffError } = await db
        .from('staff')
        .select('id,full_name,short_name')
        .in('id', staffIds)
      if (staffError) throw staffError
      staffRows = (staff ?? []) as StaffRow[]
    }
    const staffById = new Map(staffRows.map((row) => [row.id, row]))

    let events: EventRow[] = []
    const settlementIds = settlementRows.map((row) => row.id)
    if (settlementIds.length > 0) {
      const { data: eventRows, error: eventError } = await db
        .from('staff_salary_settlement_events')
        .select('id,settlement_id,event_type,amount,balance_delta,before_remaining,after_remaining,business_date,metadata,created_at')
        .in('settlement_id', settlementIds)
        .order('created_at', { ascending: false })
        .limit(500)
      if (eventError) throw eventError
      events = (eventRows ?? []) as EventRow[]
    }

    const rows = settlementRows.map((row) => {
      const person = staffById.get(row.staff_id)
      return {
        ...row,
        staff_name: person?.short_name || person?.full_name || 'Сотрудник',
        staff_full_name: person?.full_name || null,
      }
    })

    const totals = rows.reduce(
      (acc, row) => {
        acc.due += toInt(row.net_due)
        acc.paid += toInt(row.paid_amount)
        acc.remaining += Math.max(toInt(row.remaining_amount), 0)
        acc.adjustments += toInt(row.balance_adjustment)
        if (toInt(row.remaining_amount) > 0) acc.openCount += 1
        return acc
      },
      { due: 0, paid: 0, remaining: 0, adjustments: 0, openCount: 0 },
    )

    return json({ rows, events, totals })
  } catch (error) {
    console.error('[staff-salary-settlements] GET failed', error)
    const message = error instanceof Error ? error.message : 'Не удалось загрузить расчёты зарплаты.'
    return json({ error: message }, 500)
  }
}
