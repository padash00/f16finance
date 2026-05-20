import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id') || null

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('customer_display_ads')
      .select('id, company_id, media_type, url, title, duration_sec, sort_order, is_active, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (companyId) query = query.eq('company_id', companyId)
    if (companyScope.allowedCompanyIds) query = query.in('company_id', companyScope.allowedCompanyIds)

    const { data, error } = await query
    if (error) throw error
    return json({ ok: true, data: data || [] })
  } catch (error: any) {
    return json({ error: 'advertising-list-failed', detail: error?.message || String(error) }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const body = (await request.json().catch(() => ({}))) as {
      company_id?: string
      media_type?: 'image' | 'video'
      url?: string
      title?: string | null
      duration_sec?: number | null
    }

    if (!body.company_id) return json({ error: 'company_id-required' }, 400)
    if (body.media_type !== 'image' && body.media_type !== 'video')
      return json({ error: 'media_type-invalid' }, 400)
    if (!body.url || !body.url.trim()) return json({ error: 'url-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes(body.company_id)) {
      return json({ error: 'forbidden' }, 403)
    }

    // следующий sort_order = max+1 в рамках компании
    const { data: lastRow } = await supabase
      .from('customer_display_ads')
      .select('sort_order')
      .eq('company_id', body.company_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = (Number((lastRow as any)?.sort_order) || 0) + 1

    const { data, error } = await supabase
      .from('customer_display_ads')
      .insert([
        {
          company_id: body.company_id,
          media_type: body.media_type,
          url: body.url.trim(),
          title: body.title?.trim() || null,
          duration_sec:
            body.media_type === 'image'
              ? Number(body.duration_sec) > 0
                ? Math.round(Number(body.duration_sec))
                : 8
              : null,
          sort_order: nextOrder,
          is_active: true,
          created_by: access.user?.id || null,
        },
      ])
      .select('id, company_id, media_type, url, title, duration_sec, sort_order, is_active, created_at, updated_at')
      .single()
    if (error) throw error
    return json({ ok: true, data })
  } catch (error: any) {
    return json({ error: 'advertising-create-failed', detail: error?.message || String(error) }, 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const body = (await request.json().catch(() => ({}))) as {
      id?: string
      is_active?: boolean
      title?: string | null
      duration_sec?: number | null
      // реордер: массив id в нужном порядке
      reorder?: string[]
      company_id?: string
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Реордер: проставляем sort_order по позиции в массиве
    if (Array.isArray(body.reorder) && body.reorder.length > 0) {
      let i = 1
      for (const id of body.reorder) {
        let q = supabase.from('customer_display_ads').update({ sort_order: i, updated_at: new Date().toISOString() }).eq('id', id)
        if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
        const { error } = await q
        if (error) throw error
        i++
      }
      return json({ ok: true })
    }

    if (!body.id) return json({ error: 'id-required' }, 400)
    const patch: Record<string, any> = { updated_at: new Date().toISOString() }
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
    if (body.title !== undefined) patch.title = body.title?.trim() || null
    if (body.duration_sec !== undefined)
      patch.duration_sec = Number(body.duration_sec) > 0 ? Math.round(Number(body.duration_sec)) : null

    let q = supabase
      .from('customer_display_ads')
      .update(patch)
      .eq('id', body.id)
    if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
    const { data, error } = await q
      .select('id, company_id, media_type, url, title, duration_sec, sort_order, is_active, created_at, updated_at')
      .single()
    if (error) throw error
    return json({ ok: true, data })
  } catch (error: any) {
    return json({ error: 'advertising-update-failed', detail: error?.message || String(error) }, 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Достаём запись, чтобы удалить файл из storage
    const { data: row } = await supabase
      .from('customer_display_ads')
      .select('id, company_id, url')
      .eq('id', id)
      .maybeSingle()

    if (row && companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes((row as any).company_id)) {
      return json({ error: 'forbidden' }, 403)
    }

    let q = supabase.from('customer_display_ads').delete().eq('id', id)
    if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
    const { error } = await q
    if (error) throw error

    // Лучшее усилие: удалить файл из bucket (если url наш)
    try {
      const fileUrl = (row as any)?.url as string | undefined
      if (fileUrl && fileUrl.includes('/customer-display-ads/')) {
        const fileName = fileUrl.split('/customer-display-ads/')[1]?.split('?')[0]
        if (fileName) await supabase.storage.from('customer-display-ads').remove([decodeURIComponent(fileName)])
      }
    } catch {
      // не критично — запись уже удалена
    }

    return json({ ok: true })
  } catch (error: any) {
    return json({ error: 'advertising-delete-failed', detail: error?.message || String(error) }, 500)
  }
}
