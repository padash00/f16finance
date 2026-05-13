import { createHash, randomBytes } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { NextRequest, NextResponse } from 'next/server'

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Проверяет clientSecret + deviceToken, возвращает station row или ошибку */
export async function resolveStation(req: NextRequest) {
  const admin = createAdminSupabaseClient()

  const secret = req.headers.get('x-kiosk-secret')?.trim() || ''
  const deviceToken = req.headers.get('x-kiosk-device-token')?.trim() || ''

  if (!secret) return { error: 'missing-secret', status: 401 } as const
  if (!deviceToken) return { error: 'missing-device-token', status: 401 } as const

  const { data: station, error } = await admin
    .from('arena_stations')
    .select('id, name, station_code, point_project_id, company_id, client_secret_hash, device_token_hash, kiosk_bg_type, kiosk_bg_value, kiosk_accent, kiosk_logo_url, kiosk_announcement')
    .eq('client_secret_hash', sha256(secret))
    .limit(1)
    .maybeSingle()

  if (error) return { error: 'db-error', status: 500 } as const
  if (!station) return { error: 'unauthorized', status: 401 } as const

  if (!station.device_token_hash) {
    return { error: 'device-not-bound', status: 409 } as const
  }

  if (sha256(deviceToken) !== station.device_token_hash) {
    return { error: 'device-token-mismatch', status: 401 } as const
  }

  return { station }
}

/** Проверяет clientToken в заголовке, возвращает customer или ошибку */
export async function resolveClient(req: NextRequest, stationId: string) {
  const admin = createAdminSupabaseClient()
  const clientToken = req.headers.get('x-kiosk-client-token')?.trim() || ''

  if (!clientToken) return { error: 'missing-client-token', status: 401 } as const

  const { data: tokenRow, error } = await admin
    .from('kiosk_client_tokens')
    .select('id, customer_id, expires_at')
    .eq('token_hash', sha256(clientToken))
    .eq('station_id', stationId)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  if (error) return { error: 'db-error', status: 500 } as const
  if (!tokenRow) return { error: 'client-token-invalid-or-expired', status: 401 } as const

  const { data: customer, error: custErr } = await admin
    .from('customers')
    .select('id, name, phone, kiosk_balance, auth_user_id')
    .eq('id', tokenRow.customer_id)
    .eq('is_active', true)
    .maybeSingle()

  if (custErr || !customer) return { error: 'customer-not-found', status: 404 } as const

  return { customer, tokenId: tokenRow.id }
}

export function generateToken() {
  return randomBytes(32).toString('hex')
}
