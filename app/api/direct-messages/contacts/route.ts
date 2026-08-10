import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { listOrganizationCompanyIds } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Кому можно написать.
 *
 * Личные сообщения умели только отвечать в существующей переписке: начать её
 * было нельзя — адресата взять неоткуда. То есть написать первым мог лишь тот,
 * кому уже написали.
 *
 * Отдаём людей своей организации: сотрудников и операторов. Границу держит
 * организация — оператор другой организации в список не попадёт, как и не
 * пройдёт проверку при отправке.
 *
 *   GET /api/direct-messages/contacts?search=
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Contact = {
  user_id: string
  name: string
  role: string | null
  kind: 'staff' | 'operator'
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ data: [] })

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const search = String(new URL(request.url).searchParams.get('search') || '').trim().toLowerCase()

    // Сотрудники организации. Связь с учётной записью — через
    // `organization_members`: в самой `staff` колонки `user_id` нет, и
    // обращение к ней молча возвращало пусто.
    const staffQuery = supabase
      .from('organization_members')
      .select('user_id, email, role, status, staff:staff_id(full_name, short_name, role, is_active)')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .not('user_id', 'is', null)

    // Операторы — через точки организации: у оператора своей организации нет,
    // он привязан к точкам, а те уже к организации.
    const companyIds = await listOrganizationCompanyIds({
      activeOrganizationId: orgId,
      isSuperAdmin: false,
    })

    const operatorQuery = companyIds && companyIds.length > 0
      ? supabase
          .from('operator_company_assignments')
          .select('operator_id, is_active, company_id, operator:operator_id(id, name, short_name, is_active, operator_profiles(full_name))')
          .in('company_id', companyIds)
          .eq('is_active', true)
      : null

    const [staffRes, operatorRes, authRes] = await Promise.all([
      staffQuery,
      operatorQuery,
      supabase.from('operator_auth').select('operator_id, user_id, is_active'),
    ])

    if (staffRes.error) throw staffRes.error

    const contacts: Contact[] = []
    const seen = new Set<string>([access.user?.id || ''])

    for (const row of (staffRes.data as any[]) || []) {
      const person = Array.isArray(row.staff) ? row.staff[0] : row.staff
      if (person?.is_active === false) continue
      const userId = String(row.user_id || '')
      if (!userId || seen.has(userId)) continue
      seen.add(userId)
      contacts.push({
        user_id: userId,
        // Почта — последнее, чем можно назвать человека: хуже, чем имя, но
        // лучше, чем «Сотрудник» в списке из пяти одинаковых строк.
        name: String(person?.full_name || person?.short_name || row.email || 'Сотрудник'),
        role: person?.role || row.role || null,
        kind: 'staff',
      })
    }

    // Оператору пишут по его пользователю: без учётной записи он сообщение не
    // прочитает, поэтому в список такие не попадают.
    const userByOperator = new Map<string, string>()
    for (const row of (authRes.data as any[]) || []) {
      if (row.is_active === false) continue
      if (row.operator_id && row.user_id) userByOperator.set(String(row.operator_id), String(row.user_id))
    }

    for (const row of (operatorRes?.data as any[]) || []) {
      const person = Array.isArray(row.operator) ? row.operator[0] : row.operator
      if (!person || person.is_active === false) continue
      const userId = userByOperator.get(String(row.operator_id))
      if (!userId || seen.has(userId)) continue
      seen.add(userId)
      contacts.push({
        user_id: userId,
        name: getOperatorDisplayName(person) || 'Оператор',
        role: 'operator',
        kind: 'operator',
      })
    }

    const filtered = search
      ? contacts.filter((c) => c.name.toLowerCase().includes(search))
      : contacts

    filtered.sort((a, b) => a.name.localeCompare(b.name, 'ru'))

    return json({ data: filtered })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/direct-messages/contacts GET',
      message: error?.message || 'error',
    })
    return json({ error: 'contacts-failed' }, 500)
  }
}
