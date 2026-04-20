import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { fetchStoreOverview, fetchStoreWriteoffs } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
    if (!q) return json({ ok: true, data: { query: '', results: [] } })

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const scope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }

    const [overview, writeoffs] = await Promise.all([
      fetchStoreOverview(supabase as any, scope),
      fetchStoreWriteoffs(supabase as any, scope),
    ])

    const results: Array<{ type: string; title: string; subtitle: string; href: string; score: number }> = []

    for (const item of overview.items || []) {
      const name = String((item as any).name || '')
      const barcode = String((item as any).barcode || '')
      const hit = `${name} ${barcode}`.toLowerCase()
      if (!hit.includes(q)) continue
      const score = barcode === q ? 100 : barcode.startsWith(q) ? 90 : name.toLowerCase().startsWith(q) ? 80 : 70
      results.push({
        type: 'item',
        title: name || 'Товар',
        subtitle: barcode || 'Без штрихкода',
        href: `/store/warehouse?q=${encodeURIComponent(barcode || name)}`,
        score,
      })
    }

    for (const req of overview.requests || []) {
      const requestId = String((req as any).id || '')
      const companyName = String((req as any).company?.name || '')
      const status = String((req as any).status || '')
      const hit = `${requestId} ${companyName} ${status}`.toLowerCase()
      if (!hit.includes(q)) continue
      results.push({
        type: 'request',
        title: `Заявка ${requestId.slice(0, 8)}`,
        subtitle: `${companyName || 'Точка'} · ${status}`,
        href: `/store/requests?q=${encodeURIComponent(requestId)}`,
        score: requestId.includes(q) ? 95 : 65,
      })
    }

    for (const receipt of overview.receipts || []) {
      const id = String((receipt as any).id || '')
      const invoice = String((receipt as any).invoice_number || '')
      const supplier = String((receipt as any).supplier?.name || '')
      const hit = `${id} ${invoice} ${supplier}`.toLowerCase()
      if (!hit.includes(q)) continue
      results.push({
        type: 'receipt',
        title: `Приемка ${invoice || id.slice(0, 8)}`,
        subtitle: supplier || 'Без поставщика',
        href: `/store/receipts?q=${encodeURIComponent(invoice || id)}`,
        score: invoice.toLowerCase() === q ? 92 : 62,
      })
    }

    for (const writeoff of writeoffs.writeoffs || []) {
      const id = String((writeoff as any).id || '')
      const reason = String((writeoff as any).reason || '')
      const location = String((writeoff as any).location?.name || (writeoff as any).location?.company?.name || '')
      const hit = `${id} ${reason} ${location}`.toLowerCase()
      if (!hit.includes(q)) continue
      results.push({
        type: 'writeoff',
        title: `Списание ${id.slice(0, 8)}`,
        subtitle: `${reason || 'Причина не указана'} · ${location || 'Локация'}`,
        href: `/store/writeoffs?q=${encodeURIComponent(reason || id)}`,
        score: id.includes(q) ? 90 : 60,
      })
    }

    const top = results.sort((a, b) => b.score - a.score).slice(0, 30)
    return json({ ok: true, data: { query: q, results: top } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/global-search.GET',
      message: error?.message || 'Store global search GET error',
    })
    return json({ error: error?.message || 'Не удалось выполнить поиск по магазину' }, 500)
  }
}

