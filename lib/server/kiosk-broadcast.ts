/**
 * Broadcast to a Supabase Realtime channel.
 * Uses the Realtime REST API — no persistent WS connection needed server-side.
 */
async function broadcast(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
  if (!supabaseUrl || !serviceKey) {
    console.warn('[kiosk-broadcast] SKIP: missing supabaseUrl or serviceKey')
    return
  }
  try {
    const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ messages: [{ topic: channel, event, payload }] }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[kiosk-broadcast] HTTP ${res.status} for channel=${channel}:`, text)
    } else {
      console.log(`[kiosk-broadcast] OK channel=${channel} event=${event} payload=`, JSON.stringify(payload))
    }
  } catch (err: any) {
    console.error('[kiosk-broadcast] fetch error:', err?.message)
  }
}

/** Broadcast a command to a station kiosk via channel `kiosk:{stationId}` */
export function broadcastKioskCommand(stationId: string, payload: Record<string, unknown>): Promise<void> {
  return broadcast(`kiosk:${stationId}`, 'command', payload)
}

/** Broadcast QR auth result to a waiting kiosk via channel `kiosk-qr:{code}` */
export function broadcastQrAuth(code: string, payload: Record<string, unknown>): Promise<void> {
  return broadcast(`kiosk-qr:${code}`, 'qr_auth', payload)
}
