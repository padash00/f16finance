import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { listOrganizationCompanyIds, listOrganizationOperatorIds, resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type NotificationItem = {
  id: string
  title: string
  subtitle?: string | null
  href?: string | null
  date?: string | null
}

type NotificationGroup = {
  id: string
  label: string
  icon: 'clipboard' | 'cake' | 'receipt'
  href: string
  count: number
  items: NotificationItem[]
}

function getDaysUntilBirthday(birthDate: string, now: Date): number | null {
  const [, month, day] = birthDate.split('-').map(Number)
  if (!month || !day) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(now.getFullYear(), month - 1, day)
  if (next < today) next = new Date(now.getFullYear() + 1, month - 1, day)
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedOperatorIds = await listOrganizationOperatorIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const groups: NotificationGroup[] = []

    // ── Pending inventory requests ──────────────────────────────────────────
    try {
      let requestsQuery = supabase
        .from('inventory_requests')
        .select('id, status, created_at, requesting_company_id, company:companies!requesting_company_id(name)')
        .in('status', ['new', 'disputed'])
        .order('created_at', { ascending: false })
        .limit(10)

      if (companyScope.allowedCompanyIds) {
        requestsQuery = requestsQuery.in('requesting_company_id', companyScope.allowedCompanyIds)
      }

      const { data: requestRows } = await requestsQuery
      if (requestRows && requestRows.length > 0) {
        const items: NotificationItem[] = requestRows.slice(0, 5).map((row: any) => {
          const company = Array.isArray(row.company) ? row.company[0] : row.company
          return {
            id: String(row.id),
            title: company?.name || 'Точка',
            subtitle: row.status === 'disputed' ? 'Спорная' : 'Новая заявка',
            href: '/store/requests',
            date: row.created_at || null,
          }
        })
        groups.push({
          id: 'requests',
          label: 'Заявки ждут решения',
          icon: 'clipboard',
          href: '/store/requests',
          count: requestRows.length,
          items,
        })
      }
    } catch (e) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/notifications.requests',
        message: (e as any)?.message || 'requests-section-failed',
      })
    }

    // ── Upcoming birthdays (7 days) ─────────────────────────────────────────
    try {
      let operatorsQuery = supabase
        .from('operators')
        .select('id, name, short_name, operator_profiles(full_name, birth_date)')
        .eq('is_active', true)

      if (allowedOperatorIds) operatorsQuery = operatorsQuery.in('id', allowedOperatorIds)

      const { data: operators } = await operatorsQuery

      const now = new Date()
      const birthdayItems: NotificationItem[] = []
      for (const row of operators || []) {
        const profile = Array.isArray((row as any).operator_profiles)
          ? (row as any).operator_profiles[0]
          : (row as any).operator_profiles
        const birthDate = profile?.birth_date
        if (!birthDate) continue
        const daysUntil = getDaysUntilBirthday(birthDate, now)
        if (daysUntil == null || daysUntil > 7) continue
        birthdayItems.push({
          id: String((row as any).id),
          title: profile?.full_name || (row as any).name,
          subtitle: daysUntil === 0 ? 'Сегодня!' : `Через ${daysUntil} дн.`,
          href: '/birthdays',
          date: birthDate,
        })
      }
      birthdayItems.sort((a, b) => {
        const da = getDaysUntilBirthday(a.date || '', now) ?? 999
        const db = getDaysUntilBirthday(b.date || '', now) ?? 999
        return da - db
      })
      if (birthdayItems.length > 0) {
        groups.push({
          id: 'birthdays',
          label: 'Дни рождения',
          icon: 'cake',
          href: '/birthdays',
          count: birthdayItems.length,
          items: birthdayItems.slice(0, 5),
        })
      }
    } catch (e) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/notifications.birthdays',
        message: (e as any)?.message || 'birthdays-section-failed',
      })
    }

    // ── Unpaid point debts ──────────────────────────────────────────────────
    try {
      let debtsQuery = supabase
        .from('point_debts')
        .select('id, amount, note, created_at, company_id, company:companies!company_id(name)')
        .eq('is_paid', false)
        .order('created_at', { ascending: false })
        .limit(10)

      if (allowedCompanyIds) debtsQuery = debtsQuery.in('company_id', allowedCompanyIds)

      const { data: debts } = await debtsQuery
      if (debts && debts.length > 0) {
        const items: NotificationItem[] = debts.slice(0, 5).map((row: any) => {
          const company = Array.isArray(row.company) ? row.company[0] : row.company
          return {
            id: String(row.id),
            title: company?.name || 'Точка',
            subtitle: `${Number(row.amount || 0).toLocaleString('ru-RU')} ₸`,
            href: '/point-debts',
            date: row.created_at || null,
          }
        })
        groups.push({
          id: 'debts',
          label: 'Долги с точки',
          icon: 'receipt',
          href: '/point-debts',
          count: debts.length,
          items,
        })
      }
    } catch {
      // point_debts table may not exist in all deployments — silently skip
    }

    const total = groups.reduce((sum, g) => sum + g.count, 0)
    return json({ ok: true, data: { total, groups } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/notifications.GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось загрузить уведомления' }, 500)
  }
}
