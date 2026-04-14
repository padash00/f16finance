const os = require('node:os')

function normalizeMac(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const canonical = raw.replace(/-/g, ':').toUpperCase()
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(canonical)) return null
  return canonical
}

function pickPrimaryInterface() {
  const interfaces = os.networkInterfaces()
  const candidates = []

  for (const [name, records] of Object.entries(interfaces)) {
    for (const rec of records || []) {
      if (!rec || rec.internal) continue
      if (rec.family !== 'IPv4' && rec.family !== 4) continue
      const ip = String(rec.address || '')
      if (!ip || ip.startsWith('169.254.')) continue
      candidates.push({
        name,
        ip,
        mac: normalizeMac(rec.mac),
      })
    }
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => a.name.localeCompare(b.name))
  return candidates[0]
}

function getDeviceNetworkIdentity() {
  const primary = pickPrimaryInterface()
  if (!primary) return { ip: null, mac: null, iface: null }
  return {
    ip: primary.ip || null,
    mac: primary.mac || null,
    iface: primary.name || null,
  }
}

module.exports = { getDeviceNetworkIdentity }
