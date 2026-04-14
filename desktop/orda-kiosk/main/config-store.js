const fs = require('node:fs')
const path = require('node:path')
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

module.exports = { loadConfig, saveConfig, configPath }
