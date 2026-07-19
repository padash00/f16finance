import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Платформа: аналитика SaaS (только суперадмин) — MRR, статусы, рост, выручка по месяцам.

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function lastMonths(n: number): string[] {
  const out: string[] = []
  const d = new Date()
  d.setDate(1)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)
    if (!hasAdminSupabaseCredentials()) return json({ data: null })

    const supabase = createAdminSupabaseClient()

    // PostgREST режет ответ до 1000 строк — счета (растут каждый месяц) и списки
    // организаций/подписок забираем постранично, иначе MRR/выручка занижаются.
    const PAGE = 1000
    const fetchAllPages = async (buildQuery: (from: number, to: number) => any): Promise<any[]> => {
      const out: any[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await buildQuery(from, from + PAGE - 1)
        if (error) throw error
        const rows = data || []
        out.push(...rows)
        if (rows.length < PAGE) break
      }
      return out
    }

    const [orgs, subs, invoices] = await Promise.all([
      fetchAllPages((from, to) =>
        supabase.from('organizations').select('id, name, status, created_at').order('id').range(from, to),
      ),
      fetchAllPages((from, to) =>
        supabase.from('organization_subscriptions').select('id, organization_id, status, plan:plan_id(price_monthly)').order('id').range(from, to),
      ),
      fetchAllPages((from, to) =>
        supabase.from('invoices').select('id, organization_id, amount, paid_at, status').order('id').range(from, to),
      ),
    ])
    const orgName = new Map<string, string>(orgs.map((o: any) => [String(o.id), String(o.name || '—')]))

    // Статусы организаций
    const statusBreakdown: Record<string, number> = {}
    for (const o of orgs) {
      const s = String(o.status || 'active')
      statusBreakdown[s] = (statusBreakdown[s] || 0) + 1
    }

    // MRR — активные подписки
    let mrr = 0
    let activeSubs = 0
    for (const s of subs) {
      if (s.status !== 'active') continue
      const plan = Array.isArray(s.plan) ? s.plan[0] : s.plan
      mrr += Number(plan?.price_monthly) || 0
      activeSubs++
    }

    const months = lastMonths(6)

    // Новые организации по месяцам + накопительный рост.
    const newOrgsByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]))
    let beforeWindow = 0
    for (const o of orgs) {
      const key = o.created_at ? String(o.created_at).slice(0, 7) : null
      if (!key) continue
      if (key in newOrgsByMonth) newOrgsByMonth[key]++
      else if (key < months[0]) beforeWindow++
    }
    const cumulativeOrgsByMonth: Record<string, number> = {}
    let running = beforeWindow
    for (const m of months) {
      running += newOrgsByMonth[m]
      cumulativeOrgsByMonth[m] = running
    }

    // Выручка (оплаченные счета) по месяцам + топ-клиенты по оплаченному.
    const revenueByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]))
    const paidByOrg = new Map<string, number>()
    let paidInvoicesTotal = 0
    for (const inv of invoices) {
      if (inv.status !== 'paid') continue
      const amt = Number(inv.amount) || 0
      paidInvoicesTotal += amt
      const oid = String(inv.organization_id || '')
      if (oid) paidByOrg.set(oid, (paidByOrg.get(oid) || 0) + amt)
      if (inv.paid_at) {
        const key = String(inv.paid_at).slice(0, 7)
        if (key in revenueByMonth) revenueByMonth[key] += amt
      }
    }
    const topClients = Array.from(paidByOrg.entries())
      .map(([oid, total]) => ({ name: orgName.get(oid) || '—', total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)

    const churned = (statusBreakdown.canceled || 0) + (statusBreakdown.suspended || 0)

    return json({
      data: {
        totals: {
          organizations: orgs.length,
          activeSubscriptions: activeSubs,
          mrr,
          arpu: activeSubs ? Math.round(mrr / activeSubs) : 0,
          paidInvoicesTotal,
          churned,
        },
        statusBreakdown,
        months,
        newOrgsByMonth,
        cumulativeOrgsByMonth,
        revenueByMonth,
        topClients,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/platform/analytics GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
