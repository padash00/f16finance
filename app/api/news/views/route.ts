/**
 * Аналитика просмотров поста (для автора / owner / super-admin).
 * GET ?postId=X — кто прочитал и когда.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const url = new URL(request.url)
  const postId = url.searchParams.get('postId')
  if (!postId) return json({ error: 'postId обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const { data: post } = await supabase
    .from('news_posts')
    .select('author_user_id')
    .eq('id', postId)
    .maybeSingle()
  if (!post) return json({ error: 'Не найден' }, 404)

  const isAuthor = (post as any).author_user_id === access.user?.id
  const isOwner = access.isSuperAdmin || (access.staffMember?.role || '').toLowerCase() === 'owner'
  if (!isAuthor && !isOwner) return json({ error: 'Только автор или владелец видят аналитику' }, 403)

  // Берём всех просмотров + резолвим имена через staff и operators
  const { data: views } = await supabase
    .from('news_views')
    .select('user_id, viewed_at')
    .eq('post_id', postId)
    .order('viewed_at', { ascending: false })

  if (!views || views.length === 0) {
    return json({ post: postId, views: [], total: 0 })
  }

  const userIds = views.map((v: any) => v.user_id)
  const [staffRes, opAuthRes] = await Promise.all([
    supabase.from('staff').select('user_id, full_name, role').in('user_id', userIds),
    supabase.from('operator_auth').select('user_id, operator_id').in('user_id', userIds),
  ])

  const nameByUserId = new Map<string, { name: string; role: string }>()
  for (const s of staffRes.data || []) {
    nameByUserId.set((s as any).user_id, { name: (s as any).full_name || 'Сотрудник', role: (s as any).role || 'staff' })
  }
  if ((opAuthRes.data || []).length > 0) {
    const opIds = (opAuthRes.data || []).map((a: any) => a.operator_id)
    const { data: ops } = await supabase
      .from('operators')
      .select('id, short_name, name')
      .in('id', opIds)
    const opById = new Map<string, any>((ops || []).map((o: any) => [o.id, o]))
    for (const a of opAuthRes.data || []) {
      const op = opById.get((a as any).operator_id)
      nameByUserId.set((a as any).user_id, {
        name: op?.short_name || op?.name || 'Оператор',
        role: 'operator',
      })
    }
  }

  const enriched = views.map((v: any) => ({
    user_id: v.user_id,
    viewed_at: v.viewed_at,
    name: nameByUserId.get(v.user_id)?.name || 'Пользователь',
    role: nameByUserId.get(v.user_id)?.role || 'staff',
  }))

  return json({ post: postId, views: enriched, total: enriched.length })
}
