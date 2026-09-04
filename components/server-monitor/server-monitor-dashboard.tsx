'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, Bell, Check, CircleGauge, Copy, Cpu, Database,
  HardDrive, KeyRound, MemoryStick, Plus, RefreshCw, Server,
  Settings2, ShieldCheck, Thermometer, Wifi, WifiOff,
} from 'lucide-react'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { cn } from '@/lib/utils'

type MonitorServer = {
  id: string
  organization_id: string
  company_id: string | null
  code: string
  name: string
  hostname: string | null
  description: string | null
  enabled: boolean
  last_seen_at: string | null
  last_agent_version: string | null
  created_at: string
}

type MonitorCurrent = {
  server_id: string
  observed_at: string
  received_at: string
  hostname: string | null
  windows_version: string | null
  uptime_seconds: number | null
  cpu_usage_pct: number | null
  cpu_package_temp_c: number | null
  cpu_core_max_temp_c: number | null
  memory_usage_pct: number | null
  internet_connected: boolean | null
  ping_ms: number | null
  network_rx_bps: number | null
  network_tx_bps: number | null
  cpu_data: Record<string, unknown>
  memory_data: Record<string, unknown>
  disks_data: unknown[]
  network_data: unknown[]
}

type MonitorSettings = {
  server_id: string
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
  offline_timeout_seconds: number
  recovery_samples: number
  telegram_enabled: boolean
  notify_warning: boolean
  notify_critical: boolean
  notify_recovery: boolean
}

type MonitorAlert = {
  id: string
  server_id: string
  severity: 'warning' | 'critical'
  title: string
  current_value: number | null
  value_unit: string | null
  started_at: string
}

type MonitorEvent = {
  id: string
  server_id: string
  severity: 'warning' | 'critical' | 'recovered'
  transition: string
  title: string
  value: number | null
  value_unit: string | null
  occurred_at: string
}

type DashboardPayload = {
  servers: MonitorServer[]
  current: MonitorCurrent[]
  settings: MonitorSettings[]
  activeAlerts: MonitorAlert[]
  events: MonitorEvent[]
  companies: Array<{ id: string; name: string; code: string | null }>
  telegramConfigured: boolean
  permissions: { manageCredentials: boolean }
}

type HistoryPoint = {
  bucket_start: string
  cpu_usage_pct: number | null
  cpu_package_temp_c: number | null
  cpu_core_max_temp_c: number | null
  memory_usage_pct: number | null
  ping_ms: number | null
  network_rx_bps: number | null
  network_tx_bps: number | null
  internet_connected: boolean | null
  disks_data: unknown[]
}

type DiskData = {
  id: string
  name: string
  driveLetter: string | null
  model: string | null
  totalBytes: number
  usedBytes: number
  freeBytes: number
  freePercent: number
  temperatureC: number | null
  temperatureSource: string | null
  temperatureSensor: string | null
  health: string | null
  operationalStatus: string | null
  mediaType: string | null
  busType: string | null
  wearPercent: number | null
}

type NetworkData = {
  id: string
  name: string
  status: 'up' | 'down' | 'unknown'
  linkSpeedBps: number | null
  ipAddresses: string[]
}

type SettingsForm = {
  cpuTempWarningC: number
  cpuTempCriticalC: number
  cpuUsageWarningPct: number
  cpuUsageCriticalPct: number
  ramUsageWarningPct: number
  ramUsageCriticalPct: number
  diskTempWarningC: number
  diskTempCriticalC: number
  diskFreeWarningPct: number
  diskFreeCriticalPct: number
  offlineTimeoutSeconds: number
  recoverySamples: number
  telegramEnabled: boolean
  notifyWarning: boolean
  notifyCritical: boolean
  notifyRecovery: boolean
}

type HealthStatus = 'healthy' | 'warning' | 'critical' | 'offline'
type HistoryRange = '1h' | '6h' | '24h' | '7d' | '30d'

const STATUS_STYLE: Record<HealthStatus, { label: string; dot: string; badge: string }> = {
  healthy: { label: 'HEALTHY', dot: 'bg-emerald-500', badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  warning: { label: 'WARNING', dot: 'bg-amber-500', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  critical: { label: 'CRITICAL', dot: 'bg-rose-500', badge: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  offline: { label: 'OFFLINE', dot: 'bg-slate-500', badge: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300' },
}

const CHART_COLORS = ['#10b981', '#38bdf8', '#f59e0b', '#e879f9', '#8b5cf6', '#ef4444']

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asTemperature(value: unknown): number | null {
  const temperature = asNumber(value)
  return temperature !== null && temperature > 0 ? temperature : null
}

function roundMetric(value: number | null, digits = 1): number | null {
  if (value === null) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function formatChartValue(value: unknown, digits: number): string {
  const number = asNumber(value)
  return number === null ? '—' : number.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

function formatChartTime(value: string, range: HistoryRange): string {
  const options: Intl.DateTimeFormatOptions = range === '1h' || range === '6h'
    ? { hour: '2-digit', minute: '2-digit' }
    : range === '24h'
      ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', hour: '2-digit' }
  return new Date(value).toLocaleString('ru-RU', options)
}

function parseDisks(value: unknown): DiskData[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const id = asText(row.id)
    const name = asText(row.name)
    const totalBytes = asNumber(row.totalBytes)
    const usedBytes = asNumber(row.usedBytes)
    const freeBytes = asNumber(row.freeBytes)
    const freePercent = asNumber(row.freePercent)
    if (!id || !name || totalBytes === null || usedBytes === null || freeBytes === null || freePercent === null) return []
    return [{
      id, name, totalBytes, usedBytes, freeBytes, freePercent,
      driveLetter: asText(row.driveLetter), model: asText(row.model),
      temperatureC: asTemperature(row.temperatureC), temperatureSource: asText(row.temperatureSource),
      temperatureSensor: asText(row.temperatureSensor),
      health: asText(row.health), operationalStatus: asText(row.operationalStatus),
      mediaType: asText(row.mediaType), busType: asText(row.busType), wearPercent: asNumber(row.wearPercent),
    }]
  })
}

function parseNetworks(value: unknown): NetworkData[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const id = asText(row.id)
    const name = asText(row.name)
    const status = row.status === 'up' || row.status === 'down' ? row.status : 'unknown'
    if (!id || !name) return []
    return [{
      id, name, status, linkSpeedBps: asNumber(row.linkSpeedBps),
      ipAddresses: Array.isArray(row.ipAddresses) ? row.ipAddresses.filter((entry): entry is string => typeof entry === 'string') : [],
    }]
  })
}

function formatBytes(value: number | null, rate = false): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let index = 0
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1 }
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: index >= 3 ? 1 : 0 })} ${units[index]}${rate ? '/с' : ''}`
}

function formatBitsPerSecond(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps']
  let amount = value
  let index = 0
  while (amount >= 1000 && index < units.length - 1) { amount /= 1000; index += 1 }
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${units[index]}`
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Связи ещё не было'
  return new Date(value).toLocaleString('ru-RU')
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${days}д ${hours}ч ${minutes}м`
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
}

function temperature(value: number | null): string {
  return value === null ? 'Датчик недоступен' : `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}°C`
}

function maxTemperature(...values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)
  return available.length ? Math.max(...available) : null
}

function MetricBar({ value, tone = 'emerald' }: { value: number | null; tone?: 'emerald' | 'amber' | 'rose' }) {
  const color = tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10" aria-hidden="true">
      <div className={cn('h-full rounded-full transition-[width]', color)} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  )
}

function toneFor(value: number | null, warning: number, critical: number, direction: 'high' | 'low' = 'high') {
  if (value === null) return 'emerald' as const
  if (direction === 'high') return value >= critical ? 'rose' as const : value >= warning ? 'amber' as const : 'emerald' as const
  return value <= critical ? 'rose' as const : value <= warning ? 'amber' as const : 'emerald' as const
}

function settingsToForm(settings: MonitorSettings): SettingsForm {
  return {
    cpuTempWarningC: Number(settings.cpu_temp_warning_c), cpuTempCriticalC: Number(settings.cpu_temp_critical_c),
    cpuUsageWarningPct: Number(settings.cpu_usage_warning_pct), cpuUsageCriticalPct: Number(settings.cpu_usage_critical_pct),
    ramUsageWarningPct: Number(settings.ram_usage_warning_pct), ramUsageCriticalPct: Number(settings.ram_usage_critical_pct),
    diskTempWarningC: Number(settings.disk_temp_warning_c), diskTempCriticalC: Number(settings.disk_temp_critical_c),
    diskFreeWarningPct: Number(settings.disk_free_warning_pct), diskFreeCriticalPct: Number(settings.disk_free_critical_pct),
    offlineTimeoutSeconds: Number(settings.offline_timeout_seconds), recoverySamples: Number(settings.recovery_samples),
    telegramEnabled: settings.telegram_enabled, notifyWarning: settings.notify_warning,
    notifyCritical: settings.notify_critical, notifyRecovery: settings.notify_recovery,
  }
}

export function ServerMonitorDashboard() {
  const { toast } = useToast()
  const { can } = useCapabilities()
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [selectedServerId, setSelectedServerId] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [historyRange, setHistoryRange] = useState<HistoryRange>('24h')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [credentialOpen, setCredentialOpen] = useState(false)
  const [oneTimeKey, setOneTimeKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [settingsForm, setSettingsForm] = useState<SettingsForm | null>(null)
  const [createForm, setCreateForm] = useState({ code: '', name: '', hostname: '', description: '', companyId: '' })
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadDashboard = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true)
    try {
      const response = await fetch('/api/system/server-monitor', { cache: 'no-store' })
      const body = await response.json().catch(() => null) as DashboardPayload & { error?: string }
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      setData(body)
      setSelectedServerId((current) => body.servers.some((server) => server.id === current) ? current : body.servers[0]?.id || '')
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить мониторинг')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadHistory = useCallback(async (serverId: string, range: HistoryRange) => {
    if (!serverId) { setHistory([]); return }
    setHistoryLoading(true)
    try {
      const response = await fetch(`/api/system/server-monitor/history?serverId=${encodeURIComponent(serverId)}&range=${range}`, { cache: 'no-store' })
      const body = await response.json().catch(() => null) as { points?: HistoryPoint[]; error?: string }
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      setHistory(body.points || [])
    } catch (historyError) {
      toast({ title: 'История недоступна', description: historyError instanceof Error ? historyError.message : 'Ошибка загрузки', variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }, [toast])

  useEffect(() => { void loadDashboard() }, [loadDashboard])
  useEffect(() => { void loadHistory(selectedServerId, historyRange) }, [loadHistory, selectedServerId, historyRange])

  useEffect(() => {
    let channel: { unsubscribe?: () => void } | null = null
    let client: { removeChannel: (value: unknown) => void } | null = null
    let cancelled = false
    const connect = async () => {
      try {
        const supabaseModule = await import('@/lib/supabaseClient')
        if (cancelled) return
        client = supabaseModule.supabase
        const refresh = () => {
          if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
          realtimeTimer.current = setTimeout(() => {
            void loadDashboard(true)
            if (selectedServerId) void loadHistory(selectedServerId, historyRange)
          }, 400)
        }
        channel = supabaseModule.supabase.channel('server-monitor-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'server_monitor_current' }, refresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'server_monitor_alerts' }, refresh)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'server_monitor_alert_events' }, refresh)
          .subscribe()
      } catch {
        // Focus and 30-second fallback refresh keep the dashboard useful.
      }
    }
    void connect()
    const fallback = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadDashboard(true)
    }, 30_000)
    const onFocus = () => void loadDashboard(true)
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(fallback)
      window.removeEventListener('focus', onFocus)
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
      if (channel && client) client.removeChannel(channel)
    }
  }, [historyRange, loadDashboard, loadHistory, selectedServerId])

  const server = data?.servers.find((item) => item.id === selectedServerId) || null
  const current = data?.current.find((item) => item.server_id === selectedServerId) || null
  const settings = data?.settings.find((item) => item.server_id === selectedServerId) || null
  const alerts = useMemo(
    () => data?.activeAlerts.filter((item) => item.server_id === selectedServerId) || [],
    [data?.activeAlerts, selectedServerId],
  )
  const events = data?.events.filter((item) => item.server_id === selectedServerId) || []
  const disks = parseDisks(current?.disks_data)
  const networkInterfaces = parseNetworks(current?.network_data)
  const activeNetworkInterfaces = networkInterfaces.filter((item) => item.status === 'up')

  const status = useMemo<HealthStatus>(() => {
    if (!server || !settings || !server.enabled || !server.last_seen_at) return 'offline'
    if (Date.now() - new Date(server.last_seen_at).getTime() > Number(settings.offline_timeout_seconds) * 1000) return 'offline'
    if (alerts.some((alert) => alert.severity === 'critical')) return 'critical'
    if (alerts.some((alert) => alert.severity === 'warning')) return 'warning'
    return 'healthy'
  }, [alerts, server, settings])

  const statusStyle = STATUS_STYLE[status]
  const cpuTemp = current ? Math.max(...[current.cpu_package_temp_c, current.cpu_core_max_temp_c].filter((value): value is number => value !== null), Number.NEGATIVE_INFINITY) : null
  const safeCpuTemp = cpuTemp !== null && Number.isFinite(cpuTemp) ? cpuTemp : null
  const cpuModel = asText(current?.cpu_data?.model)
  const cpuTemperatureSource = asText(current?.cpu_data?.temperatureSource)
  const cpuSensorErrors = Array.isArray(current?.cpu_data?.sensorErrors)
    ? current.cpu_data.sensorErrors.filter((value): value is string => typeof value === 'string')
    : []
  const memoryTotal = asNumber(current?.memory_data?.totalBytes)
  const memoryUsed = asNumber(current?.memory_data?.usedBytes)

  const chartData = useMemo(() => history.map((point) => ({
    time: formatChartTime(point.bucket_start, historyRange),
    cpu: roundMetric(asNumber(point.cpu_usage_pct)), ram: roundMetric(asNumber(point.memory_usage_pct)),
    cpuTemp: roundMetric(maxTemperature(asTemperature(point.cpu_package_temp_c), asTemperature(point.cpu_core_max_temp_c))),
    rx: roundMetric(asNumber(point.network_rx_bps) === null ? null : Number(point.network_rx_bps) * 8 / 1_000_000, 2),
    tx: roundMetric(asNumber(point.network_tx_bps) === null ? null : Number(point.network_tx_bps) * 8 / 1_000_000, 2),
    ping: roundMetric(asNumber(point.ping_ms)),
    ...Object.fromEntries(parseDisks(point.disks_data).flatMap((disk) => [
      [`diskFree:${disk.id}`, roundMetric(disk.freePercent, 2)], [`diskTemp:${disk.id}`, roundMetric(disk.temperatureC)],
    ])),
  })), [history, historyRange])

  async function mutate(payload: Record<string, unknown>) {
    const response = await fetch('/api/system/server-monitor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => null) as { error?: string; agentKey?: string }
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
    return body
  }

  function openSettings() {
    if (!settings) return
    setSettingsForm(settingsToForm(settings))
    setSettingsOpen(true)
  }

  async function saveSettings() {
    if (!server || !settingsForm) return
    setSaving(true)
    try {
      await mutate({ action: 'updateSettings', serverId: server.id, ...settingsForm })
      setSettingsOpen(false)
      await loadDashboard(true)
      toast({ title: 'Настройки сохранены' })
    } catch (saveError) {
      toast({ title: 'Не удалось сохранить', description: saveError instanceof Error ? saveError.message : 'Ошибка', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  async function createServer() {
    setSaving(true)
    try {
      const result = await mutate({
        action: 'createServer', code: createForm.code.trim().toLowerCase(), name: createForm.name.trim(),
        hostname: createForm.hostname.trim() || null, description: createForm.description.trim() || null,
        companyId: createForm.companyId || null,
      })
      setOneTimeKey(result.agentKey || '')
      setCreateOpen(false)
      setCredentialOpen(true)
      setCreateForm({ code: '', name: '', hostname: '', description: '', companyId: '' })
      await loadDashboard(true)
    } catch (createError) {
      toast({ title: 'Не удалось создать сервер', description: createError instanceof Error ? createError.message : 'Ошибка', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  async function rotateKey() {
    if (!server || !confirm('Создать новый ключ? Текущий ключ агента будет отозван.')) return
    setSaving(true)
    try {
      const result = await mutate({ action: 'rotateKey', serverId: server.id })
      setOneTimeKey(result.agentKey || '')
      setCredentialOpen(true)
      await loadDashboard(true)
    } catch (rotateError) {
      toast({ title: 'Ротация не выполнена', description: rotateError instanceof Error ? rotateError.message : 'Ошибка', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  async function testTelegram() {
    if (!server) return
    setSaving(true)
    try {
      await mutate({ action: 'testTelegram', serverId: server.id })
      toast({ title: 'Тест поставлен в очередь', description: 'Проверьте канал мониторинга.' })
    } catch (testError) {
      toast({ title: 'Тест не отправлен', description: testError instanceof Error ? testError.message : 'Ошибка', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  if (loading) {
    return <div className="app-page-wide space-y-6"><div className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-white/5" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-48 animate-pulse rounded-2xl bg-slate-200 dark:bg-white/5" />)}</div></div>
  }

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Мониторинг сервера"
        description="Windows Server 2019 · телеметрия и аварийные события"
        icon={<Activity className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        actions={<>
          {data && data.servers.length > 1 ? (
            <select value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
              {data.servers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          ) : null}
          <Button variant="outline" size="icon" onClick={() => void loadDashboard(true)} disabled={refreshing} title="Обновить">
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </Button>
          {data?.permissions.manageCredentials ? <Button variant="outline" onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Сервер</Button> : null}
          {server && can('server-monitor.edit_settings') ? <Button onClick={openSettings} className="gap-2"><Settings2 className="h-4 w-4" /> Настройки</Button> : null}
        </>}
      />

      {error ? <Card className="border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-200">{error}</Card> : null}

      {!server ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card/50 px-6 text-center">
          <Server className="h-10 w-10 text-muted-foreground" />
          <div><h2 className="font-semibold">Серверы не подключены</h2><p className="mt-1 text-sm text-muted-foreground">Создайте запись и установите агент с выданным ключом.</p></div>
          {data?.permissions.manageCredentials ? <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Добавить сервер</Button> : null}
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-4 border-y border-border py-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-border bg-card"><Server className="h-6 w-6 text-emerald-500" /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-semibold">{server.name}</h2><span className={cn('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold', statusStyle.badge)}><span className={cn('h-2 w-2 rounded-full', statusStyle.dot)} />{statusStyle.label}</span></div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{current?.hostname || server.hostname || server.code} · {current?.windows_version || 'Ожидание первой телеметрии'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div><span className="block text-xs text-muted-foreground">Последнее обновление</span><b>{formatDateTime(server.last_seen_at)}</b></div>
              <div><span className="block text-xs text-muted-foreground">Uptime</span><b>{formatUptime(current?.uptime_seconds ?? null)}</b></div>
              <div className="col-span-2 sm:col-span-1"><span className="block text-xs text-muted-foreground">Agent</span><b>{server.last_agent_version || '—'}</b></div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="gap-4 p-5">
              <div className="flex items-center justify-between"><span className="text-sm font-medium text-muted-foreground">CPU</span><Cpu className="h-5 w-5 text-sky-500" /></div>
              <div><div className="text-2xl font-semibold">{percent(current?.cpu_usage_pct ?? null)}</div><p className="truncate text-xs text-muted-foreground">{cpuModel || 'Модель CPU не получена'}</p></div>
              <MetricBar value={current?.cpu_usage_pct ?? null} tone={settings ? toneFor(current?.cpu_usage_pct ?? null, Number(settings.cpu_usage_warning_pct), Number(settings.cpu_usage_critical_pct)) : 'emerald'} />
              <div className="space-y-1"><div className="flex items-center gap-2 text-sm"><Thermometer className="h-4 w-4 text-amber-500" /><span>{temperature(safeCpuTemp)}</span></div><p className="truncate text-xs text-muted-foreground" title={cpuSensorErrors.join('\n')}>{cpuTemperatureSource || (cpuSensorErrors.length ? 'Датчик недоступен на этом оборудовании' : 'Источник датчика не получен')}</p></div>
            </Card>
            <Card className="gap-4 p-5">
              <div className="flex items-center justify-between"><span className="text-sm font-medium text-muted-foreground">RAM</span><MemoryStick className="h-5 w-5 text-fuchsia-500" /></div>
              <div><div className="text-2xl font-semibold">{percent(current?.memory_usage_pct ?? null)}</div><p className="text-xs text-muted-foreground">{formatBytes(memoryUsed)} / {formatBytes(memoryTotal)}</p></div>
              <MetricBar value={current?.memory_usage_pct ?? null} tone={settings ? toneFor(current?.memory_usage_pct ?? null, Number(settings.ram_usage_warning_pct), Number(settings.ram_usage_critical_pct)) : 'emerald'} />
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Database className="h-4 w-4" />{memoryTotal ? `${(memoryTotal / 1024 ** 3).toFixed(1)} GB всего` : 'Нет данных'}</div>
            </Card>
            <Card className="gap-4 p-5 md:col-span-2 xl:col-span-1">
              <div className="flex items-center justify-between"><span className="text-sm font-medium text-muted-foreground">STORAGE</span><HardDrive className="h-5 w-5 text-amber-500" /></div>
              <div className="max-h-28 space-y-3 overflow-y-auto pr-1">
                {disks.length ? disks.map((disk) => <div key={disk.id}><div className="mb-1 flex justify-between gap-2 text-sm"><b>{disk.driveLetter || disk.name}</b><span>{percent(disk.freePercent)} свободно</span></div><MetricBar value={100 - disk.freePercent} tone={settings ? toneFor(disk.freePercent, Number(settings.disk_free_warning_pct), Number(settings.disk_free_critical_pct), 'low') : 'emerald'} /><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span title={[disk.temperatureSource, disk.temperatureSensor].filter(Boolean).join(' · ')}>{temperature(disk.temperatureC)}</span><span>{disk.health || disk.operationalStatus || 'Health недоступен'}</span>{disk.mediaType || disk.busType ? <span>{[disk.mediaType, disk.busType].filter(Boolean).join(' · ')}</span> : null}{disk.wearPercent !== null ? <span>Износ {percent(disk.wearPercent)}</span> : null}</div></div>) : <p className="text-sm text-muted-foreground">Диски не получены</p>}
              </div>
              <p className="text-xs text-muted-foreground">{disks.length} томов · {formatBytes(disks.reduce((sum, disk) => sum + disk.totalBytes, 0))}</p>
            </Card>
            <Card className="gap-4 p-5">
              <div className="flex items-center justify-between"><span className="text-sm font-medium text-muted-foreground">NETWORK</span>{current?.internet_connected ? <Wifi className="h-5 w-5 text-emerald-500" /> : <WifiOff className="h-5 w-5 text-rose-500" />}</div>
              <div><div className="text-2xl font-semibold">{current?.internet_connected === true ? 'ONLINE' : current?.internet_connected === false ? 'OFFLINE' : '—'}</div><p className="text-xs text-muted-foreground">Ping {current?.ping_ms === null || current?.ping_ms === undefined ? '—' : `${Number(current.ping_ms).toFixed(0)} ms`}</p></div>
              <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-slate-100 p-2 dark:bg-white/5"><span className="block text-xs text-muted-foreground">RX</span><b>{formatBytes(current?.network_rx_bps ?? null, true)}</b></div><div className="rounded-lg bg-slate-100 p-2 dark:bg-white/5"><span className="block text-xs text-muted-foreground">TX</span><b>{formatBytes(current?.network_tx_bps ?? null, true)}</b></div></div>
              <p className="truncate text-xs text-muted-foreground" title={activeNetworkInterfaces.flatMap((item) => item.ipAddresses).join(', ')}>{activeNetworkInterfaces.length} активных · линк {formatBitsPerSecond(activeNetworkInterfaces.reduce<number | null>((fastest, item) => item.linkSpeedBps !== null && (fastest === null || item.linkSpeedBps > fastest) ? item.linkSpeedBps : fastest, null))}</p>
            </Card>
          </section>

          <section className="relative z-10 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">История метрик</h2><p className="text-sm text-muted-foreground">{history.length} агрегированных точек</p></div><div className="inline-flex rounded-lg border border-border bg-card p-1">{(['1h', '6h', '24h', '7d', '30d'] as HistoryRange[]).map((range) => <button key={range} type="button" onClick={() => setHistoryRange(range)} className={cn('min-w-12 rounded-md px-3 py-1.5 text-xs font-medium', historyRange === range ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{range}</button>)}</div></div>
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="gap-3 overflow-visible p-4"><h3 className="text-sm font-semibold">CPU, RAM и температура</h3><div className="h-64">{historyLoading ? <div className="h-full animate-pulse rounded-lg bg-slate-100 dark:bg-white/5" /> : <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} /><YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 10 }} /><YAxis yAxisId="temp" orientation="right" domain={[0, 110]} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => formatChartValue(value, 1)} wrapperStyle={{ zIndex: 50 }} /><Legend /><Line yAxisId="pct" type="monotone" dataKey="cpu" name="CPU %" stroke="#38bdf8" dot={false} /><Line yAxisId="pct" type="monotone" dataKey="ram" name="RAM %" stroke="#e879f9" dot={false} /><Line yAxisId="temp" type="monotone" dataKey="cpuTemp" name="CPU °C" stroke="#f59e0b" dot={false} connectNulls={false} /></LineChart></ResponsiveContainer>}</div></Card>
              <Card className="gap-3 overflow-visible p-4"><h3 className="text-sm font-semibold">Диски</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} /><YAxis yAxisId="free" domain={[0, 100]} tick={{ fontSize: 10 }} /><YAxis yAxisId="temp" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip filterNull={false} formatter={(value) => formatChartValue(value, 2)} wrapperStyle={{ zIndex: 50 }} />{disks.flatMap((disk, index) => { const color = CHART_COLORS[index % CHART_COLORS.length]; return [<Line key={`free:${disk.id}`} yAxisId="free" type="monotone" dataKey={`diskFree:${disk.id}`} name={`${disk.driveLetter || disk.name}: свободно %`} stroke={color} dot={false} connectNulls />, <Line key={`temp:${disk.id}`} yAxisId="temp" type="monotone" dataKey={`diskTemp:${disk.id}`} name={`${disk.driveLetter || disk.name}: °C`} stroke={color} strokeDasharray="4 3" dot={false} connectNulls={false} />] })}</LineChart></ResponsiveContainer></div></Card>
              <Card className="gap-3 overflow-visible p-4"><h3 className="text-sm font-semibold">Сеть</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} /><YAxis yAxisId="traffic" tick={{ fontSize: 10 }} /><YAxis yAxisId="ping" orientation="right" tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => formatChartValue(value, 2)} wrapperStyle={{ zIndex: 50 }} /><Legend /><Line yAxisId="traffic" type="monotone" dataKey="rx" name="RX Mbps" stroke="#10b981" dot={false} /><Line yAxisId="traffic" type="monotone" dataKey="tx" name="TX Mbps" stroke="#38bdf8" dot={false} /><Line yAxisId="ping" type="monotone" dataKey="ping" name="Ping ms" stroke="#f59e0b" dot={false} /></LineChart></ResponsiveContainer></div></Card>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-3"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" /><h2 className="text-lg font-semibold">Активные проблемы</h2><span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-white/10">{alerts.length}</span></div>{alerts.length ? alerts.map((alert) => <div key={alert.id} className={cn('flex items-start justify-between gap-3 rounded-lg border p-4', alert.severity === 'critical' ? 'border-rose-500/30 bg-rose-500/10' : 'border-amber-500/30 bg-amber-500/10')}><div><p className="font-medium">{alert.title}</p><p className="mt-1 text-xs text-muted-foreground">С {formatDateTime(alert.started_at)}</p></div><b>{alert.current_value === null ? '—' : `${Number(alert.current_value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}${alert.value_unit || ''}`}</b></div>) : <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-300"><Check className="h-5 w-5" />Активных проблем нет</div>}</div>
            <div className="space-y-3"><div className="flex items-center gap-2"><CircleGauge className="h-5 w-5 text-sky-500" /><h2 className="text-lg font-semibold">История событий</h2></div><AdminTableViewport maxHeight="24rem"><table className="w-full min-w-[680px] text-sm"><thead className={adminTableStickyTheadClass}><tr><th className="px-4 py-3 text-left">Время</th><th className="px-4 py-3 text-left">Статус</th><th className="px-4 py-3 text-left">Событие</th><th className="px-4 py-3 text-right">Значение</th></tr></thead><tbody className="divide-y divide-border">{events.map((event) => <tr key={event.id}><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(event.occurred_at)}</td><td className="px-4 py-3"><span className={cn('rounded-full px-2 py-1 text-xs font-medium', event.severity === 'critical' ? 'bg-rose-500/10 text-rose-600' : event.severity === 'warning' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600')}>{event.severity.toUpperCase()}</span></td><td className="px-4 py-3"><b>{event.title}</b><span className="ml-2 text-xs text-muted-foreground">{event.transition}</span></td><td className="px-4 py-3 text-right font-medium">{event.value === null ? '—' : `${Number(event.value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}${event.value_unit || ''}`}</td></tr>)}{events.length === 0 ? <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Событий пока нет</td></tr> : null}</tbody></table></AdminTableViewport></div>
          </section>
        </>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Настройки мониторинга</DialogTitle><DialogDescription>{server?.name}</DialogDescription></DialogHeader>{settingsForm ? <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
        ['CPU temp warning', 'cpuTempWarningC'], ['CPU temp critical', 'cpuTempCriticalC'], ['CPU load warning', 'cpuUsageWarningPct'], ['CPU load critical', 'cpuUsageCriticalPct'], ['RAM warning', 'ramUsageWarningPct'], ['RAM critical', 'ramUsageCriticalPct'], ['Disk temp warning', 'diskTempWarningC'], ['Disk temp critical', 'diskTempCriticalC'], ['Disk free warning', 'diskFreeWarningPct'], ['Disk free critical', 'diskFreeCriticalPct'], ['Offline, секунд', 'offlineTimeoutSeconds'], ['Recovery samples', 'recoverySamples'],
      ].map(([label, key]) => <div key={key} className="space-y-1.5"><Label htmlFor={key}>{label}</Label><Input id={key} type="number" value={settingsForm[key as keyof SettingsForm] as number} onChange={(event) => setSettingsForm({ ...settingsForm, [key]: Number(event.target.value) })} /></div>)}</div><div className="grid gap-3 sm:grid-cols-2"><ToggleRow label="Telegram" checked={settingsForm.telegramEnabled} onChange={(value) => setSettingsForm({ ...settingsForm, telegramEnabled: value })} icon={<Bell className="h-4 w-4" />} /><ToggleRow label="Warning" checked={settingsForm.notifyWarning} onChange={(value) => setSettingsForm({ ...settingsForm, notifyWarning: value })} /><ToggleRow label="Critical" checked={settingsForm.notifyCritical} onChange={(value) => setSettingsForm({ ...settingsForm, notifyCritical: value })} /><ToggleRow label="Recovery" checked={settingsForm.notifyRecovery} onChange={(value) => setSettingsForm({ ...settingsForm, notifyRecovery: value })} /></div><div className="flex flex-wrap gap-2 border-t border-border pt-4">{data?.telegramConfigured && can('server-monitor.test_notifications') ? <Button variant="outline" onClick={() => void testTelegram()} disabled={saving} className="gap-2"><Bell className="h-4 w-4" /> Тест Telegram</Button> : null}{data?.permissions.manageCredentials ? <Button variant="outline" onClick={() => void rotateKey()} disabled={saving} className="gap-2"><KeyRound className="h-4 w-4" /> Новый ключ</Button> : null}</div></div> : null}<DialogFooter><Button variant="outline" onClick={() => setSettingsOpen(false)}>Отмена</Button><Button onClick={() => void saveSettings()} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>Новый сервер</DialogTitle><DialogDescription>Запись мониторинга для текущей организации</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="monitor-code">Код</Label><Input id="monitor-code" value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} placeholder="f16-server" /></div><div className="space-y-1.5"><Label htmlFor="monitor-name">Название</Label><Input id="monitor-name" value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="F16 SERVER" /></div><div className="space-y-1.5"><Label htmlFor="monitor-host">Hostname</Label><Input id="monitor-host" value={createForm.hostname} onChange={(event) => setCreateForm({ ...createForm, hostname: event.target.value })} placeholder="F16-SERVER" /></div><div className="space-y-1.5"><Label htmlFor="monitor-company">Точка</Label><select id="monitor-company" value={createForm.companyId} onChange={(event) => setCreateForm({ ...createForm, companyId: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Без привязки</option>{data?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="monitor-description">Описание</Label><Input id="monitor-description" value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button><Button onClick={() => void createServer()} disabled={saving || !createForm.code.trim() || !createForm.name.trim()}>{saving ? 'Создание…' : 'Создать'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={credentialOpen} onOpenChange={(open) => { setCredentialOpen(open); if (!open) setOneTimeKey('') }}><DialogContent><DialogHeader><DialogTitle>Ключ агента</DialogTitle><DialogDescription>Ключ показывается только сейчас.</DialogDescription></DialogHeader><div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300"><ShieldCheck className="h-4 w-4" /> ORDA_MONITOR_AGENT_KEY</div><code className="block break-all text-xs">{oneTimeKey}</code></div><DialogFooter><Button onClick={async () => { await navigator.clipboard.writeText(oneTimeKey); toast({ title: 'Ключ скопирован' }) }} className="gap-2"><Copy className="h-4 w-4" /> Копировать</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}

function ToggleRow({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (value: boolean) => void; icon?: React.ReactNode }) {
  return <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"><Label className="flex items-center gap-2">{icon}{label}</Label><Switch checked={checked} onCheckedChange={onChange} /></div>
}
