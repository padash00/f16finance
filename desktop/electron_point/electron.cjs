/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged
const releasePageUrl = 'https://github.com/padash00/f16finance/releases'

const updaterState = {
  status: isDev ? 'development' : 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  releaseNotes: null,
  releaseDate: null,
  progress: null,
  error: null,
}

let updateCheckPromise = null
let updateDownloadPromise = null

function normalizeReleaseNotes(notes) {
  if (!notes) return null
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => entry?.note || entry?.version || '')
      .filter(Boolean)
      .join('\n\n')
  }
  return String(notes)
}

function broadcastUpdaterState() {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:state', { ...updaterState })
    }
  })
}

function updateUpdaterState(patch) {
  Object.assign(updaterState, patch)
  broadcastUpdaterState()
}

function ensureUpdaterReady() {
  if (isDev) {
    updateUpdaterState({
      status: 'development',
      error: null,
    })
    return false
  }

  return true
}

async function checkForAppUpdates(options = {}) {
  const silent = options.silent === true
  if (!ensureUpdaterReady()) return { ...updaterState }
  if (updateCheckPromise) return updateCheckPromise

  updateCheckPromise = autoUpdater.checkForUpdates()
    .then(() => ({ ...updaterState }))
    .catch((error) => {
      if (!silent) {
        updateUpdaterState({
          status: 'error',
          error: error?.message || 'Не удалось проверить обновления.',
        })
      }
      return { ...updaterState }
    })
    .finally(() => {
      updateCheckPromise = null
    })

  return updateCheckPromise
}

async function downloadAppUpdate() {
  if (!ensureUpdaterReady()) return { ...updaterState }

  if (updaterState.status === 'downloaded') {
    return { ...updaterState }
  }

  if (updaterState.status !== 'available' && updaterState.status !== 'downloading') {
    await checkForAppUpdates()
  }

  if (updaterState.status !== 'available' && updaterState.status !== 'downloading') {
    return { ...updaterState }
  }

  if (updateDownloadPromise) return updateDownloadPromise

  updateDownloadPromise = autoUpdater.downloadUpdate()
    .then(() => ({ ...updaterState }))
    .catch((error) => {
      updateUpdaterState({
        status: 'error',
        error: error?.message || 'Не удалось скачать обновление.',
      })
      return { ...updaterState }
    })
    .finally(() => {
      updateDownloadPromise = null
    })

  return updateDownloadPromise
}

function installAppUpdate() {
  if (!ensureUpdaterReady()) return { ok: false }
  if (updaterState.status !== 'downloaded') {
    return { ok: false, error: 'Обновление ещё не скачано.' }
  }

  updateUpdaterState({
    status: 'installing',
    error: null,
  })

  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true)
  }, 250)

  return { ok: true }
}

function initAutoUpdater() {
  if (!ensureUpdaterReady()) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    updateUpdaterState({
      status: 'checking',
      error: null,
      progress: null,
    })
  })

  autoUpdater.on('update-available', (info) => {
    updateUpdaterState({
      status: 'available',
      latestVersion: info.version || null,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      releaseDate: info.releaseDate || null,
      progress: null,
      error: null,
    })
  })

  autoUpdater.on('update-not-available', () => {
    updateUpdaterState({
      status: 'idle',
      latestVersion: null,
      releaseNotes: null,
      releaseDate: null,
      progress: null,
      error: null,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    updateUpdaterState({
      status: 'downloading',
      progress: {
        percent: Number(progress.percent || 0),
        transferred: Number(progress.transferred || 0),
        total: Number(progress.total || 0),
        bytesPerSecond: Number(progress.bytesPerSecond || 0),
      },
      error: null,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateUpdaterState({
      status: 'downloaded',
      latestVersion: info.version || updaterState.latestVersion,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes) || updaterState.releaseNotes,
      releaseDate: info.releaseDate || updaterState.releaseDate,
      progress: {
        percent: 100,
        transferred: updaterState.progress?.total || 0,
        total: updaterState.progress?.total || 0,
        bytesPerSecond: 0,
      },
      error: null,
    })
  })

  autoUpdater.on('error', (error) => {
    updateUpdaterState({
      status: 'error',
      error: error?.message || 'Ошибка обновления.',
    })
  })

  setTimeout(() => {
    void checkForAppUpdates({ silent: true })
  }, 3000)
}

// ─── Window ──────────────────────────────────────────────────────────────────

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#ffffff',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // DevTools открываются только по F12
    mainWindow.webContents.on('before-input-event', (_, input) => {
      if (input.key === 'F12') mainWindow.webContents.toggleDevTools()
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'))
  }

  mainWindow.webContents.on('did-finish-load', () => {
    broadcastUpdaterState()
  })
}

app.whenReady().then(() => {
  // Inject CORS headers so renderer can make API requests without webSecurity: false
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
        'Access-Control-Allow-Headers': ['content-type, x-point-device-token, x-point-company-id, x-point-operator-id, x-point-operator-auth-id'],
      },
    })
  })

  createWindow()
  initAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── Config ──────────────────────────────────────────────────────────────────

const configPath = () => path.join(app.getPath('userData'), 'config.json')

ipcMain.handle('config:get', () => {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
  } catch {
    return {}
  }
})

ipcMain.handle('config:set', (_, config) => {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8')
  return { ok: true }
})

// ─── JSON offline queue (без нативных зависимостей) ──────────────────────────

const queuePath = () => path.join(app.getPath('userData'), 'queue.json')
let _nextId = 1

function readQueue() {
  try {
    const data = JSON.parse(fs.readFileSync(queuePath(), 'utf-8'))
    // Восстанавливаем счётчик ID
    if (data.length > 0) {
      _nextId = Math.max(...data.map((i) => i.id)) + 1
    }
    return data
  } catch {
    return []
  }
}

function writeQueue(items) {
  fs.writeFileSync(queuePath(), JSON.stringify(items, null, 2), 'utf-8')
}

ipcMain.handle('queue:add', (_, { type, payload, localRef }) => {
  const items = readQueue()
  const id = _nextId++
  items.push({
    id,
    type,
    payload,
    status: 'pending',
    local_ref: localRef || null,
    attempts: 0,
    last_error: null,
    created_at: new Date().toISOString(),
  })
  writeQueue(items)
  return { id }
})

ipcMain.handle('queue:list', (_, opts = {}) => {
  const items = readQueue()
  if (opts.status) return items.filter((i) => i.status === opts.status)
  return items.filter((i) => i.status !== 'done')
})

ipcMain.handle('queue:update', (_, { id, status, error }) => {
  const items = readQueue()
  const item = items.find((i) => i.id === id)
  if (item) {
    item.status = status
    item.last_error = error || null
    item.attempts = (item.attempts || 0) + 1
    writeQueue(items)
  }
  return { ok: true }
})

ipcMain.handle('queue:done', (_, { id }) => {
  const items = readQueue().filter((i) => i.id !== id)
  writeQueue(items)
  return { ok: true }
})

ipcMain.handle('queue:count', () => {
  return readQueue().filter((i) => i.status === 'pending').length
})

// ─── File dialog + Excel import ───────────────────────────────────────────────

ipcMain.handle('dialog:openFile', async (_, opts = {}) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: opts.filters || [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('file:readBuffer', (_, filePath) => {
  return fs.readFileSync(filePath)
})

// ─── Cache (bootstrap + products для офлайн-режима) ──────────────────────────

const cachePath = () => path.join(app.getPath('userData'), 'cache.json')

ipcMain.handle('cache:get', () => {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf-8'))
  } catch {
    return {}
  }
})

ipcMain.handle('cache:set', (_, data) => {
  fs.writeFileSync(cachePath(), JSON.stringify(data, null, 2), 'utf-8')
  return { ok: true }
})

// ─── App info ─────────────────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('updater:getState', () => ({ ...updaterState }))
ipcMain.handle('updater:check', () => checkForAppUpdates())
ipcMain.handle('updater:download', () => downloadAppUpdate())
ipcMain.handle('updater:install', () => installAppUpdate())
ipcMain.handle('updater:openReleases', () => {
  shell.openExternal(releasePageUrl)
  return { ok: true }
})

// ─── Open URL in system browser ──────────────────────────────────────────────

ipcMain.handle('shell:openExternal', (_, url) => {
  shell.openExternal(url)
})
