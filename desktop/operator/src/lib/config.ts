import type { AppConfig } from '@/types'

const ipc = window.electron

export async function loadConfig(): Promise<AppConfig | null> {
  const raw = await ipc.config.get()
  if (raw?.apiUrl && raw?.deviceToken) {
    return raw as unknown as AppConfig
  }
  return null
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ipc.config.set(config as unknown as Record<string, unknown>)
}

export const DEFAULT_API_URL = 'https://ordaops.kz'
