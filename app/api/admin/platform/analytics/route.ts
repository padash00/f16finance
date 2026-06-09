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

    const [orgsR, subsR, invR] = await Promise.all([
      supabase.from('organizations').select('id, status, created_at'),
      supabase.from('organization_subscriptions').select('organization_id, status, plan:plan_id(price_monthly)'),
      supabase.from('invoices').select('amount, paid_at, status'),
    ])

    const orgs = (orgsR as any).data || []
    const subs = (subsR as any).data || []
    const invoices = (invR as any).data || []

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

    // Новые организации по месяцам (6 мес)
    const months = lastMonths(6)
    const newOrgsByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]))
    for (const o of orgs) {
      const key = o.created_at ? String(o.created_at).slice(0, 7) : null
      if (key && key in newOrgsByMonth) newOrgsByMonth[key]++
    }

    // Выручка (оплаченные счета) по месяцам
    const revenueByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]))
    for (const inv of invoices) {
      if (inv.status !== 'paid' || !inv.paid_at) continue
      const key = String(inv.paid_at).slice(0, 7)
      if (key in revenueByMonth) revenueByMonth[key] += Number(inv.amount) || 0
    }

    return json({
      data: {
        totals: {
          organizations: orgs.length,
          activeSubscriptions: activeSubs,
          mrr,
          paidInvoicesTotal: invoices.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0),
        },
        statusBreakdown,
        months,
        newOrgsByMonth,
        revenueByMonth,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/platform/analytics GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
