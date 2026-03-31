import { NextResponse } from 'next/server'

import { listOrganizationCompanyIds, listOrganizationOperatorIds } from '@/lib/server/organizations'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type OperatorRow = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
  telegram_chat_id: string | null
  operator_profiles?:
    | {
        full_name?: string | null
        birth_date?: string | null
        position?: string | null
        photo_url?: string | null
      }
    | Array<{
        full_name?: string | null
        birth_date?: string | null
        position?: string | null
        photo_url?: string | null
      }>
    | null
}

type AssignmentRow = {
  operator_id: string
  company_id: string
  is_primary: boolean
  company?: { id: string; name: string; code: string | null } | Array<{ id: string; name: string; code: string | null }> | null
}

function getNextBirthdayParts(birthDate: string, now: Date) {
  const [year, month, day] = birthDate.split('-').map(Number)
  if (!month || !day) return null

  const currentYear = now.getFullYear()
  let nextBirthday = new Date(currentYear, month - 1, day)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (nextBirthday < todayStart) {
    nextBirthday = new Date(currentYear + 1, month - 1, day)
  }

  const diffMs = nextBirthday.getTime() - todayStart.getTime()
  const daysUntil = Math.round(diffMs / 86_400_000)
  const age = year ? nextBirthday.getFullYear() - year : null

  return {
    month,
    day,
    age,
    nextBirthday: nextBirthday.toISOString(),
    daysUntil,
  }
}

function getPrimaryProfile(
  profile:
    | OperatorRow['operator_profiles']
    | undefined,
) {
  if (!profile) return null
  return Array.isArray(profile) ? profile[0] || null : profile
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'operator_structure')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const allowedOperatorIds = await listOrganizationOperatorIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    if (!access.isSuperAdmin && (!allowedOperatorIds || allowedOperatorIds.length === 0)) {
      return json({
        ok: true,
        data: {
          items: [],
          stats: {
            total: 0,
            today: 0,
            week: 0,
            month: 0,
            withoutBirthDate: 0,
          },
        },
      })
    }

    let operatorsQuery = supabase
      .from('operators')
      .select('id, name, short_name, is_active, telegram_chat_id, operator_profiles(full_name, birth_date, position, photo_url)')
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (allowedOperatorIds) {
      operatorsQuery = operatorsQuery.in('id', allowedOperatorIds)
    }

    let assignmentsQuery = supabase
      .from('operator_company_assignments')
      .select('operator_id, company_id, is_primary, company:company_id(id, name, code)')
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    if (allowedCompanyIds) {
      assignmentsQuery = assignmentsQuery.in('company_id', allowedCompanyIds)
    }

    const [operatorsRes, assignmentsRes] = await Promise.all([operatorsQuery, assignmentsQuery])

    if (operatorsRes.error) throw operatorsRes.error
    if (assignmentsRes.error) throw assignmentsRes.error

    const assignmentsByOperator = new Map<string, AssignmentRow[]>()
    for (const rawItem of ((assignmentsRes.data || []) as unknown[])) {
      const item = rawItem as AssignmentRow
      const company = Array.isArray(item.company) ? item.company[0] || null : item.company || null
      const bucket = assignmentsByOperator.get(item.operator_id) || []
      bucket.push({ ...item, company })
      assignmentsByOperator.set(item.operator_id, bucket)
    }

    const now = new Date()
    const birthdayItems = ((operatorsRes.data || []) as OperatorRow[])
      .map((operator) => {
        const profile = getPrimaryProfile(operator.operator_profiles)
        const birthDate = profile?.birth_date
        if (!birthDate) return null

        const nextBirthday = getNextBirthdayParts(birthDate, now)
        if (!nextBirthday) return null

        const assignments = assignmentsByOperator.get(operator.id) || []
        const primaryAssignment = assignments.find((item) => item.is_primary) || assignments[0] || null
        const primaryCompany =
          primaryAssignment && !Array.isArray(primaryAssignment.company) ? primaryAssignment.company : null

        return {
          id: operator.id,
          name: profile?.full_name?.trim() || operator.name,
          short_name: operator.short_name,
          position: profile?.position || null,
          photo_url: profile?.photo_url || null,
          birth_date: birthDate,
          company_name: primaryCompany?.name || null,
          company_code: primaryCompany?.code || null,
          assignment_count: assignments.length,
          ...nextBirthday,
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        const left = a as NonNullable<typeof a>
        const right = b as NonNullable<typeof b>
        if (left.daysUntil !== right.daysUntil) return left.daysUntil - right.daysUntil
        return left.name.localeCompare(right.name, 'ru')
      })

    const operatorsWithoutBirthday = ((operatorsRes.data || []) as OperatorRow[]).filter((operator) => {
      const profile = getPrimaryProfile(operator.operator_profiles)
      return !profile?.birth_date
    }).length

    return json({
      ok: true,
      data: {
        items: birthdayItems,
        stats: {
          total: birthdayItems.length,
          today: birthdayItems.filter((item: any) => item.daysUntil === 0).length,
          week: birthdayItems.filter((item: any) => item.daysUntil >= 0 && item.daysUntil <= 7).length,
          month: birthdayItems.filter((item: any) => item.daysUntil >= 0 && item.daysUntil <= 30).length,
          withoutBirthDate: operatorsWithoutBirthday,
        },
      },
    })
  } catch (error: any) {
    console.error('Admin birthdays route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/birthdays',
      message: error?.message || 'Admin birthdays route error',
    })
    return json({ error: error?.message || 'Не удалось загрузить дни рождения' }, 500)
  }
}
