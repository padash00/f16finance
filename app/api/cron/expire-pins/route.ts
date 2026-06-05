/**
 * Cron: каждый час обнуляет pinned_until у сообщений, у которых срок прошёл.
 * Закрепления исчезают автоматом — оператор получает чистый чат.
 */

import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { verifyCronRequest } from '@/lib/server/cron-auth'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
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
