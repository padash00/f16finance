import { randomBytes } from 'crypto'

import { NextResponse } from 'next/server'

import { getPublicAppUrl } from '@/lib/core/app-url'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

const CHALLENGE_TTL_MS = 3 * 60_000

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = checkRateLimit(`point-qr-login-start:${ip}`, 15, 60_000)
    if (!rl.allowed) {
      return json({ error: 'too-many-requests' }, 429)
    }

    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const nonce = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()

    const { error: insertError } = await supabase.from('point_qr_login_challenges').insert({
      point_project_id: device.id,
      nonce,
      status: 'pending',
      expires_at: expiresAt,
    })

    if (insertError) throw insertError

    const base = getPublicAppUrl(request.url)
    const confirmUrl = `${base.replace(/\/$/, '')}/operator/point-qr-confirm?n=${encodeURIComponent(nonce)}`

    return json({
      ok: true,
      nonce,
      expires_at: expiresAt,
      confirm_url: confirmUrl,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'point-qr-login-start'
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-qr-login-start',
      message,
    })
    return json({ error: 'Не удалось создать QR-вход' }, 500)
  }
}
