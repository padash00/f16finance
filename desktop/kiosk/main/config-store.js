const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { app } = require('electron')

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

function saveConfig(cfg) {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

function ensureDeviceToken() {
  const cfg = loadConfig() || {}
  if (cfg.deviceToken && String(cfg.deviceToken).trim()) return String(cfg.deviceToken)
  const token = crypto.randomUUID()
  saveConfig({ ...cfg, deviceToken: token })
  return token
}

function clearConfig() {
  try {
    fs.unlinkSync(configPath())
  } catch (_) {
    // ignore if file doesn't exist
  }
}

module.exports = { loadConfig, saveConfig, configPath, ensureDeviceToken, clearConfig }
