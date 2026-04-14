/**
 * Broadcast to a Supabase Realtime channel.
 * Uses the Realtime REST API — no persistent WS connection needed server-side.
 */
async function broadcast(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
  if (!supabaseUrl || !serviceKey) return
  try {
    await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ messages: [{ topic: channel, event, payload }] }),
    })
  } catch (_) {
    // best-effort
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
