import 'server-only'

import { NextResponse } from 'next/server'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export type PointDeviceContext = {
  device: {
    id: string
    company_id: string
    name: string
    device_token: string
    point_mode: string
    feature_flags: Record<string, unknown> | null
    is_active: boolean
    notes: string | null
    company?: {
      id: string
      name: string
      code: string | null
    } | null
  }
  supabase: ReturnType<typeof createAdminSupabaseClient>
}

export async function requirePointDevice(request: Request): Promise<
  | { response: NextResponse }
  | PointDeviceContext
> {
  if (!hasAdminSupabaseCredentials()) {
    return {
      response: NextResponse.json({ error: 'point-api-disabled' }, { status: 503 }),
    }
  }

  const token = request.headers.get('x-point-device-token')?.trim()
  if (!token) {
    return {
      response: NextResponse.json({ error: 'missing-point-device-token' }, { status: 401 }),
    }
  }

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('point_devices')
    .select('id, company_id, name, device_token, point_mode, feature_flags, is_active, notes, company:company_id(id, name, code)')
    .eq('device_token', token)
    .maybeSingle()

  if (error || !data || !data.is_active) {
    return {
      response: NextResponse.json({ error: 'invalid-point-device' }, { status: 403 }),
    }
  }

  await supabase.from('point_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)

  return {
    supabase,
    device: {
      ...data,
      feature_flags:
        data.feature_flags && typeof data.feature_flags === 'object'
          ? (data.feature_flags as Record<string, unknown>)
          : {},
      company: Array.isArray(data.company) ? data.company[0] || null : data.company || null,
    },
  }
}
