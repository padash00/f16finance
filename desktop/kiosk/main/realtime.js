let supabaseClient = null
let currentChannel = null

async function setupRealtime({ supabaseUrl, supabaseAnonKey, stationId, onCommand, logLine }) {
  if (!supabaseUrl || !supabaseAnonKey || !stationId) return

  try {
    // Lazy-require to avoid issues if package not installed
    const { createClient } = require('@supabase/supabase-js')

    if (supabaseClient) {
      try { await supabaseClient.removeAllChannels() } catch (_) {}
    }

    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    })

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
      })
  } catch (error) {
    if (logLine) logLine(`Realtime setup failed: ${error.message}`)
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
