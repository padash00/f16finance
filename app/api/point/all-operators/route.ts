import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase } = point

    const orgIds: string[] = []
    if (point.device.company_ids.length > 0) {
      const { data: companies, error: companiesError } = await supabase
        .from('companies')
        .select('organization_id')
        .in('id', point.device.company_ids)

      if (companiesError) throw companiesError
      const seen = new Set<string>()
      for (const row of companies || []) {
        const oid = (row as any)?.organization_id
        if (oid && !seen.has(String(oid))) {
          seen.add(String(oid))
          orgIds.push(String(oid))
        }
      }
    }

    const { data: assignments, error: assignmentsError } = await supabase
      .from('operator_company_assignments')
      .select('operator_id')
      .in('company_id', point.device.company_ids)
      .eq('is_active', true)

    if (assignmentsError) throw assignmentsError

    const allowedOperatorIdSet = new Set<string>()
    for (const a of assignments || []) {
      const id = (a as any)?.operator_id
      if (id) allowedOperatorIdSet.add(String(id))
    }

    const staffDebtors = new Map<
      string,
      { id: string; name: string; short_name: string | null; full_name: string | null; kind: 'staff' }
    >()

    let members: any[] = []
    if (orgIds.length > 0) {
      const { data: membersRaw, error: membersError } = await supabase
        .from('organization_members')
        .select('id, staff_id, email, role')
        .eq('status', 'active')
        .in('organization_id', orgIds)
        .in('role', ['owner', 'manager', 'marketer'])

      if (membersError) throw membersError
      members = membersRaw || []

      const staffIdsForOrgRoles = [
        ...new Set(
          members.map((m: any) => m.staff_id).filter(Boolean).map((id: unknown) => String(id)),
        ),
      ]

      if (staffIdsForOrgRoles.length > 0) {
        const { data: staffOperatorLinks, error: linkErr } = await supabase
          .from('operator_staff_links')
          .select('operator_id')
          .in('staff_id', staffIdsForOrgRoles)

        if (linkErr) throw linkErr
        for (const row of staffOperatorLinks || []) {
          const oid = (row as any)?.operator_id
          if (oid) allowedOperatorIdSet.add(String(oid))
        }
      }

      const staffIds = [...staffIdsForOrgRoles]

      const staffByStaffId = new Map<string, { full_name: string | null; short_name: string | null; email: string | null; is_active: boolean | null }>()
      if (staffIds.length > 0) {
        const { data: staffData, error: staffErr } = await supabase
          .from('staff')
          .select('id, full_name, short_name, email, is_active')
          .in('id', staffIds)

        if (staffErr) throw staffErr
        for (const s of staffData || []) {
          if (s?.id) staffByStaffId.set(String(s.id), s as any)
        }
      }

      for (const m of members) {
        const memberId = String((m as any).id || '')
        const staffIdRaw = (m as any).staff_id
        const emailRaw = typeof (m as any).email === 'string' ? (m as any).email.trim() : ''

        const addOrgMemberByEmail = () => {
          if (!memberId || !emailRaw) return
          const rowId = `orgmember:${memberId}`
          if (staffDebtors.has(rowId)) return
          staffDebtors.set(rowId, {
            id: rowId,
            name: emailRaw,
            short_name: null,
            full_name: null,
            kind: 'staff' as const,
          })
        }

        if (staffIdRaw) {
          const sid = String(staffIdRaw)
          const s = staffByStaffId.get(sid)
          // Members here are owner/manager/marketer — list them for debts even if staff.is_active is false
          // (no separate operators row needed; debt uses client_name via staff: id on the client).
          if (s) {
            const rowId = `staff:${sid}`
            if (!staffDebtors.has(rowId)) {
              const display =
                [s.full_name, s.short_name, s.email].map((x: string | null) => (x || '').trim()).find(Boolean) ||
                'Сотрудник'
              staffDebtors.set(rowId, {
                id: rowId,
                name: display,
                short_name: s.short_name || null,
                full_name: s.full_name || null,
                kind: 'staff' as const,
              })
            }
          } else {
            addOrgMemberByEmail()
          }
        } else {
          addOrgMemberByEmail()
        }
      }
    }

    const allowedOperatorIds = [...allowedOperatorIdSet]
    const { data, error } = await supabase
      .from('operators')
      .select('id, name, short_name, is_active, operator_profiles(full_name)')
      .eq('is_active', true)
      .in('id', allowedOperatorIds.length > 0 ? allowedOperatorIds : ['__none__'])

    if (error) throw error

    const operators = ((data || []) as any[])
      .map((op) => {
        if (!op?.id || op.is_active === false) return null
        const profile = Array.isArray(op.operator_profiles)
          ? op.operator_profiles[0] || null
          : op.operator_profiles || null
        return {
          id: op.id,
          name: op.name,
          short_name: op.short_name || null,
          full_name: profile?.full_name || null,
          kind: 'operator' as const,
        }
      })
      .filter(Boolean)

    const combined = [...operators, ...staffDebtors.values()].sort((a: any, b: any) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'ru'),
    )

    return json({ ok: true, operators: combined })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-all-operators',
      message: error?.message || 'Failed to load operators',
    })
    return json({ error: error?.message || 'Не удалось загрузить операторов' }, 500)
  }
}
