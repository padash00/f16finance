/**
 * Cron: каждый час обнуляет pinned_until у сообщений, у которых срок прошёл.
 * Закрепления исчезают автоматом — оператор получает чистый чат.
 */

import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const url = new URL(request.url)
  const headerSecret = request.headers.get('x-cron-secret')
  const isVercelCron = request.headers.get('user-agent')?.includes('vercel-cron')
  if (cronSecret && headerSecret !== cronSecret && !isVercelCron && url.searchParams.get('secret') !== cronSecret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'admin supabase not configured' }, { status: 500 })
  }

  const supabase = createAdminSupabaseClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('team_chat_messages')
    .update({ pinned_until: null })
    .lt('pinned_until', nowIso)
    .not('pinned_until', 'is', null)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, expired: (data || []).length })
}
