import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveStation } from '../_lib/auth'

export async function GET(req: NextRequest) {
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'service-unavailable' }, { status: 503 })
  }

  const result = await resolveStation(req)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { station } = result
  const admin = createAdminSupabaseClient()

  const { data, error } = await admin
    .from('arena_station_games')
    .select(`
      id,
      exe_path,
      sort_order,
      game:arena_games_catalog(id, title, logo_url, category)
    `)
    .eq('station_id', station.id)
    .eq('is_active', true)
    .order('sort_order')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const items = (data ?? []).map((row: any) => ({
    id: row.game?.id ?? row.id,
    title: row.game?.title ?? '',
    logoUrl: row.game?.logo_url ?? null,
    category: row.game?.category ?? 'game',
    exePath: row.exe_path,
  }))

  return NextResponse.json(items)
}
