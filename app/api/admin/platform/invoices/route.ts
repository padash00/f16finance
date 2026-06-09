import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Платформа: все счета по всем организациям (только суперадмин). Ядро ручного биллинга.

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)
    if (!hasAdminSupabaseCredentials()) return json({ data: [] })

    const supabase = createAdminSupabaseClient()
    const url = new URL(req.url)
    const status = url.searchParams.get('status')

    let q = supabase
      .from('invoices')
      .select('id, organization_id, amount, currency, period_start, period_end, due_date, status, method, note, paid_at, created_at, organization:organization_id(name, slug)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (status) q = q.eq('status', status)

    const { data, error } = await q
    if (error) {
      if (error.code === '42P01') return json({ data: [] })
      throw error
    }

    const today = new Date().toISOString().slice(0, 10)
    const rows = (data || []).map((r: any) => {
      const org = Array.isArray(r.organization) ? r.organization[0] : r.organization
      const overdue = r.status === 'issued' && r.due_date && String(r.due_date) < today
      return {
        id: r.id,
        organizationId: r.organization_id,
        orgName: org?.name || '—',
        orgSlug: org?.slug || '',
        amount: Number(r.amount) || 0,
        currency: r.currency || 'KZT',
        periodStart: r.period_start,
        periodEnd: r.period_end,
        dueDate: r.due_date,
        status: overdue ? 'overdue' : r.status,
        paidAt: r.paid_at,
        note: r.note,
        createdAt: r.created_at,
      }
    })
    return json({ data: rows })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/platform/invoices GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()
    const body = await req.json().catch(() => ({}))
    const invoiceId = String(body?.invoiceId || '')
    const action = String(body?.action || '')
    if (!invoiceId) return json({ error: 'invoiceId обязателен' }, 400)

    const nowIso = new Date().toISOString()
    if (action === 'markPaid') {
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: nowIso, method: body?.method || 'manual', updated_at: nowIso })
        .eq('id', invoiceId)
      if (error) throw error
    } else if (action === 'void') {
      const { error } = await supabase.from('invoices').update({ status: 'void', updated_at: nowIso }).eq('id', invoiceId)
      if (error) throw error
    } else {
      return json({ error: 'неизвестное действие' }, 400)
    }
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
