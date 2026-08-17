/**
 * Карточка коллеги для чата: точка, стаж, на смене ли сейчас.
 *
 * В общем чате пишут по именам, и первый вопрос — «кто это». Отвечать на него
 * админскими маршрутами нельзя: они закрыты правами, которых у оператора нет,
 * да и незачем — оператору не нужен весь профиль коллеги.
 *
 * Поэтому здесь ровно три факта и ничего больше. Телефон намеренно не
 * отдаётся: рабочий чат для этого и существует, а личный номер коллеги — не
 * то, что человек соглашался показывать всей смене.
 *
 * Изоляция строгая: спрашивать можно только про людей своей организации.
 * Иначе по чужому идентификатору можно было бы узнать, где человек работает.
 */
import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { listOrganizationCompanyIds } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ error: 'no-organization' }, 400)

    const userId = String(new URL(request.url).searchParams.get('userId') || '').trim()
    if (!userId) return json({ error: 'userId обязателен' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const companyIds = await listOrganizationCompanyIds({
      activeOrganizationId: orgId,
      isSuperAdmin: false,
    })

    // Кто это: оператор или сотрудник офиса.
    const { data: auth } = await supabase
      .from('operator_auth')
      .select('operator_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle()

    if (!auth?.operator_id) {
      // Сотрудник офиса: точек и смен у него нет, показываем должность.
      const { data: member } = await supabase
        .from('organization_members')
        .select('role, staff:staff_id(full_name, short_name, role)')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle()

      if (!member) return json({ error: 'not-found' }, 404)
      const person = Array.isArray((member as any).staff) ? (member as any).staff[0] : (member as any).staff

      return json({
        data: {
          name: person?.full_name || person?.short_name || 'Сотрудник',
          position: person?.role || (member as any).role || null,
          companies: [],
          hire_date: null,
          on_shift: false,
          shift_company: null,
        },
      })
    }

    const operatorId = String(auth.operator_id)

    const [assignmentsRes, profileRes, operatorRes, linkRes] = await Promise.all([
      supabase
        .from('operator_company_assignments')
        .select('company_id, is_active, company:company_id(id, name)')
        .eq('operator_id', operatorId)
        .eq('is_active', true),
      supabase
        .from('operator_profiles')
        .select('position, hire_date')
        .eq('operator_id', operatorId)
        .maybeSingle(),
      supabase.from('operators').select('name, short_name').eq('id', operatorId).maybeSingle(),
      supabase.from('operator_staff_links').select('staff_id').eq('operator_id', operatorId).limit(1),
    ])

    const assignments = (assignmentsRes.data as any[]) || []
    // Чужая организация: человек с таким входом есть, но не наш — отвечаем как
    // на несуществующего, чтобы ответ не работал справочником по чужим точкам.
    const own = assignments.filter((row) => companyIds.includes(String(row.company_id)))
    if (own.length === 0) return json({ error: 'not-found' }, 404)

    // На смене ли сейчас: открытая смена на одной из своих точек, где хозяин —
    // он. Смену открывает staff-запись, поэтому идём через связку.
    const staffId = ((linkRes.data as any[]) || [])[0]?.staff_id || null
    let onShift = false
    let shiftCompany: string | null = null

    if (staffId) {
      const { data: shift } = await supabase
        .from('point_shifts')
        .select('id, company_id, company:company_id(name)')
        .eq('status', 'open')
        .eq('operator_id', staffId)
        .in(
          'company_id',
          own.map((row) => String(row.company_id)),
        )
        .maybeSingle()

      if (shift) {
        onShift = true
        const company = Array.isArray((shift as any).company)
          ? (shift as any).company[0]
          : (shift as any).company
        shiftCompany = company?.name || null
      }
    }

    return json({
      data: {
        name: getOperatorDisplayName(operatorRes.data as any) || 'Оператор',
        position: profileRes.data?.position || 'Оператор',
        companies: own
          .map((row) => {
            const company = Array.isArray(row.company) ? row.company[0] : row.company
            return company?.name || null
          })
          .filter(Boolean),
        hire_date: profileRes.data?.hire_date || null,
        on_shift: onShift,
        shift_company: shiftCompany,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/team-chat/person GET',
      message: error?.message || 'error',
    })
    return json({ error: 'person-failed' }, 500)
  }
}
