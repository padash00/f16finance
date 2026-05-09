/**
 * Новостная лента / Stories владельца.
 * GET — последние посты + флаг "viewed by me"
 * POST — создать пост (только owner / super-admin)
 * DELETE { id } — мягкое удаление (только автор / owner / super-admin)
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canPublish(access: any): boolean {
  if (access.isSuperAdmin) return true
  return (access.staffMember?.role || '').toLowerCase() === 'owner'
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in access) return access.response

  const url = new URL(request.url)
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 30))

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const orgId = access.activeOrganization?.id || null

  let query = supabase
    .from('news_posts')
    .select('id, author_name, title, body, image_url, link_url, link_label, pinned_until, expires_at, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (orgId) query = query.or(`organization_id.eq.${orgId},organization_id.is.null`)
  // Не показываем истёкшие
  const nowIso = new Date().toISOString()
  query = query.or(`expires_at.is.null,expires_at.gt.${nowIso}`)

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)

  // Mark which ones I've viewed
  let viewedIds = new Set<string>()
  if (access.user?.id && data && data.length > 0) {
    const ids = data.map((p: any) => p.id)
    const { data: views } = await supabase
      .from('news_views')
      .select('post_id')
      .in('post_id', ids)
      .eq('user_id', access.user.id)
    viewedIds = new Set((views || []).map((v: any) => v.post_id))
  }

  const posts = (data || []).map((p: any) => ({ ...p, viewed: viewedIds.has(p.id) }))
  const unreadCount = posts.filter((p: any) => !p.viewed).length

  return json({ posts, unreadCount, canPublish: canPublish(access) })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!canPublish(access)) return json({ error: 'Только владелец может публиковать' }, 403)
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const body = (await request.json().catch(() => null)) as {
    title?: string
    body?: string
    imageUrl?: string
    linkUrl?: string
    linkLabel?: string
    pinnedUntil?: string
    expiresAt?: string
  } | null

  const text = String(body?.body || '').trim()
  if (!text && !body?.imageUrl) return json({ error: 'Пост пустой — нужен текст или фото' }, 400)
  if (text.length > 2000) return json({ error: 'Слишком длинный (макс 2000)' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const authorName = access.staffMember?.full_name || access.user.email || 'Владелец'

  const { data, error } = await supabase
    .from('news_posts')
    .insert({
      organization_id: access.activeOrganization?.id || null,
      author_user_id: access.user.id,
      author_name: authorName,
      title: body?.title?.trim() || null,
      body: text,
      image_url: body?.imageUrl || null,
      link_url: body?.linkUrl || null,
      link_label: body?.linkLabel || null,
      pinned_until: body?.pinnedUntil || null,
      expires_at: body?.expiresAt || null,
    })
    .select('*')
    .single()

  if (error) return json({ error: error.message }, 500)
  return json({ post: data })
}

export async function DELETE(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as { id?: string } | null
  if (!body?.id) return json({ error: 'id обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const { data: post } = await supabase
    .from('news_posts')
    .select('author_user_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!post) return json({ error: 'Не найден' }, 404)

  const isAuthor = (post as any).author_user_id === access.user?.id
  if (!isAuthor && !canPublish(access)) {
    return json({ error: 'Можно удалять только свои' }, 403)
  }

  const { error } = await supabase
    .from('news_posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', body.id)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
