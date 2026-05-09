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
  await supabase.from('news_views').upsert(
    { post_id: body.postId, user_id: access.user.id, viewed_at: new Date().toISOString() },
    { onConflict: 'post_id,user_id' },
  )
  return json({ ok: true })
}
