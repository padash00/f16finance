import type { KioskConfig, ClientSession, Tariff, StationTheme, Game } from '@/types'

const TIMEOUT_MS = 15_000

async function request<T>(
  cfg: KioskConfig,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const url = `${cfg.serverBaseUrl}/api/kiosk${path}`
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-kiosk-secret': cfg.clientSecret,
        'x-kiosk-device-token': cfg.deviceToken,
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    clearTimeout(tid)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    return data as T
  } catch (err) {
    clearTimeout(tid)
    throw err
  }
}

function authed(cfg: KioskConfig, clientToken: string) {
  return <T>(method: string, path: string, body?: unknown) =>
    request<T>(cfg, method, path, body, { 'x-kiosk-client-token': clientToken })
}

// ── Тема станции ─────────────────────────────────────────────────────────────
export async function fetchTheme(cfg: KioskConfig): Promise<StationTheme> {
  return request(cfg, 'GET', '/theme')
}

// ── Каталог игр ───────────────────────────────────────────────────────────────
export async function fetchCatalog(cfg: KioskConfig): Promise<Game[]> {
  return request(cfg, 'GET', '/catalog')
}

// ── Тарифы ───────────────────────────────────────────────────────────────────
export async function fetchTariffs(cfg: KioskConfig): Promise<Tariff[]> {
  return request(cfg, 'GET', '/tariffs')
}

// ── Авторизация клиента ───────────────────────────────────────────────────────
export async function clientLogin(
  cfg: KioskConfig,
  username: string,
  password: string,
): Promise<{ token: string; client: ClientSession }> {
  return request(cfg, 'POST', '/client/login', { username, password })
}

// ── Профиль ───────────────────────────────────────────────────────────────────
export async function fetchProfile(cfg: KioskConfig, clientToken: string): Promise<ClientSession> {
  const req = authed(cfg, clientToken)
  return req<ClientSession>('GET', '/client/profile')
}

export async function updateProfile(
  cfg: KioskConfig,
  clientToken: string,
  data: { displayName?: string; avatarUrl?: string },
): Promise<{ ok: boolean }> {
  const req = authed(cfg, clientToken)
  return req<{ ok: boolean }>('PATCH', '/client/profile', data)
}

export async function changePassword(
  cfg: KioskConfig,
  clientToken: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean }> {
  const req = authed(cfg, clientToken)
  return req<{ ok: boolean }>('POST', '/client/change-password', { oldPassword, newPassword })
}

// ── Покупка тарифа ────────────────────────────────────────────────────────────
export async function buyTariff(
  cfg: KioskConfig,
  clientToken: string,
  tariffId: string,
): Promise<{ ok: boolean; sessionId: string; durationMin: number; endsAt: string; newBalance: number; error?: string }> {
  const req = authed(cfg, clientToken)
  return req<{ ok: boolean; sessionId: string; durationMin: number; endsAt: string; newBalance: number; error?: string }>('POST', '/client/buy-tariff', { tariffId })
}
