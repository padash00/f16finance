/**
 * Broadcast a command to a kiosk station via Supabase Realtime.
 * Uses the Realtime REST API so no persistent WS connection is needed server-side.
 */
export async function broadcastKioskCommand(
  stationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''

  if (!supabaseUrl || !serviceKey) return

  try {
    await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `kiosk:${stationId}`,
            event: 'command',
            payload,
          },
        ],
      }),
    })
  } catch (_) {
    // broadcast is best-effort — don't break the API call if it fails
  }
}
