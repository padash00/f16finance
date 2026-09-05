import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyObservation, decideAlertTransition } from '@/lib/server-monitoring/alert-engine'
import {
  buildTelemetryObservations,
  normalizeMonitorSettings,
  serverMonitorTelemetryV1Schema,
  type MonitorObservation,
} from '@/lib/server-monitoring/protocol'

function highObservation(value: number): MonitorObservation {
  return {
    ruleCode: 'cpu_temperature', subjectKey: 'cpu', title: 'CPU temperature', metric: 'cpu_temperature_c',
    value, unit: '°C', direction: 'high', warningThreshold: 80, criticalThreshold: 90,
    hysteresis: 5, context: {},
  }
}

function lowObservation(value: number): MonitorObservation {
  return {
    ruleCode: 'disk_free', subjectKey: 'C:', title: 'Disk free', metric: 'disk_free_pct',
    value, unit: '%', direction: 'low', warningThreshold: 15, criticalThreshold: 7,
    hysteresis: 3, context: {},
  }
}

test('warning opens once and a repeated warning has no transition', () => {
  const opening = decideAlertTransition({ observation: highObservation(82), currentState: 'normal', normalStreak: 0, recoverySamples: 2 })
  assert.equal(opening.nextState, 'warning')
  assert.equal(opening.transition, 'open')

  const repeated = decideAlertTransition({ observation: highObservation(84), currentState: 'warning', normalStreak: 0, recoverySamples: 2 })
  assert.equal(repeated.nextState, 'warning')
  assert.equal(repeated.transition, 'none')
})

test('warning escalates to critical without creating a second incident', () => {
  const result = decideAlertTransition({ observation: highObservation(94), currentState: 'warning', normalStreak: 0, recoverySamples: 2 })
  assert.equal(result.nextState, 'critical')
  assert.equal(result.transition, 'escalate')
})

test('critical temperature stays critical until it crosses the hysteresis boundary', () => {
  const stillCritical = decideAlertTransition({ observation: highObservation(87), currentState: 'critical', normalStreak: 0, recoverySamples: 2 })
  assert.equal(stillCritical.nextState, 'critical')
  assert.equal(stillCritical.transition, 'none')

  const deescalated = decideAlertTransition({ observation: highObservation(84), currentState: 'critical', normalStreak: 0, recoverySamples: 2 })
  assert.equal(deescalated.nextState, 'warning')
  assert.equal(deescalated.transition, 'deescalate')
})

test('recovery requires two consecutive normal samples', () => {
  const first = decideAlertTransition({ observation: highObservation(70), currentState: 'warning', normalStreak: 0, recoverySamples: 2 })
  assert.equal(first.nextState, 'warning')
  assert.equal(first.nextNormalStreak, 1)
  assert.equal(first.transition, 'none')

  const second = decideAlertTransition({ observation: highObservation(70), currentState: 'warning', normalStreak: 1, recoverySamples: 2 })
  assert.equal(second.nextState, 'normal')
  assert.equal(second.transition, 'recover')
})

test('low-watermark disk rule uses inverse thresholds and hysteresis', () => {
  assert.equal(classifyObservation(lowObservation(6)), 'critical')
  const held = decideAlertTransition({ observation: lowObservation(9), currentState: 'critical', normalStreak: 0, recoverySamples: 2 })
  assert.equal(held.nextState, 'critical')
  const deescalated = decideAlertTransition({ observation: lowObservation(11), currentState: 'critical', normalStreak: 0, recoverySamples: 2 })
  assert.equal(deescalated.nextState, 'warning')
})

test('offline rule is critical-only and recovers on the first heartbeat', () => {
  const offline: MonitorObservation = {
    ruleCode: 'server_offline', subjectKey: 'server', title: 'Offline', metric: 'heartbeat_age_seconds',
    value: 121, unit: 's', direction: 'high', warningThreshold: null, criticalThreshold: 120,
    hysteresis: 0, context: {},
  }
  assert.equal(classifyObservation(offline), 'critical')
  const online = decideAlertTransition({ observation: { ...offline, value: 0 }, currentState: 'critical', normalStreak: 0, recoverySamples: 1 })
  assert.equal(online.transition, 'recover')
})

test('telemetry schema rejects unknown fields and impossible percentages', () => {
  const result = serverMonitorTelemetryV1Schema.safeParse({
    schemaVersion: 1,
    telemetryId: '40000000-0000-4000-8000-000000000001',
    serverId: '20000000-0000-4000-8000-000000000001',
    timestamp: '2026-08-30T10:00:00.000Z',
    agentVersion: '1.0.0',
    system: { hostname: 'F16-SERVER', windowsVersion: 'Windows Server 2019', uptimeSeconds: 10, lastBootAt: '2026-08-30T09:59:50.000Z', agentTime: '2026-08-30T10:00:00.000Z' },
    cpu: { model: 'CPU', usagePercent: 101 },
    memory: { totalBytes: 100, usedBytes: 50, availableBytes: 50, usagePercent: 50 },
    disks: [],
    network: { internetConnected: true, latencyMs: 10, interfaces: [] },
    unexpected: true,
  })
  assert.equal(result.success, false)
})

test('telemetry schema accepts sensor provenance and disk reliability data', () => {
  const result = serverMonitorTelemetryV1Schema.safeParse({
    schemaVersion: 1,
    telemetryId: '40000000-0000-4000-8000-000000000002',
    serverId: '20000000-0000-4000-8000-000000000001',
    timestamp: '2026-08-30T10:00:00.000Z',
    agentVersion: '1.1.0',
    system: { hostname: 'F16-SERVER', windowsVersion: 'Windows Server 2019', uptimeSeconds: 10, lastBootAt: '2026-08-30T09:59:50.000Z', agentTime: '2026-08-30T10:00:00.000Z' },
    cpu: {
      model: 'CPU', usagePercent: 42, packageTemperatureC: 67, maxCoreTemperatureC: 71,
      temperatureSource: 'LibreHardwareMonitorLib 0.9.6',
      temperatureSensors: [{ name: 'CPU Core #1', temperatureC: 71 }], thermalZones: [], sensorErrors: [],
    },
    memory: { totalBytes: 100, usedBytes: 50, availableBytes: 50, usagePercent: 50 },
    disks: [{
      id: 'nvme-0', name: 'C:', driveLetter: 'C:', totalBytes: 100, usedBytes: 50, freeBytes: 50,
      freePercent: 50, temperatureC: 45, temperatureSource: 'Windows Storage Management',
      temperatureSensor: 'Composite Temperature',
      temperatureSensors: [{ name: 'Composite Temperature', temperatureC: 45 }],
      health: 'Healthy', operationalStatus: 'OK', mediaType: 'SSD', busType: 'NVMe', wearPercent: 4,
    }],
    network: { internetConnected: true, latencyMs: 10, interfaces: [] },
  })
  assert.equal(result.success, true)
})

test('telemetry preserves CPU and network diagnostics in alert observations', () => {
  const parsed = serverMonitorTelemetryV1Schema.parse({
    schemaVersion: 1,
    telemetryId: '40000000-0000-4000-8000-000000000003',
    serverId: '20000000-0000-4000-8000-000000000001',
    timestamp: '2026-09-05T10:00:00.000Z',
    agentVersion: '1.2.0',
    system: { hostname: 'F16-SERVER', windowsVersion: 'Windows Server 2019', uptimeSeconds: 10, lastBootAt: '2026-09-05T09:59:50.000Z', agentTime: '2026-09-05T10:00:00.000Z' },
    cpu: {
      model: 'CPU', usagePercent: 93,
      topProcesses: [{ pid: 4420, name: 'Connector.App', cpuPercent: 72.5, workingSetBytes: 268435456 }],
    },
    memory: { totalBytes: 100, usedBytes: 50, availableBytes: 50, usagePercent: 50 },
    disks: [],
    network: {
      internetConnected: false,
      latencyMs: null,
      interfaces: [],
      diagnostics: {
        verdict: 'dns_failure',
        gateway: { target: '192.168.1.1', reachable: true, latencyMs: 1 },
        external: { target: '1.1.1.1', reachable: true, latencyMs: 28 },
        dns: { target: 'www.ordaops.kz', reachable: false, latencyMs: 3000, addresses: [], error: 'DNS timeout' },
        https: { target: 'https://www.ordaops.kz', reachable: false, latencyMs: null, statusCode: null, error: 'DNS name does not exist' },
      },
    },
  })
  const settings = normalizeMonitorSettings({
    cpu_temp_warning_c: 80, cpu_temp_critical_c: 90,
    cpu_usage_warning_pct: 90, cpu_usage_critical_pct: 98,
    ram_usage_warning_pct: 90, ram_usage_critical_pct: 98,
    disk_temp_warning_c: 70, disk_temp_critical_c: 80,
    disk_free_warning_pct: 15, disk_free_critical_pct: 7,
    cpu_temp_hysteresis_c: 5, cpu_usage_hysteresis_pct: 5, ram_usage_hysteresis_pct: 5,
    disk_temp_hysteresis_c: 5, disk_free_hysteresis_pct: 3,
    recovery_samples: 2, offline_timeout_seconds: 120,
    history_bucket_seconds: 300, history_retention_days: 30,
    telegram_enabled: true, notify_warning: true, notify_critical: true, notify_recovery: true,
  })

  const observations = buildTelemetryObservations(parsed, settings)
  const cpu = observations.find((item) => item.ruleCode === 'cpu_usage')
  const internet = observations.find((item) => item.ruleCode === 'internet_connectivity')
  assert.deepEqual(cpu?.context.topProcesses, parsed.cpu.topProcesses)
  assert.deepEqual(internet?.context.networkDiagnostics, parsed.network.diagnostics)
})
