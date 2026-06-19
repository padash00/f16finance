/**
 * Отметка поста как прочитанного.
 * POST { postId } — записать в news_views
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const body = (await request.json().catch(() => null)) as { postId?: string } | null
  if (!body?.postId) return json({ error: 'postId обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  // Изоляция: отмечать прочитанным можно только пост своей орг (или глобальный).
  const { data: post } = await supabase.from('news_posts').select('organization_id').eq('id', body.postId).maybeSingle()
  if (!post) return json({ error: 'not-found' }, 404)
  if (!access.isSuperAdmin && (post as any).organization_id && (post as any).organization_id !== (access.activeOrganization?.id || null)) {
    return json({ error: 'not-found' }, 404)
  }
  await supabase.from('news_views').upsert(
    { post_id: body.postId, user_id: access.user.id, viewed_at: new Date().toISOString() },
    { onConflict: 'post_id,user_id' },
  )
  return json({ ok: true })
}
