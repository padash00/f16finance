import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const ORG_MEMBER_ROLE_RU: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Руководитель',
  marketer: 'Маркетолог',
}

function orgRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null
  return ORG_MEMBER_ROLE_RU[String(role)] || null
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase } = point

    const orgIds: string[] = []
    /** Все компании той же организации — чтобы показать операторов, закреплённых за другой точкой орг., не только за компаниями проекта. */
    const assignmentCompanyIdSet = new Set<string>(point.device.company_ids.map((id) => String(id)))

    if (point.device.company_ids.length > 0) {
      const { data: companies, error: companiesError } = await supabase
        .from('companies')
        .select('id, organization_id')
        .in('id', point.device.company_ids)

      if (companiesError) throw companiesError
      const seenOrg = new Set<string>()
      for (const row of companies || []) {
        const oid = (row as any)?.organization_id
        if (oid && !seenOrg.has(String(oid))) {
          seenOrg.add(String(oid))
          orgIds.push(String(oid))
        }
      }

      if (orgIds.length > 0) {
        const { data: orgCompanies, error: orgCoErr } = await supabase
          .from('companies')
          .select('id')
          .in('organization_id', orgIds)

        if (orgCoErr) throw orgCoErr
        for (const c of orgCompanies || []) {
          if ((c as any)?.id) assignmentCompanyIdSet.add(String((c as any).id))
        }
      }
    }

    const assignmentCompanyIds = [...assignmentCompanyIdSet]

    const { data: assignments, error: assignmentsError } = await supabase
      .from('operator_company_assignments')
      .select('operator_id')
      .in('company_id', assignmentCompanyIds.length > 0 ? assignmentCompanyIds : ['__none__'])
      .eq('is_active', true)

    if (assignmentsError) throw assignmentsError

    const allowedOperatorIdSet = new Set<string>()
    for (const a of assignments || []) {
      const id = (a as any)?.operator_id
      if (id) allowedOperatorIdSet.add(String(id))
    }

    const staffDebtors = new Map<
      string,
      {
        id: string
        name: string
        short_name: string | null
        full_name: string | null
        kind: 'staff'
        role_label: string | null
      }
    >()

    /** staff_id → operator_id: если оператор уже в списке, строку staff: не показываем (иначе дубль ФИО + «Руководитель»). */
    const staffIdToOperatorId = new Map<string, string>()
    /** user_id (Supabase) → operator_id из operator_auth */
    const userIdToOperatorId = new Map<string, string>()

    let members: any[] = []
    if (orgIds.length > 0) {
      const { data: membersRaw, error: membersError } = await supabase
        .from('organization_members')
        .select('id, staff_id, user_id, email, role')
        .eq('status', 'active')
        .in('organization_id', orgIds)
        .in('role', ['owner', 'manager', 'marketer'])

      if (membersError) throw membersError
      members = membersRaw || []

      const memberUserIds = [
        ...new Set(
          members.map((m: any) => m.user_id).filter(Boolean).map((id: unknown) => String(id)),
        ),
      ]
      if (memberUserIds.length > 0) {
        const { data: authByUser, error: authByUserErr } = await supabase
          .from('operator_auth')
          .select('operator_id, user_id')
          .in('user_id', memberUserIds)
          .eq('is_active', true)

        if (authByUserErr) throw authByUserErr
        for (const row of authByUser || []) {
          const opid = (row as any)?.operator_id
          const uid = (row as any)?.user_id
          if (opid) allowedOperatorIdSet.add(String(opid))
          if (opid && uid) userIdToOperatorId.set(String(uid), String(opid))
        }
      }

      const staffIdsForOrgRoles = [
        ...new Set(
          members.map((m: any) => m.staff_id).filter(Boolean).map((id: unknown) => String(id)),
        ),
      ]

      if (staffIdsForOrgRoles.length > 0) {
        const { data: staffOperatorLinks, error: linkErr } = await supabase
          .from('operator_staff_links')
          .select('operator_id, staff_id')
          .in('staff_id', staffIdsForOrgRoles)

        if (linkErr) throw linkErr
        for (const row of staffOperatorLinks || []) {
          const oid = (row as any)?.operator_id
          const sid = (row as any)?.staff_id
          if (oid) allowedOperatorIdSet.add(String(oid))
          if (oid && sid) staffIdToOperatorId.set(String(sid), String(oid))
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
        const memberRole = String((m as any).role || '')
        const roleLabel = orgRoleLabel(memberRole)

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
            role_label: roleLabel,
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
                role_label: roleLabel,
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

    const operatorIdsInResponse = new Set(operators.map((o: any) => String(o.id)))
    for (const [staffId, opId] of staffIdToOperatorId) {
      if (operatorIdsInResponse.has(opId)) {
        staffDebtors.delete(`staff:${staffId}`)
      }
    }
    for (const m of members) {
      const mid = String((m as any).id || '')
      const uid = (m as any).user_id
      if (!mid || !uid) continue
      const opId = userIdToOperatorId.get(String(uid))
      if (opId && operatorIdsInResponse.has(opId)) {
        staffDebtors.delete(`orgmember:${mid}`)
      }
    }

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
