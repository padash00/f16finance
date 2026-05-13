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
    .from('arena_tariffs')
    .select('id, name, duration_minutes, price, description, tariff_type')
    .eq('point_project_id', station.point_project_id)
    .eq('is_active', true)
    .order('price')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    (data ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      durationMin: t.duration_minutes,
      price: Number(t.price),
      description: t.description ?? null,
    })),
  )
}
