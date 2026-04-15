let supabaseClient = null
let currentChannel = null

/**
 * Returns true if subscription reached SUBSCRIBED, false otherwise.
 * Caller should set realtimeReady = false and retry on next heartbeat if false.
 */
async function setupRealtime({ supabaseUrl, supabaseAnonKey, stationId, onCommand, onStatusChange, logLine }) {
  if (!supabaseUrl || !supabaseAnonKey || !stationId) return false

  try {
    // Lazy-require to avoid issues if package not installed
    const { createClient } = require('@supabase/supabase-js')

    if (supabaseClient) {
      try { await supabaseClient.removeAllChannels() } catch (_) {}
    }

    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    })

    return await new Promise((resolve) => {
      let settled = false
      // Timeout — if no SUBSCRIBED within 10s, treat as failure
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          if (logLine) logLine(`Realtime subscribe timeout for kiosk:${stationId}`)
          resolve(false)
        }
      }, 10000)

      currentChannel = supabaseClient
        .channel(`kiosk:${stationId}`)
        .on('broadcast', { event: 'command' }, ({ payload }) => {
          if (payload && onCommand) {
            if (logLine) logLine(`Realtime command: ${payload.type}`)
            onCommand(payload)
          }
        })
        .subscribe((status) => {
          if (logLine) logLine(`Realtime status: ${status}`)
          if (onStatusChange) onStatusChange(status)
          if (status === 'SUBSCRIBED') {
            if (!settled) { settled = true; clearTimeout(timeout); resolve(true) }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (!settled) { settled = true; clearTimeout(timeout); resolve(false) }
          }
        })
    })
  } catch (error) {
    if (logLine) logLine(`Realtime setup failed: ${error.message}`)
    return false
  }
}

async function closeRealtime() {
  try {
    if (supabaseClient) await supabaseClient.removeAllChannels()
  } catch (_) {}
  supabaseClient = null
  currentChannel = null
}

module.exports = { setupRealtime, closeRealtime }
