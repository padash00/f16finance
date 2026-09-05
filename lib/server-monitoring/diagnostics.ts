type UnknownRecord = Record<string, unknown>

const NETWORK_VERDICT_LABELS: Record<string, string> = {
  healthy: 'Сеть и ORDA доступны',
  gateway_unreachable: 'Не отвечает сетевой шлюз',
  dns_failure: 'DNS не разрешает адрес ORDA',
  internet_unreachable: 'Нет выхода в интернет',
  endpoint_unreachable: 'Сайт ORDA недоступен по HTTPS',
  unknown: 'Причина сети не определена',
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function numeric(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function probeStatus(value: unknown): string {
  const probe = record(value)
  if (probe?.reachable === true) return 'доступен'
  if (probe?.reachable === false) return 'недоступен'
  return 'нет данных'
}

function processLines(context: UnknownRecord, limit: number): string[] {
  if (!Array.isArray(context.topProcesses)) return []
  return context.topProcesses.slice(0, limit).flatMap((value) => {
    const process = record(value)
    if (!process || typeof process.name !== 'string') return []
    const cpu = numeric(process.cpuPercent)
    const memory = numeric(process.workingSetBytes)
    const pid = numeric(process.pid)
    if (cpu === null || memory === null || pid === null) return []
    const cpuText = cpu.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
    const memoryMb = Math.round(memory / 1024 / 1024).toLocaleString('ru-RU')
    return [`${process.name}: ${cpuText}% CPU, ${memoryMb} МБ RAM, PID ${pid}`]
  })
}

function networkLines(context: UnknownRecord): string[] {
  const diagnostics = record(context.networkDiagnostics)
  if (!diagnostics) return []
  const verdict = String(diagnostics.verdict || 'unknown')
  return [
    `Причина: ${NETWORK_VERDICT_LABELS[verdict] || NETWORK_VERDICT_LABELS.unknown}`,
    `Шлюз: ${probeStatus(diagnostics.gateway)} · IP: ${probeStatus(diagnostics.external)} · DNS: ${probeStatus(diagnostics.dns)} · ORDA HTTPS: ${probeStatus(diagnostics.https)}`,
  ]
}

export function getMonitorDiagnosticLines(context: unknown, processLimit = 3): string[] {
  const safeContext = record(context)
  if (!safeContext) return []
  const processes = processLines(safeContext, Math.max(1, Math.min(5, processLimit)))
  return processes.length ? processes : networkLines(safeContext)
}

export function getMonitorDiagnosticSummary(context: unknown): string | null {
  const lines = getMonitorDiagnosticLines(context, 2)
  return lines.length ? lines.join(' · ') : null
}
