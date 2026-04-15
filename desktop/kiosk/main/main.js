const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, globalShortcut, Menu, powerSaveBlocker, session: electronSession } = require('electron')

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

const { loadConfig, saveConfig, ensureDeviceToken, clearConfig } = require('./config-store')
const { createSocketClient } = require('./websocket')
const { launchGame, stopGame, getGameState } = require('./launcher')
const { shutdownPc, rebootPc } = require('./system')
const { getDeviceNetworkIdentity } = require('./device')
const { setupRealtime, closeRealtime } = require('./realtime')

// Auto-updater (only active in production builds)
let autoUpdater = null
try {
  const { autoUpdater: au } = require('electron-updater')
  autoUpdater = au
} catch (_) {
  // electron-updater not available in dev
}

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
let focusTimer = null
let knownStationId = null
let realtimeInitialized = false  // have we kicked off initRealtime
let realtimeReady = false        // true only when SUBSCRIBED
let lastHeartbeatStatus = 'pending'  // 'ok' | 'error:{code}' | 'pending'
let consecutiveHeartbeatFailures = 0
let powerSaveId = null

// ── Game state ───────────────────────────────────────────────────────────────
let gameActive = false           // true while a game/browser process is running
let browserGameWindow = null     // BrowserWindow for category='browser' games
let warnedAt5min = false         // prevents repeated 5-min popup
let warnedAt1min = false         // prevents repeated 1-min popup

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
    offlineMode: consecutiveHeartbeatFailures >= 5,
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
      consecutiveHeartbeatFailures++
      lastHeartbeatStatus = `error:${res.status}:${payload?.error || ''}`
      logLine(`heartbeat http ${res.status}: ${JSON.stringify(payload || {})}`)
      pushState()
    } else {
      lastHeartbeatStatus = 'ok'
      consecutiveHeartbeatFailures = 0
      logLine(`heartbeat ok: activeSession=${JSON.stringify(payload?.activeSession ?? null)}`)
      pushState()
      const resolvedStationId = payload?.stationId || cfg.stationId
      if (resolvedStationId && !realtimeInitialized) {
        knownStationId = resolvedStationId
        realtimeInitialized = true
        void initRealtime(cfg.serverBaseUrl, resolvedStationId)
      }
      // Sync session state from server
      if (payload?.activeSession && !session.active) {
        // Restore session after kiosk restart
        const endsAtMs = new Date(payload.activeSession.endsAt).getTime()
        const remainingSec = Math.floor((endsAtMs - Date.now()) / 1000)
        if (remainingSec > 5) {
          logLine(`heartbeat: restoring session from server, ${remainingSec}s remaining`)
          applyStartSession({ durationSec: remainingSec, tariffName: payload.activeSession.tariffName })
        }
      } else if (payload?.activeSession && session.active) {
        // Correct clock drift: sync endsAtMs from server's authoritative value
        const serverEndsAtMs = new Date(payload.activeSession.endsAt).getTime()
        const drift = serverEndsAtMs - session.endsAtMs
        if (Math.abs(drift) > 5000) {
          logLine(`heartbeat: correcting clock drift ${Math.round(drift / 1000)}s`)
          session.endsAtMs = serverEndsAtMs
          pushState()
        }
      } else if (payload?.activeSession === null && session.active) {
        logLine('heartbeat: server has no active session, clearing local session')
        clearSessionAndLock()
      }
    }
    // Even on auth failure, stationId may be returned — use it for realtime channel
    if (!res.ok && payload?.stationId && !realtimeInitialized) {
      const resolvedStationId = payload.stationId
      knownStationId = resolvedStationId
      realtimeInitialized = true
      void initRealtime(cfg.serverBaseUrl, resolvedStationId)
    }
  } catch (error) {
    consecutiveHeartbeatFailures++
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
      realtimeInitialized = false  // allow retry
      pushState()
      return
    }
    const subscribed = await setupRealtime({
      supabaseUrl: data.supabaseUrl,
      supabaseAnonKey: data.supabaseAnonKey,
      stationId,
      onCommand: handleCommand,
      onStatusChange: (status) => {
        if (status === 'SUBSCRIBED') {
          realtimeReady = true
          pushState()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          logLine(`Realtime dropped (${status}), will retry on next heartbeat`)
          realtimeReady = false
          realtimeInitialized = false  // allow retry
          pushState()
        }
      },
      logLine,
    })
    if (subscribed) {
      realtimeReady = true
      pushState()
    } else {
      logLine('Realtime: subscription failed, will retry on next heartbeat')
      realtimeReady = false
      realtimeInitialized = false  // allow retry
      pushState()
    }
  } catch (error) {
    logLine(`initRealtime failed: ${error.message}, will retry on next heartbeat`)
    realtimeReady = false
    realtimeInitialized = false  // allow retry
    pushState()
  }
}

function resolveGameById(gameId) {
  const id = String(gameId || '').trim()
  if (!id) return null
  return session.games.find((g) => String(g.id) === id) || null
}

// ── Restore kiosk after game closes ─────────────────────────────────────────
function restoreKioskFromGame() {
  gameActive = false
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!isDev) {
    mainWindow.restore()
    mainWindow.setKiosk(true)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.focus()
    // Re-register Alt+Tab block now that game is gone
    try { globalShortcut.register('Alt+Tab', () => {}) } catch (_) {}
    // Restart focusTimer if not running
    if (!focusTimer) {
      focusTimer = setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
          mainWindow.setAlwaysOnTop(true, 'screen-saver')
          mainWindow.focus()
        }
      }, 30000)
    }
  }
  sendStatus(session.active ? 'idle' : 'online')
  void postHeartbeat(session.active ? 'idle' : 'online')
  pushState()
}

// ── Stop browser game window ─────────────────────────────────────────────────
function stopBrowserGame() {
  if (!browserGameWindow || browserGameWindow.isDestroyed()) return
  try {
    browserGameWindow.webContents.removeAllListeners()
    browserGameWindow.removeAllListeners('close')
    browserGameWindow.removeAllListeners('closed')
    browserGameWindow.destroy()
  } catch (_) {}
  browserGameWindow = null
}

// ── Launch browser/URL game in a separate Electron window ───────────────────
function launchBrowserGame(url, game) {
  if (browserGameWindow && !browserGameWindow.isDestroyed()) {
    browserGameWindow.focus()
    return { ok: true, alreadyRunning: true, pid: null }
  }

  // Yield kiosk to game
  gameActive = true
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null }
  if (!isDev) {
    try { globalShortcut.unregister('Alt+Tab') } catch (_) {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false)
      mainWindow.minimize()
    }
  }

  browserGameWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: !isDev,
    kiosk: !isDev,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: isDev,
    },
  })

  browserGameWindow.loadURL(url)

  if (!isDev) {
    // Block dangerous keys inside browser game
    browserGameWindow.webContents.on('before-input-event', (event, input) => {
      if (
        (input.alt && input.key === 'F4') ||
        input.meta ||
        input.key === 'F12' ||
        (input.control && input.shift && input.key.toLowerCase() === 'i')
      ) {
        event.preventDefault()
      }
    })
    browserGameWindow.on('close', (e) => e.preventDefault())
  }

  browserGameWindow.on('closed', () => {
    browserGameWindow = null
    restoreKioskFromGame()
  })

  logLine(`launchBrowserGame: ${url}`)
  return { ok: true, pid: null }
}

// ── Launch game (exe or browser) ─────────────────────────────────────────────
function launchConfiguredGame(gameId, fallbackPath) {
  const cfg = runtimeConfig()
  const game = resolveGameById(gameId)
  const category = String(game?.category || 'game')
  const pathToRun = String(game?.exePath || fallbackPath || cfg.defaultGamePath || '').trim()
  if (!pathToRun) throw new Error('game-path-required')

  // Browser/URL game
  if (category === 'browser') {
    return launchBrowserGame(pathToRun, game)
  }

  // Exe game (game or app)
  // Yield kiosk to game
  gameActive = true
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null }
  if (!isDev) {
    try { globalShortcut.unregister('Alt+Tab') } catch (_) {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false)
      mainWindow.minimize()
    }
  }

  return launchGame(pathToRun, {
    onExit: () => restoreKioskFromGame(),
  })
}

function clearSessionAndLock() {
  stopGame()
  stopBrowserGame()
  gameActive = false
  session.active = false
  session.endsAtMs = 0
  session.tariffName = ''
  warnedAt5min = false
  warnedAt1min = false
  if (!isDev && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.restore()
    mainWindow.setKiosk(true)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.focus()
    try { globalShortcut.register('Alt+Tab', () => {}) } catch (_) {}
  }
  pushState()
  sendStatus('idle')
  void postHeartbeat('offline')
}

function onTick() {
  const remaining = getRemainingSec()
  if (session.active && remaining <= 0) {
    if (gameActive) {
      stopGame()
      stopBrowserGame()
    }
    clearSessionAndLock()
    return
  }

  // Time warnings while game is running — bring kiosk to front
  if (gameActive && session.active && !isDev && mainWindow && !mainWindow.isDestroyed()) {
    if (!warnedAt5min && remaining <= 300 && remaining > 60) {
      warnedAt5min = true
      logLine('game: 5-min warning, surfacing kiosk')
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      mainWindow.focus()
      // Return to game after 15s if player didn't do anything
      setTimeout(() => {
        if (gameActive && getRemainingSec() > 60 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false)
          mainWindow.minimize()
        }
      }, 15000)
    } else if (!warnedAt1min && remaining <= 60) {
      warnedAt1min = true
      logLine('game: 1-min warning, locking kiosk on top')
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      mainWindow.focus()
      // Don't go back — player must extend or wait for session end
    }
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
  // Reset per-session warning flags
  warnedAt5min = false
  warnedAt1min = false
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
    kiosk: !isDev,
    fullscreen: !isDev,
    alwaysOnTop: !isDev,
    frame: isDev,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
    },
  })

  Menu.setApplicationMenu(null)

  if (!isDev) {
    // ── Prevent closing ──────────────────────────────────────────────
    mainWindow.on('close', (event) => { event.preventDefault() })

    // ── Prevent minimizing ───────────────────────────────────────────
    mainWindow.on('minimize', () => {
      mainWindow.restore()
      mainWindow.setKiosk(true)
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      mainWindow.focus()
    })

    // ── Block dangerous keyboard combos ──────────────────────────────
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = input.key
      const ctrl = input.control
      const alt = input.alt
      const shift = input.shift
      const meta = input.meta
      if (
        (alt && key === 'F4') ||           // Close window
        (alt && key === 'Tab') ||          // Switch app
        (ctrl && key.toLowerCase() === 'w') ||  // Close tab
        (ctrl && shift && key === 'Escape') ||  // Task manager
        (ctrl && shift && key === 'Delete') ||  // Task manager alt
        (ctrl && shift && key.toLowerCase() === 'i') || // DevTools
        (ctrl && shift && key.toLowerCase() === 'j') || // DevTools console
        (ctrl && key.toLowerCase() === 'r') || // Refresh
        (ctrl && key.toLowerCase() === 'p') || // Print
        (ctrl && key.toLowerCase() === 'u') || // View source
        (ctrl && key.toLowerCase() === 's') || // Save page
        key === 'F5' ||                     // Refresh
        key === 'F11' ||                    // Fullscreen toggle
        key === 'F12' ||                    // DevTools
        meta                                // Windows key
      ) {
        event.preventDefault()
      }
    })

    // ── Block DevTools if somehow opened ─────────────────────────────
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools()
    })

    // ── Block navigation to external URLs ────────────────────────────
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) {
        event.preventDefault()
        logLine(`Security: blocked navigation to ${url}`)
      }
    })

    // ── Block right-click context menu ───────────────────────────────
    mainWindow.webContents.on('context-menu', (event) => {
      event.preventDefault()
    })

    // ── Prevent sleep / screensaver ──────────────────────────────────
    if (powerSaveId === null) {
      powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
      logLine(`powerSaveBlocker started: id=${powerSaveId}`)
    }
  }

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  mainWindow.once('ready-to-show', () => {
    if (!isDev) {
      mainWindow.setKiosk(true)
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
    }
    mainWindow.focus()
    pushState()
  })
}

function setupShortcuts() {
  const shortcuts = [
    'Alt+F4',
    'CommandOrControl+W',
    'Alt+Tab',                          // blocked by default; unregistered while game runs
    'CommandOrControl+Shift+Escape',   // Task Manager
    'CommandOrControl+Shift+Delete',   // Task Manager alt
    'CommandOrControl+Shift+I',        // DevTools
    'CommandOrControl+Shift+J',        // DevTools console
    'F12',                             // DevTools
    'F5',                              // Refresh
    'CommandOrControl+R',              // Refresh
    'CommandOrControl+P',              // Print
    'CommandOrControl+U',              // View source
    'CommandOrControl+S',              // Save page
    'F11',                             // Fullscreen toggle
    // 'Super' removed — causes conversion failure on some Windows/Electron versions
  ]
  for (const sc of shortcuts) {
    try {
      globalShortcut.register(sc, () => {})
    } catch (e) {
      logLine(`setupShortcuts: failed to register ${sc}: ${e.message}`)
    }
  }
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

  ipcMain.handle('kiosk:return-to-game', () => {
    const state = getGameState()
    if (!state.running) return { ok: false, reason: 'no-game' }
    // Unregister Alt+Tab so game can receive it naturally
    try { globalShortcut.unregister('Alt+Tab') } catch (_) {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false)
      mainWindow.minimize()
    }
    // If it's a browser game, refocus the window directly
    if (browserGameWindow && !browserGameWindow.isDestroyed()) {
      browserGameWindow.setAlwaysOnTop(true, 'screen-saver')
      browserGameWindow.focus()
      browserGameWindow.setAlwaysOnTop(false)
    }
    return { ok: true }
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

  ipcMain.handle('kiosk:check-update', async () => {
    if (!autoUpdater) return { ok: false, reason: 'updater-not-available' }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { ok: true, updateInfo: result?.updateInfo || null }
    } catch (err) {
      return { ok: false, reason: err.message }
    }
  })

  ipcMain.handle('kiosk:install-update', () => {
    if (!autoUpdater) return { ok: false, reason: 'updater-not-available' }
    autoUpdater.quitAndInstall(false, true)
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
  // Re-assert kiosk on top every 30s (guards against Windows Focus Assist / notifications stealing focus)
  if (!isDev) {
    focusTimer = setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
        mainWindow.focus()
      }
    }, 30000)
  }
}

function cleanup() {
  if (tickTimer) clearInterval(tickTimer)
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (httpHeartbeatTimer) clearInterval(httpHeartbeatTimer)
  if (focusTimer) clearInterval(focusTimer)
  if (powerSaveId !== null) {
    try { powerSaveBlocker.stop(powerSaveId) } catch (_) {}
    powerSaveId = null
  }
  globalShortcut.unregisterAll()
  if (socket) socket.close()
  void closeRealtime()
}

// ── Single instance: only one kiosk at a time ────────────────────────────────
if (!isDev) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.exit(0)
  }
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      mainWindow.focus()
    }
  })
}

// ── Block new windows / popups ───────────────────────────────────────────────
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Block navigation in any webContents (covers <webview> if ever added)
  contents.on('will-navigate', (event, url) => {
    const okPrefixes = isDev ? ['http://localhost:5173'] : ['file://']
    if (!okPrefixes.some(p => url.startsWith(p))) {
      event.preventDefault()
    }
  })
})

// ── Reject invalid TLS certificates (prevent MITM) ──────────────────────────
app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
  logLine(`Security: certificate error for ${url} — rejected`)
  event.preventDefault()
  callback(false)
})

app.commandLine.appendSwitch('disable-http-cache')

app.whenReady().then(() => {
  // ── Deny all browser permission requests (notifications, geolocation, etc) ─
  electronSession.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    logLine(`Security: permission request '${permission}' denied`)
    callback(false)
  })

  setupIpc()

  const cfg = loadConfig()
  const missingCfg = !cfg || !cfg.stationCode || !cfg.heartbeatUrl || !cfg.clientSecret || !cfg.deviceToken

  if (argvHasSetup || missingCfg) {
    createSetupWindow()
    return
  }

  app.setLoginItemSettings({ openAtLogin: true })
  const { configPath } = require('./config-store')
  logLine(`startup: stationId=${cfg.stationId} hasSecret=${!!cfg.clientSecret} hasToken=${!!cfg.deviceToken} config=${configPath()}`)
  createKioskWindow()
  setupShortcuts()
  setupWebSocket()
  setupTimers()
  pushState()
  void postHeartbeat('online')

  // If stationId is already saved, init realtime immediately (don't wait 10s for heartbeat)
  if (cfg.stationId) {
    knownStationId = cfg.stationId
    realtimeInitialized = true
    const serverBaseUrl = String(cfg.serverBaseUrl || '').replace(/\/+$/, '')
    void initRealtime(serverBaseUrl, cfg.stationId)
  }

  // Auto-updater: check for updates silently 10s after startup (production only)
  if (!isDev && autoUpdater) {
    autoUpdater.logger = {
      info: (msg) => logLine(`updater: ${msg}`),
      warn: (msg) => logLine(`updater warn: ${msg}`),
      error: (msg) => logLine(`updater error: ${msg}`),
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      logLine(`updater: update available ${info.version}`)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('kiosk:update-available', { version: info.version })
      }
    })

    autoUpdater.on('update-downloaded', (info) => {
      logLine(`updater: update downloaded ${info.version}, will install on next quit`)
    })

    autoUpdater.on('error', (err) => {
      logLine(`updater: error ${err.message}`)
    })

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => logLine(`updater: checkForUpdates error ${err.message}`))
    }, 10000)
  }
})

process.on('uncaughtException', (error) => {
  logLine(`uncaughtException: ${error.message}\n${error.stack}`)
  app.relaunch()
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason)
  logLine(`unhandledRejection: ${msg}`)
})

app.on('before-quit', cleanup)
app.on('window-all-closed', () => {
  // kiosk should keep running; setup flow may quit intentionally
})
