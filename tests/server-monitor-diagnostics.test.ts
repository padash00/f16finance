import assert from 'node:assert/strict'
import test from 'node:test'

import { getMonitorDiagnosticLines } from '@/lib/server-monitoring/diagnostics'
import { formatMonitorTelegramMessage } from '@/lib/server-monitoring/notification-format'

test('CPU alert explains which processes consumed CPU', () => {
  const context = {
    topProcesses: [
      { pid: 4420, name: 'Connector.App', cpuPercent: 72.5, workingSetBytes: 268435456 },
      { pid: 900, name: 'worker<unsafe>', cpuPercent: 11.2, workingSetBytes: 104857600 },
    ],
  }
  assert.deepEqual(getMonitorDiagnosticLines(context), [
    'Connector.App: 72,5% CPU, 256 МБ RAM, PID 4420',
    'worker<unsafe>: 11,2% CPU, 100 МБ RAM, PID 900',
  ])
  const message = formatMonitorTelegramMessage({
    severity: 'warning', transition: 'opened', serverName: 'F16 Arena', title: 'Загрузка CPU',
    value: 93, unit: '%', threshold: 90, context,
  })
  assert.match(message, /<b>Диагностика<\/b>/)
  assert.match(message, /Connector\.App: 72,5% CPU/)
  assert.match(message, /worker&lt;unsafe&gt;/)
})

test('network alert names DNS failure and shows every probe', () => {
  const context = {
    networkDiagnostics: {
      verdict: 'dns_failure',
      gateway: { reachable: true }, external: { reachable: true },
      dns: { reachable: false }, https: { reachable: false },
    },
  }
  assert.deepEqual(getMonitorDiagnosticLines(context), [
    'Причина: DNS не разрешает адрес ORDA',
    'Шлюз: доступен · IP: доступен · DNS: недоступен · ORDA HTTPS: недоступен',
  ])
})
