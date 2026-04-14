const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, globalShortcut, Menu } = require('electron')

const { loadConfig, saveConfig } = require('./config-store')
const { createSocketClient } = require('./websocket')
const { launchGame, stopGame, getGameState } = require('./launcher')
const { shutdownPc, rebootPc } = require('./system')
const { getDeviceNetworkIdentity } = require('./device')

const argvHasSetup = process.argv.includes('--setup')

function runtimeConfig() {
  const fileCfg = loadConfig() || {}
  return {
    stationCode: process.env.STATION_CODE || fileCfg.stationCode || 'VIP-111',
    clubName: process.env.CLUB_NAME || fileCfg.clubName || 'ORDA CLUB',
    defaultGamePath: process.env.DEFAULT_GAME_PATH || fileCfg.defaultGamePath || 'D:\\Games\\CS2\\cs2.exe',
    wsUrl: process.env.KIOSK_WS_URL || fileCfg.wsUrl || 'ws://127.0.0.1:8787/ws/client',
    heartbeatUrl: process.env.KIOSK_HEARTBEAT_URL || fileCfg.heartbeatUrl || 'http://127.0.0.1:3000/api/kiosk/heartbeat',
    heartbeatSecret: process.env.KIOSK_HEARTBEAT_SECRET || fileCfg.heartbeatSecret || '',
  }
}

let mainWindow = null
let setupWindow = null
let socket = null
let heartbeatTimer = null
let httpHeartbeatTimer = null
let tickTimer = null

const session = {
  active: false,
  endsAtMs: 0,
  tariffName: '',
  bindingBlocked: false,
  bindingReason: '',
  games: [],
}

function logLine(message) {
  try {
    const logDir = app.getPath('userData')
    const file = path.join(logDir, 'kiosk.log')
    const line = `[${new Date().toISOString()}] ${message}\n`
    fs.appendFileSync(file, line, 'utf8')
  } catch (_) {
    // ignore
  }
}

function getRemainingSec() {
  if (!session.active) return 0
  return Math.max(0, Math.floor((session.endsAtMs - Date.now()) / 1000))
}

function getScreenMode() {
  if (!session.active) return 'idle'
  return getRemainingSec() === 0 ? 'ended' : 'active'
}

function buildState() {
  const cfg = runtimeConfig()
  const remainingSec = getRemainingSec()
  const net = getDeviceNetworkIdentity()
  return {
    clubName: cfg.clubName,
    stationCode: cfg.stationCode,
    screen: session.bindingBlocked ? 'blocked' : getScreenMode(),
    active: session.active,
    tariffName: session.tariffName,
    remainingSec,
    bindingBlocked: session.bindingBlocked,
    bindingReason: session.bindingReason || '',
    games: session.games,
    deviceIp: net.ip,
    deviceMac: net.mac,
    game: getGameState(),
  }
}

function pushState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('kiosk:state', buildState())
}

function sendStatus(status) {
  if (!socket) return
  const cfg = runtimeConfig()
  const net = getDeviceNetworkIdentity()
  socket.send({
    type: 'status',
    status,
    stationCode: cfg.stationCode,
    device_ip: net.ip,
    device_mac: net.mac,
    interface: net.iface,
    games_count: Array.isArray(session.games) ? session.games.length : 0,
    timestamp: new Date().toISOString(),
  })
}

async function postHeartbeat(status) {
  const cfg = runtimeConfig()
  if (!cfg.heartbeatSecret) return
  const net = getDeviceNetworkIdentity()
  try {
    const res = await fetch(cfg.heartbeatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kiosk-secret': cfg.heartbeatSecret },
      body: JSON.stringify({
        stationCode: cfg.stationCode,
        device_ip: net.ip,
        device_mac: net.mac,
        status,
      }),
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      logLine(`heartbeat http ${res.status}: ${JSON.stringify(payload || {})}`)
    }
  } catch (error) {
    logLine(`heartbeat failed: ${error.message}`)
  }
}

function resolveGameById(gameId) {
  const id = String(gameId || '').trim()
  if (!id) return null
  return session.games.find((g) => String(g.id) === id) || null
}

function launchConfiguredGame(gameId, fallbackPath) {
  const cfg = runtimeConfig()
  const game = resolveGameById(gameId)
  const pathToRun = String(game?.exePath || fallbackPath || cfg.defaultGamePath || '').trim()
  if (!pathToRun) throw new Error('game-path-required')
  return launchGame(pathToRun)
}

function clearSessionAndLock() {
  stopGame()
  session.active = false
  session.endsAtMs = 0
  session.tariffName = ''
  pushState()
  sendStatus('idle')
  void postHeartbeat('offline')
}

function onTick() {
  const remaining = getRemainingSec()
  if (session.active && remaining <= 0) {
    clearSessionAndLock()
    return
  }
  pushState()
}

function applyStartSession(command) {
  if (session.bindingBlocked) return
  const durationSec = Number(command.durationSec || 0)
  if (durationSec <= 0) return

  session.active = true
  session.tariffName = String(command.tariffName || 'Тариф')
  if (Array.isArray(command.games)) {
    session.games = command.games
  }
  session.endsAtMs = Date.now() + durationSec * 1000
  pushState()
  sendStatus('idle')
  void postHeartbeat('idle')
}

function applyExtendSession(command) {
  const addSec = Number(command.addSec || 0)
  if (!session.active || addSec <= 0) return
  session.endsAtMs += addSec * 1000
  pushState()
}

function handleCommand(message) {
  if (!message || typeof message !== 'object') return
  const type = String(message.type || '')
  logLine(`WS command: ${type}`)

  switch (type) {
    case 'binding_ok':
      session.bindingBlocked = false
      session.bindingReason = ''
      logLine('binding_ok')
      pushState()
      break
    case 'station_profile':
      session.games = Array.isArray(message.games) ? message.games : []
      logLine(`station_profile loaded games=${session.games.length}`)
      pushState()
      break
    case 'binding_mismatch':
      clearSessionAndLock()
      session.bindingBlocked = true
      session.bindingReason = String(message.reason || 'Устройство не совпадает с привязкой станции.')
      logLine(`binding_mismatch: ${session.bindingReason}`)
      pushState()
      break
    case 'start_session':
      applyStartSession(message)
      break
    case 'extend_session':
      applyExtendSession(message)
      break
    case 'end_session':
      clearSessionAndLock()
      break
    case 'launch_game':
      if (!session.active) return
      try {
        launchConfiguredGame(message.gameId, String(message.gamePath || ''))
        sendStatus('in_game')
        void postHeartbeat('in_game')
        pushState()
      } catch (error) {
        logLine(`launch_game failed: ${error.message}`)
      }
      break
    case 'shutdown_pc':
      shutdownPc()
      break
    case 'reboot_pc':
      rebootPc()
      break
    default:
      break
  }
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 640,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  })
  Menu.setApplicationMenu(null)
  setupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'setup.html'))
}

function createKioskWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    kiosk: true,
    fullscreen: true,
    alwaysOnTop: true,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  })

  Menu.setApplicationMenu(null)

  mainWindow.on('close', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const altF4 = input.alt && input.key === 'F4'
    const altTab = input.alt && input.key === 'Tab'
    const ctrlW = input.control && input.key.toLowerCase() === 'w'
    if (altF4 || altTab || ctrlW) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools()
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  mainWindow.once('ready-to-show', () => {
    mainWindow.setKiosk(true)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.focus()
    pushState()
  })
}

function setupShortcuts() {
  globalShortcut.register('Alt+F4', () => {})
  globalShortcut.register('CommandOrControl+W', () => {})
  globalShortcut.register('Alt+Tab', () => {})
}

function setupIpc() {
  ipcMain.handle('setup:load', async () => {
    const cfg = loadConfig() || {}
    return {
      stationCode: cfg.stationCode || '',
      heartbeatUrl: cfg.heartbeatUrl || '',
      heartbeatSecret: cfg.heartbeatSecret || '',
      wsUrl: cfg.wsUrl || '',
      clubName: cfg.clubName || '',
      defaultGamePath: cfg.defaultGamePath || '',
    }
  })

  ipcMain.handle('setup:save', async (_event, payload) => {
    const stationCode = String(payload?.stationCode || '').trim()
    const heartbeatUrl = String(payload?.heartbeatUrl || '').trim()
    const heartbeatSecret = String(payload?.heartbeatSecret || '').trim()
    if (!stationCode) return { ok: false, error: 'stationCode-required' }
    if (!heartbeatUrl) return { ok: false, error: 'heartbeatUrl-required' }
    if (!heartbeatSecret) return { ok: false, error: 'heartbeatSecret-required' }

    saveConfig({
      stationCode,
      heartbeatUrl,
      heartbeatSecret,
      wsUrl: String(payload?.wsUrl || '').trim(),
      clubName: String(payload?.clubName || '').trim(),
      defaultGamePath: String(payload?.defaultGamePath || '').trim(),
    })
    app.relaunch()
    app.exit(0)
    return { ok: true }
  })

  ipcMain.handle('kiosk:launch-game', async (_event, gameId) => {
    if (session.bindingBlocked) return { ok: false, error: 'binding-blocked' }
    if (!session.active) return { ok: false, error: 'session-not-active' }
    try {
      const cfg = runtimeConfig()
      const result = launchConfiguredGame(gameId, cfg.defaultGamePath)
      sendStatus('in_game')
      void postHeartbeat('in_game')
      pushState()
      return result
    } catch (error) {
      logLine(`manual launch failed: ${error.message}`)
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle('kiosk:extend', async () => {
    sendStatus('extend_requested')
    void postHeartbeat('extend_requested')
    return { ok: true }
  })

  ipcMain.handle('kiosk:call-operator', async () => {
    sendStatus('operator_called')
    void postHeartbeat('operator_called')
    return { ok: true }
  })
}

function setupWebSocket() {
  const cfg = runtimeConfig()
  if (!cfg.wsUrl) return
  socket = createSocketClient({
    url: cfg.wsUrl,
    onOpen: () => {
      sendStatus('online')
      void postHeartbeat(session.active ? 'idle' : 'online')
      logLine('WebSocket connected')
    },
    onClose: () => {
      logLine('WebSocket closed')
    },
    onError: (error) => {
      logLine(`WebSocket error: ${error.message}`)
    },
    onCommand: handleCommand,
  })
}

function setupTimers() {
  tickTimer = setInterval(onTick, 1000)
  heartbeatTimer = setInterval(() => {
    sendStatus(session.active ? 'idle' : 'online')
  }, 15000)
  httpHeartbeatTimer = setInterval(() => {
    void postHeartbeat(session.active ? 'idle' : 'online')
  }, 10000)
}

function cleanup() {
  if (tickTimer) clearInterval(tickTimer)
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (httpHeartbeatTimer) clearInterval(httpHeartbeatTimer)
  globalShortcut.unregisterAll()
  if (socket) socket.close()
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

app.commandLine.appendSwitch('disable-http-cache')

app.whenReady().then(() => {
  setupIpc()

  const cfg = loadConfig()
  const missingCfg = !cfg || !cfg.stationCode || !cfg.heartbeatUrl || !cfg.heartbeatSecret

  if (argvHasSetup || missingCfg) {
    createSetupWindow()
    return
  }

  app.setLoginItemSettings({ openAtLogin: true })
  createKioskWindow()
  setupShortcuts()
  setupWebSocket()
  setupTimers()
  pushState()
})

process.on('uncaughtException', (error) => {
  logLine(`uncaughtException: ${error.message}`)
  app.relaunch()
  app.exit(1)
})

app.on('before-quit', cleanup)
app.on('window-all-closed', () => {
  // kiosk should keep running; setup flow may quit intentionally
})
