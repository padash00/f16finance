/**
 * Новостная лента / Stories владельца.
 * GET — последние посты + флаг "viewed by me"
 * POST — создать пост (только owner / super-admin)
 * DELETE { id } — мягкое удаление (только автор / owner / super-admin)
 */

import { NextResponse } from 'next/server'
import { hasCapability, requireCapability } from '@/lib/server/capabilities'
import { pushToOrganization } from '@/lib/server/push'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/// Право, а не роль: в каталоге для новостей заведены `news.create` и
/// `news.delete`, и владелец вправе доверить ленту кому-то ещё, не делая его
/// владельцем.
async function canPublish(access: any): Promise<boolean> {
  return hasCapability(access, 'news.create')
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

  return json({ posts, unreadCount, canPublish: await canPublish(access) })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  const denied = await requireCapability(access, 'news.create')
  if (denied) return denied
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

  // Новость без уведомления прочитают те, кто и так зашёл в ленту, — то есть
  // не те, ради кого её писали. Отправка best-effort: пост уже создан, и
  // упавший push не повод отвечать ошибкой.
  await pushToOrganization(supabase as any, access.activeOrganization?.id || null, {
    title: data?.title?.trim() || 'Новость',
    body: preview(text),
    data: { kind: 'news', postId: String(data?.id || '') },
    collapseId: `news-${String(data?.id || '')}`,
  })

  return json({ post: data })
}

/// Короткая выжимка для шторки: целиком пост туда не влезет, а обрезанный
/// на полуслове выглядит сломанным.
function preview(text: string, limit = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= limit) return clean
  const cut = clean.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export async function DELETE(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as { id?: string } | null
  if (!body?.id) return json({ error: 'id обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const { data: post } = await supabase
    .from('news_posts')
    .select('author_user_id, organization_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!post) return json({ error: 'Не найден' }, 404)

  // Изоляция: пост обязан принадлежать орг вызывающего (или быть глобальным),
  // иначе owner орг A мог бы удалить пост орг B по присланному id.
  const orgId = access.activeOrganization?.id || null
  const postOrg = (post as any).organization_id
  if (!access.isSuperAdmin && postOrg && postOrg !== orgId) {
    return json({ error: 'Не найден' }, 404)
  }

  const isAuthor = (post as any).author_user_id === access.user?.id
  if (!isAuthor && !(await hasCapability(access, 'news.delete'))) {
    return json({ error: 'Можно удалять только свои' }, 403)
  }

  let delQ: any = supabase
    .from('news_posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', body.id)
  if (!access.isSuperAdmin && orgId) delQ = delQ.eq('organization_id', orgId)
  const { error } = await delQ
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
