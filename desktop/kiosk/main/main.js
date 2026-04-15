const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, globalShortcut, Menu } = require('electron')

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

const { loadConfig, saveConfig, ensureDeviceToken, clearConfig } = require('./config-store')
const { createSocketClient } = require('./websocket')
const { launchGame, stopGame, getGameState } = require('./launcher')
const { shutdownPc, rebootPc } = require('./system')
const { getDeviceNetworkIdentity } = require('./device')
const { setupRealtime, closeRealtime } = require('./realtime')

const argvHasSetup = process.argv.includes('--setup')

function relaunchWithoutSetupFlag() {
  const args = process.argv
    .slice(1)
    .filter((a) => a !== '--setup' && a !== '--inspect' && !a.startsWith('--inspect='))
  app.relaunch({ args })
  app.exit(0)
}

function runtimeConfig() {
  const fileCfg = loadConfig() || {}
  const serverBaseUrl = process.env.KIOSK_SERVER_BASE_URL || fileCfg.serverBaseUrl || 'http://127.0.0.1:3000'
  const heartbeatPath = fileCfg.heartbeatPath || '/api/kiosk/heartbeat'
  return {
    stationCode: process.env.STATION_CODE || fileCfg.stationCode || 'VIP-111',
    stationId: fileCfg.stationId || '',
    clubName: process.env.CLUB_NAME || fileCfg.clubName || 'ORDA CLUB',
    defaultGamePath: process.env.DEFAULT_GAME_PATH || fileCfg.defaultGamePath || 'D:\\Games\\CS2\\cs2.exe',
    wsUrl: process.env.KIOSK_WS_URL || fileCfg.wsUrl || '',
    serverBaseUrl: serverBaseUrl.replace(/\/+$/, ''),
    heartbeatUrl: process.env.KIOSK_HEARTBEAT_URL || fileCfg.heartbeatUrl || `${serverBaseUrl.replace(/\/+$/, '')}${heartbeatPath}`,
    clientSecret: process.env.KIOSK_CLIENT_SECRET || fileCfg.clientSecret || '',
    deviceToken: fileCfg.deviceToken || '',
    heartbeatPath,
  }
}

let mainWindow = null
let setupWindow = null
let socket = null
let heartbeatTimer = null
let httpHeartbeatTimer = null
let tickTimer = null
let knownStationId = null
let realtimeReady = false
let lastHeartbeatStatus = 'pending'  // 'ok' | 'error:{code}' | 'pending'

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
    stationId: cfg.stationId || knownStationId || '',
    realtimeConnected: realtimeReady,
    heartbeatStatus: lastHeartbeatStatus,
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
  logLine(`postHeartbeat called: status=${status} hasSecret=${!!cfg.clientSecret} hasToken=${!!cfg.deviceToken} url=${cfg.heartbeatUrl}`)
  if (!cfg.clientSecret) {
    lastHeartbeatStatus = 'error:no-secret'
    logLine('postHeartbeat skipped: clientSecret missing from config')
    pushState()
    return
  }
  if (!cfg.deviceToken) {
    lastHeartbeatStatus = 'error:no-token'
    logLine('postHeartbeat skipped: deviceToken missing from config')
    pushState()
    return
  }
  const net = getDeviceNetworkIdentity()
  try {
    const body = {
      deviceToken: cfg.deviceToken,
      device_ip: net.ip,
      device_mac: net.mac,
      status,
    }
    // Prefer stationId (from registration) over stationCode lookup to avoid ambiguity
    if (cfg.stationId) {
      body.stationId = cfg.stationId
    } else {
      body.stationCode = cfg.stationCode
    }
    const controller = new AbortController()
    const fetchTimeout = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(cfg.heartbeatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kiosk-secret': cfg.clientSecret },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(fetchTimeout)
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      lastHeartbeatStatus = `error:${res.status}:${payload?.error || ''}`
      logLine(`heartbeat http ${res.status}: ${JSON.stringify(payload || {})}`)
      pushState()
    } else {
      lastHeartbeatStatus = 'ok'
      pushState()
      const resolvedStationId = payload?.stationId || cfg.stationId
      if (resolvedStationId && !realtimeReady) {
        knownStationId = resolvedStationId
        realtimeReady = true
        void initRealtime(cfg.serverBaseUrl, resolvedStationId)
      }
      // Sync session state from server (handles kiosk restart mid-session)
      if (payload?.activeSession && !session.active) {
        const endsAtMs = new Date(payload.activeSession.endsAt).getTime()
        const remainingSec = Math.floor((endsAtMs - Date.now()) / 1000)
        if (remainingSec > 5) {
          logLine(`heartbeat: restoring session from server, ${remainingSec}s remaining`)
          applyStartSession({ durationSec: remainingSec, tariffName: payload.activeSession.tariffName })
        }
      } else if (payload?.activeSession === null && session.active) {
        logLine('heartbeat: server has no active session, clearing local session')
        clearSessionAndLock()
      }
    }
    // Even on auth failure (409 device mismatch), stationId may be returned —
    // use it to ensure realtime is connected to the correct channel
    if (!res.ok && payload?.stationId && !realtimeReady) {
      const resolvedStationId = payload.stationId
      knownStationId = resolvedStationId
      realtimeReady = true
      void initRealtime(cfg.serverBaseUrl, resolvedStationId)
    }
  } catch (error) {
    const isTimeout = error?.name === 'AbortError'
    lastHeartbeatStatus = isTimeout ? 'error:timeout' : `error:network`
    logLine(`heartbeat failed (${isTimeout ? 'timeout' : 'network'}): ${error.message}`)
    pushState()
  }
}

async function initRealtime(serverBaseUrl, stationId) {
  try {
    const res = await fetch(`${serverBaseUrl}/api/kiosk/rtconfig`)
    const data = await res.json().catch(() => null)
    if (!data?.ok || !data.supabaseUrl || !data.supabaseAnonKey) {
      logLine('Realtime: rtconfig not available, will retry on next heartbeat')
      realtimeReady = false  // allow retry on next heartbeat
      return
    }
    const subscribed = await setupRealtime({
      supabaseUrl: data.supabaseUrl,
      supabaseAnonKey: data.supabaseAnonKey,
      stationId,
      onCommand: handleCommand,
      onStatusChange: (status) => {
        // If connection drops after SUBSCRIBED, mark for retry on next heartbeat
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          logLine(`Realtime dropped (${status}), will retry on next heartbeat`)
          realtimeReady = false
        }
      },
      logLine,
    })
    if (!subscribed) {
      logLine('Realtime: subscription failed, will retry on next heartbeat')
      realtimeReady = false
    }
  } catch (error) {
    logLine(`initRealtime failed: ${error.message}, will retry on next heartbeat`)
    realtimeReady = false  // allow retry on next heartbeat
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
  return launchGame(pathToRun, {
    onExit: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
        mainWindow.focus()
        sendStatus(session.active ? 'idle' : 'online')
        void postHeartbeat(session.active ? 'idle' : 'online')
        pushState()
      }
    },
  })
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
    case 'ping':
      logLine('ping received from server')
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('kiosk:ping', { ts: message.ts })
      }
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
  if (isDev) {
    setupWindow.loadURL('http://localhost:5173?screen=setup')
  } else {
    setupWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { screen: 'setup' } })
  }
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
    const ctrlShiftEsc = input.control && input.shift && input.key === 'Escape'
    const ctrlShiftDel = input.control && input.shift && input.key === 'Delete'
    const winKey = input.meta // Windows/Super key
    if (altF4 || altTab || ctrlW || ctrlShiftEsc || ctrlShiftDel || winKey) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
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
  globalShortcut.register('CommandOrControl+Shift+Escape', () => {}) // Task Manager
  globalShortcut.register('CommandOrControl+Shift+Delete', () => {}) // Alt Task Manager shortcut
  globalShortcut.register('Super', () => {}) // Win key (best-effort, kernel may override)
}

function setupIpc() {
  ipcMain.handle('setup:load', async () => {
    const cfg = loadConfig() || {}
    const baseFromCfg = String(cfg.serverBaseUrl || '').trim()
    const hbFromCfg = String(cfg.heartbeatUrl || '').trim()
    const guessedBase = hbFromCfg.endsWith('/api/kiosk/heartbeat')
      ? hbFromCfg.slice(0, hbFromCfg.length - '/api/kiosk/heartbeat'.length)
      : baseFromCfg
    return {
      stationCode: cfg.stationCode || '',
      serverBaseUrl: guessedBase || '',
      provisioningKey: '',
      wsUrl: cfg.wsUrl || '',
      clubName: cfg.clubName || '',
      defaultGamePath: cfg.defaultGamePath || '',
    }
  })

  ipcMain.handle('setup:save', async (_event, payload) => {
    const stationCode = String(payload?.stationCode || '').trim()
    const serverBaseUrl = String(payload?.serverBaseUrl || '').trim().replace(/\/+$/, '')
    const provisioningKey = String(payload?.provisioningKey || '').trim()
    if (!stationCode) return { ok: false, error: 'stationCode-required' }
    if (!serverBaseUrl) return { ok: false, error: 'serverBaseUrl-required' }
    if (!provisioningKey) return { ok: false, error: 'provisioningKey-required' }

    const deviceToken = ensureDeviceToken()
    const net = getDeviceNetworkIdentity()
    const registerUrl = `${serverBaseUrl}/api/kiosk/register`
    const registerRes = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stationCode,
        provisioningKey,
        deviceToken,
        device_ip: net.ip,
        device_mac: net.mac,
      }),
    })
    const registerPayload = await registerRes.json().catch(() => null)
    if (!registerRes.ok || !registerPayload?.ok) {
      return { ok: false, error: String(registerPayload?.error || `register-failed-${registerRes.status}`) }
    }

    saveConfig({
      stationCode,
      stationId: String(registerPayload.stationId || ''),
      serverBaseUrl,
      heartbeatUrl: `${serverBaseUrl}${String(registerPayload.heartbeatPath || '/api/kiosk/heartbeat')}`,
      heartbeatPath: String(registerPayload.heartbeatPath || '/api/kiosk/heartbeat'),
      clientSecret: String(registerPayload.clientSecret || ''),
      deviceToken,
      wsUrl: String(payload?.wsUrl || '').trim(),
      clubName: String(payload?.clubName || '').trim(),
      defaultGamePath: String(payload?.defaultGamePath || '').trim(),
    })
    relaunchWithoutSetupFlag()
    return { ok: true }
  })

  ipcMain.handle('setup:clear-config', async () => {
    clearConfig()
    app.relaunch({ args: ['--setup'] })
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

  ipcMain.handle('kiosk:get-config', () => {
    const cfg = runtimeConfig()
    return {
      serverBaseUrl: cfg.serverBaseUrl,
      clientSecret: cfg.clientSecret,
      deviceToken: cfg.deviceToken,
      stationCode: cfg.stationCode,
    }
  })

  ipcMain.handle('kiosk:start-session-local', (_event, payload) => {
    const durationSec = Number(payload?.durationSec || 0)
    if (durationSec <= 0) return { ok: false, error: 'invalid-duration' }
    if (session.bindingBlocked) return { ok: false, error: 'binding-blocked' }
    session.active = true
    session.tariffName = String(payload?.tariffName || 'Тариф')
    session.endsAtMs = Date.now() + durationSec * 1000
    if (Array.isArray(payload?.games)) session.games = payload.games
    pushState()
    void postHeartbeat('idle')
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
  void closeRealtime()
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

app.commandLine.appendSwitch('disable-http-cache')

app.whenReady().then(() => {
  setupIpc()

  const cfg = loadConfig()
  const missingCfg = !cfg || !cfg.stationCode || !cfg.heartbeatUrl || !cfg.clientSecret || !cfg.deviceToken

  if (argvHasSetup || missingCfg) {
    createSetupWindow()
    return
  }

  app.setLoginItemSettings({ openAtLogin: true })
  const { configPath } = require('./config-store')
  logLine(`startup: configPath=${configPath()} stationId=${cfg.stationId} hasSecret=${!!cfg.clientSecret} hasToken=${!!cfg.deviceToken}`)
  createKioskWindow()
  setupShortcuts()
  setupWebSocket()
  setupTimers()
  pushState()

  // Fire first heartbeat immediately (don't wait 10s for the interval)
  void postHeartbeat('online')

  // If stationId is already saved from registration, init realtime immediately
  // (don't wait for the first heartbeat which fires after 10 seconds)
  if (cfg.stationId) {
    knownStationId = cfg.stationId
    realtimeReady = true
    const serverBaseUrl = String(cfg.serverBaseUrl || '').replace(/\/+$/, '')
    void initRealtime(serverBaseUrl, cfg.stationId)
  }
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
