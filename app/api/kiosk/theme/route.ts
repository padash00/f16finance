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

  return NextResponse.json({
    bgType: station.kiosk_bg_type || 'color',
    bgValue: station.kiosk_bg_value || 'linear-gradient(135deg, #07080a 0%, #0f1520 100%)',
    accentColor: station.kiosk_accent || '#2563eb',
    logoUrl: station.kiosk_logo_url ?? null,
    clubName: station.name || station.station_code || 'ORDA CLUB',
    announcement: station.kiosk_announcement ?? null,
  })
}
