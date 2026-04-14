const WebSocket = require('ws')

function createSocketClient({ url, onCommand, onOpen, onClose, onError }) {
  let ws = null
  let reconnectTimer = null
  let stopped = false

  function connect() {
    if (stopped) return
    ws = new WebSocket(url)

    ws.on('open', () => {
      if (onOpen) onOpen()
    })

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(String(raw || '{}'))
        if (onCommand) onCommand(parsed)
      } catch (error) {
        if (onError) onError(error)
      }
    })

    ws.on('close', () => {
      if (onClose) onClose()
      if (!stopped) {
        reconnectTimer = setTimeout(connect, 3000)
      }
    })

    ws.on('error', (error) => {
      if (onError) onError(error)
    })
  }

  function send(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(data))
    return true
  }

  function close() {
    stopped = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) ws.close()
  }

  connect()
  return { send, close }
}

module.exports = { createSocketClient }
