/**
 * Operator подтверждает что увидел push-уведомление.
 * POST /api/point/sync-check/ack { messageId }
 */
import { NextResponse } from 'next/server'
import { requirePointDevice } from '@/lib/server/point-devices'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response

  const body = await request.json().catch(() => null) as { messageId?: string } | null
  if (!body?.messageId) {
    return NextResponse.json({ error: 'messageId required' }, { status: 400 })
  }

  const { supabase, device } = point
  await supabase
    .from('point_device_messages')
    .update({ delivered_at: new Date().toISOString() })
    .eq('id', body.messageId)
    .eq('device_id', device.id)

  return NextResponse.json({ ok: true })
}
