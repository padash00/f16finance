import { z } from 'zod'

const finiteNumber = z.number().finite()
const percentage = finiteNumber.min(0).max(100)
const temperature = finiteNumber.min(-100).max(250)
const byteCount = finiteNumber.min(0).max(Number.MAX_SAFE_INTEGER)

const systemSchema = z.object({
  hostname: z.string().trim().min(1).max(255),
  windowsVersion: z.string().trim().min(1).max(500),
  uptimeSeconds: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  lastBootAt: z.string().datetime({ offset: true }),
  agentTime: z.string().datetime({ offset: true }),
}).strict()

const cpuSchema = z.object({
  model: z.string().trim().min(1).max(500),
  usagePercent: percentage,
  packageTemperatureC: temperature.nullable().optional(),
  maxCoreTemperatureC: temperature.nullable().optional(),
  temperatureSource: z.string().trim().max(160).nullable().optional(),
  temperatureSensors: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    temperatureC: temperature,
  }).strict()).max(256).optional(),
  thermalZones: z.array(z.object({
    name: z.string().trim().min(1).max(500),
    temperatureC: temperature,
  }).strict()).max(64).optional(),
  sensorErrors: z.array(z.string().trim().min(1).max(1000)).max(5).optional(),
}).strict()

const memorySchema = z.object({
  totalBytes: byteCount,
  usedBytes: byteCount,
  availableBytes: byteCount,
  usagePercent: percentage,
}).strict().superRefine((memory, context) => {
  if (memory.usedBytes > memory.totalBytes || memory.availableBytes > memory.totalBytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'memory values exceed totalBytes' })
  }
})

export const monitorDiskSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(255),
  model: z.string().trim().max(500).nullable().optional(),
  driveLetter: z.string().trim().regex(/^[A-Za-z]:$/).nullable().optional(),
  volumeName: z.string().trim().max(255).nullable().optional(),
  fileSystem: z.string().trim().max(64).nullable().optional(),
  totalBytes: byteCount,
  usedBytes: byteCount,
  freeBytes: byteCount,
  freePercent: percentage,
  temperatureC: temperature.nullable().optional(),
  temperatureSource: z.string().trim().max(160).nullable().optional(),
  temperatureSensor: z.string().trim().max(160).nullable().optional(),
  temperatureSensors: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    temperatureC: temperature,
  }).strict()).max(32).optional(),
  health: z.string().trim().max(120).nullable().optional(),
  operationalStatus: z.string().trim().max(240).nullable().optional(),
  mediaType: z.string().trim().max(120).nullable().optional(),
  busType: z.string().trim().max(120).nullable().optional(),
  wearPercent: percentage.nullable().optional(),
  status: z.string().trim().max(120).nullable().optional(),
}).strict().superRefine((disk, context) => {
  if (disk.usedBytes > disk.totalBytes || disk.freeBytes > disk.totalBytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'disk values exceed totalBytes' })
  }
})

export const monitorNetworkInterfaceSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(500).nullable().optional(),
  ipAddresses: z.array(z.string().trim().min(1).max(64)).max(32),
  status: z.enum(['up', 'down', 'unknown']),
  macAddress: z.string().trim().max(64).nullable().optional(),
  linkSpeedBps: byteCount.nullable().optional(),
  rxBytesPerSecond: byteCount,
  txBytesPerSecond: byteCount,
}).strict()

const networkSchema = z.object({
  internetConnected: z.boolean(),
  latencyMs: finiteNumber.min(0).max(600_000).nullable().optional(),
  interfaces: z.array(monitorNetworkInterfaceSchema).max(64),
}).strict()

export const serverMonitorTelemetryV1Schema = z.object({
  schemaVersion: z.literal(1),
  telemetryId: z.string().uuid(),
  serverId: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  agentVersion: z.string().trim().min(1).max(120),
  system: systemSchema,
  cpu: cpuSchema,
  memory: memorySchema,
  disks: z.array(monitorDiskSchema).max(64),
  network: networkSchema,
}).strict()

export type ServerMonitorTelemetryV1 = z.infer<typeof serverMonitorTelemetryV1Schema>
export type MonitorDisk = z.infer<typeof monitorDiskSchema>
export type MonitorNetworkInterface = z.infer<typeof monitorNetworkInterfaceSchema>

export type ServerMonitorSettings = {
  cpu_temp_warning_c: number
  cpu_temp_critical_c: number
  cpu_usage_warning_pct: number
  cpu_usage_critical_pct: number
  ram_usage_warning_pct: number
  ram_usage_critical_pct: number
  disk_temp_warning_c: number
  disk_temp_critical_c: number
  disk_free_warning_pct: number
  disk_free_critical_pct: number
  cpu_temp_hysteresis_c: number
  cpu_usage_hysteresis_pct: number
  ram_usage_hysteresis_pct: number
  disk_temp_hysteresis_c: number
  disk_free_hysteresis_pct: number
  recovery_samples: number
  offline_timeout_seconds: number
  history_bucket_seconds: number
  history_retention_days: number
  telegram_enabled: boolean
  notify_warning: boolean
  notify_critical: boolean
  notify_recovery: boolean
}

export type AlertSeverity = 'normal' | 'warning' | 'critical'
export type AlertDirection = 'high' | 'low'

export type MonitorObservation = {
  ruleCode: 'cpu_temperature' | 'cpu_usage' | 'ram_usage' | 'disk_temperature' | 'disk_free' | 'internet_connectivity' | 'server_offline'
  subjectKey: string
  title: string
  metric: string
  value: number
  unit: string
  direction: AlertDirection
  warningThreshold: number | null
  criticalThreshold: number
  hysteresis: number
  context: Record<string, unknown>
}

function numeric(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error('invalid-monitor-setting')
  return parsed
}

export function normalizeMonitorSettings(row: Record<string, unknown>): ServerMonitorSettings {
  return {
    cpu_temp_warning_c: numeric(row.cpu_temp_warning_c),
    cpu_temp_critical_c: numeric(row.cpu_temp_critical_c),
    cpu_usage_warning_pct: numeric(row.cpu_usage_warning_pct),
    cpu_usage_critical_pct: numeric(row.cpu_usage_critical_pct),
    ram_usage_warning_pct: numeric(row.ram_usage_warning_pct),
    ram_usage_critical_pct: numeric(row.ram_usage_critical_pct),
    disk_temp_warning_c: numeric(row.disk_temp_warning_c),
    disk_temp_critical_c: numeric(row.disk_temp_critical_c),
    disk_free_warning_pct: numeric(row.disk_free_warning_pct),
    disk_free_critical_pct: numeric(row.disk_free_critical_pct),
    cpu_temp_hysteresis_c: numeric(row.cpu_temp_hysteresis_c),
    cpu_usage_hysteresis_pct: numeric(row.cpu_usage_hysteresis_pct),
    ram_usage_hysteresis_pct: numeric(row.ram_usage_hysteresis_pct),
    disk_temp_hysteresis_c: numeric(row.disk_temp_hysteresis_c),
    disk_free_hysteresis_pct: numeric(row.disk_free_hysteresis_pct),
    recovery_samples: numeric(row.recovery_samples),
    offline_timeout_seconds: numeric(row.offline_timeout_seconds),
    history_bucket_seconds: numeric(row.history_bucket_seconds),
    history_retention_days: numeric(row.history_retention_days),
    telegram_enabled: row.telegram_enabled === true,
    notify_warning: row.notify_warning === true,
    notify_critical: row.notify_critical === true,
    notify_recovery: row.notify_recovery === true,
  }
}

function diskSubject(disk: MonitorDisk): string {
  return (disk.driveLetter || disk.id).trim().slice(0, 160)
}

function diskContext(disk: MonitorDisk): Record<string, unknown> {
  return {
    diskId: disk.id,
    driveLetter: disk.driveLetter || null,
    name: disk.name,
    model: disk.model || null,
  }
}

export function buildTelemetryObservations(
  telemetry: ServerMonitorTelemetryV1,
  settings: ServerMonitorSettings,
): MonitorObservation[] {
  const observations: MonitorObservation[] = []
  const cpuTemperature = Math.max(
    ...[telemetry.cpu.packageTemperatureC, telemetry.cpu.maxCoreTemperatureC]
      .filter((value): value is number => typeof value === 'number'),
    Number.NEGATIVE_INFINITY,
  )

  if (Number.isFinite(cpuTemperature)) {
    observations.push({
      ruleCode: 'cpu_temperature', subjectKey: 'cpu', title: 'Температура CPU', metric: 'cpu_temperature_c',
      value: cpuTemperature, unit: '°C', direction: 'high',
      warningThreshold: settings.cpu_temp_warning_c, criticalThreshold: settings.cpu_temp_critical_c,
      hysteresis: settings.cpu_temp_hysteresis_c, context: { cpuModel: telemetry.cpu.model },
    })
  }

  observations.push(
    {
      ruleCode: 'cpu_usage', subjectKey: 'cpu', title: 'Загрузка CPU', metric: 'cpu_usage_pct',
      value: telemetry.cpu.usagePercent, unit: '%', direction: 'high',
      warningThreshold: settings.cpu_usage_warning_pct, criticalThreshold: settings.cpu_usage_critical_pct,
      hysteresis: settings.cpu_usage_hysteresis_pct, context: { cpuModel: telemetry.cpu.model },
    },
    {
      ruleCode: 'ram_usage', subjectKey: 'memory', title: 'Использование RAM', metric: 'memory_usage_pct',
      value: telemetry.memory.usagePercent, unit: '%', direction: 'high',
      warningThreshold: settings.ram_usage_warning_pct, criticalThreshold: settings.ram_usage_critical_pct,
      hysteresis: settings.ram_usage_hysteresis_pct, context: {},
    },
  )

  for (const disk of telemetry.disks) {
    const subjectKey = diskSubject(disk)
    if (typeof disk.temperatureC === 'number') {
      observations.push({
        ruleCode: 'disk_temperature', subjectKey, title: `Температура диска ${disk.driveLetter || disk.name}`,
        metric: 'disk_temperature_c', value: disk.temperatureC, unit: '°C', direction: 'high',
        warningThreshold: settings.disk_temp_warning_c, criticalThreshold: settings.disk_temp_critical_c,
        hysteresis: settings.disk_temp_hysteresis_c, context: diskContext(disk),
      })
    }
    observations.push({
      ruleCode: 'disk_free', subjectKey, title: `Свободное место ${disk.driveLetter || disk.name}`,
      metric: 'disk_free_pct', value: disk.freePercent, unit: '%', direction: 'low',
      warningThreshold: settings.disk_free_warning_pct, criticalThreshold: settings.disk_free_critical_pct,
      hysteresis: settings.disk_free_hysteresis_pct, context: diskContext(disk),
    })
  }

  observations.push({
    ruleCode: 'internet_connectivity', subjectKey: 'internet', title: 'Подключение к интернету',
    metric: 'internet_connected', value: telemetry.network.internetConnected ? 1 : 0, unit: '', direction: 'low',
    warningThreshold: null, criticalThreshold: 0.5, hysteresis: 0,
    context: { latencyMs: telemetry.network.latencyMs ?? null },
  })

  return observations
}

export function buildOfflineObservation(ageSeconds: number, timeoutSeconds: number): MonitorObservation {
  return {
    ruleCode: 'server_offline', subjectKey: 'server', title: 'Сервер не отвечает', metric: 'heartbeat_age_seconds',
    value: ageSeconds, unit: 's', direction: 'high', warningThreshold: null,
    criticalThreshold: timeoutSeconds, hysteresis: 0, context: {},
  }
}

export function toMonitorSnapshot(telemetry: ServerMonitorTelemetryV1) {
  const activeInterfaces = telemetry.network.interfaces.filter((item) => item.status === 'up')
  return {
    telemetryId: telemetry.telemetryId,
    schemaVersion: telemetry.schemaVersion,
    observedAt: telemetry.timestamp,
    agentVersion: telemetry.agentVersion,
    hostname: telemetry.system.hostname,
    windowsVersion: telemetry.system.windowsVersion,
    uptimeSeconds: telemetry.system.uptimeSeconds,
    lastBootAt: telemetry.system.lastBootAt,
    cpuUsagePct: telemetry.cpu.usagePercent,
    cpuPackageTempC: telemetry.cpu.packageTemperatureC ?? null,
    cpuCoreMaxTempC: telemetry.cpu.maxCoreTemperatureC ?? null,
    memoryUsagePct: telemetry.memory.usagePercent,
    internetConnected: telemetry.network.internetConnected,
    pingMs: telemetry.network.latencyMs ?? null,
    networkRxBps: activeInterfaces.reduce((sum, item) => sum + item.rxBytesPerSecond, 0),
    networkTxBps: activeInterfaces.reduce((sum, item) => sum + item.txBytesPerSecond, 0),
    systemData: telemetry.system,
    cpuData: telemetry.cpu,
    memoryData: telemetry.memory,
    disksData: telemetry.disks,
    networkData: telemetry.network.interfaces,
  }
}
