import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { buildTenantHost } from '@/lib/core/tenant-domain'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Кабинет биллинга клиента: его пакет, модули, счета, статус подписки.
// Только своя организация (из access.activeOrganization). Read-only — оплата вручную через владельца платформы.

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffMember) return json({ error: 'forbidden' }, 403)

    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ data: null })

    if (!hasAdminSupabaseCredentials()) return json({ data: null })
    const supabase = createAdminSupabaseClient()

    const [orgR, subR, opR, oaR, pkgR, adR, invR] = await Promise.all([
      supabase.from('organizations').select('id, name, slug, status').eq('id', orgId).maybeSingle(),
      supabase.from('organization_subscriptions').select('status, billing_period, starts_at, ends_at, plan:plan_id(code, name, price_monthly)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('organization_packages').select('package_code').eq('organization_id', orgId).maybeSingle(),
      supabase.from('organization_addons').select('addon_code').eq('organization_id', orgId).eq('enabled', true),
      supabase.from('packages').select('code, name, price_kzt').eq('status', 'active'),
      supabase.from('addons').select('code, name, price_kzt, billing_unit').eq('status', 'active'),
      supabase.from('invoices').select('id, amount, currency, period_start, period_end, due_date, status, paid_at, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(24),
    ])

    const org = (orgR as any).data || null
    const sub = (subR as any).data || null
    const packagesById = new Map<string, any>(((pkgR as any).data || []).map((p: any) => [p.code, p]))
    const addonsById = new Map<string, any>(((adR as any).data || []).map((a: any) => [a.code, a]))
    const packageCode = (opR as any).data?.package_code || null
    const addonCodes = ((oaR as any).data || []).map((r: any) => String(r.addon_code))

    const pkg = packageCode ? packagesById.get(packageCode) || null : null
    const addons = addonCodes.map((c: string) => addonsById.get(c)).filter(Boolean)
    const monthlyTotal = (pkg?.price_kzt || 0) + addons.reduce((s: number, a: any) => s + (a.price_kzt || 0), 0)

    const planJoin = sub?.plan
    const plan = Array.isArray(planJoin) ? planJoin[0] : planJoin

    return json({
      data: {
        organization: org ? { name: org.name, slug: org.slug, status: org.status, primaryDomain: buildTenantHost(org.slug) } : null,
        subscription: sub
          ? {
              status: sub.status,
              billingPeriod: sub.billing_period,
              startsAt: sub.starts_at ?? null,
              endsAt: sub.ends_at ?? null,
              plan: plan ? { code: plan.code, name: plan.name, priceMonthly: plan.price_monthly } : null,
            }
          : null,
        package: pkg ? { code: pkg.code, name: pkg.name, priceKzt: pkg.price_kzt } : null,
        addons: addons.map((a: any) => ({ code: a.code, name: a.name, priceKzt: a.price_kzt, billingUnit: a.billing_unit })),
        monthlyTotal,
        invoices: (invR as any).data || [],
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/my-subscription GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
