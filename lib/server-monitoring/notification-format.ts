import { getMonitorDiagnosticLines } from '@/lib/server-monitoring/diagnostics'

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatValue(value: unknown, unit: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string') return 'нет данных'
  const parsed = Number(value)
  const rendered = Number.isFinite(parsed) ? parsed.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : String(value)
  return `${rendered}${escapeHtml(unit)}`
}

function formatDuration(seconds: unknown): string | null {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return null
  const minutes = Math.floor(value / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days} д ${hours % 24} ч ${minutes % 60} мин`
  if (hours > 0) return `${hours} ч ${minutes % 60} мин`
  return `${minutes} мин`
}

export function formatMonitorTelegramMessage(payload: Record<string, unknown>): string {
  const severity = String(payload.severity || '')
  const transition = String(payload.transition || '')
  const recovered = severity === 'recovered'
  const offline = transition === 'offline'
  const online = transition === 'online'
  const label = recovered || online ? '🟢 RECOVERED' : severity === 'critical' || offline ? '🔴 CRITICAL' : '🟠 WARNING'
  const server = escapeHtml(payload.serverName || payload.hostname || 'Windows Server')
  const hostname = payload.hostname && payload.hostname !== payload.serverName ? ` (${escapeHtml(payload.hostname)})` : ''
  const occurredAt = payload.occurredAt ? new Date(String(payload.occurredAt)).toLocaleString('ru-RU', { timeZone: 'Asia/Qyzylorda' }) : ''
  const duration = formatDuration(payload.durationSeconds)

  const lines = [
    `<b>${label}</b>`,
    '',
    `<b>ORDA SERVER</b>`,
    `Сервер: <b>${server}${hostname}</b>`,
    `${escapeHtml(payload.title)}: <b>${formatValue(payload.value, payload.unit)}</b>`,
  ]
  if (!recovered && payload.threshold !== null && payload.threshold !== undefined) {
    lines.push(`Порог: ${formatValue(payload.threshold, payload.unit)}`)
  }
  if (!recovered && !online) {
    const diagnostics = getMonitorDiagnosticLines(payload.context)
    if (diagnostics.length) lines.push('', '<b>Диагностика</b>', ...diagnostics.map(escapeHtml))
  }
  if (recovered || online) lines.push('', escapeHtml(payload.message || 'Показатель вернулся в норму.'))
  if (duration) lines.push(`Длительность: ${duration}`)
  if (occurredAt) lines.push('', occurredAt)
  return lines.join('\n')
}
