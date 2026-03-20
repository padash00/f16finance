/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged

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
}

app.whenReady().then(() => {
  // Inject CORS headers so renderer can make API requests without webSecurity: false
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
        'Access-Control-Allow-Headers': ['content-type, x-point-device-token'],
      },
    })
  })

  createWindow()
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

// ─── Open URL in system browser ──────────────────────────────────────────────

ipcMain.handle('shell:openExternal', (_, url) => {
  shell.openExternal(url)
})
