import { supabase } from './supabase'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://ordaops.kz'

/** Активная организация (для мультиорг-владельцев). Прокидывается как x-organization-id. */
let activeOrganizationId: string | null = null
export function setActiveOrganization(orgId: string | null) {
  activeOrganizationId = orgId
}
export function getActiveOrganization() {
  return activeOrganizationId
}

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Запрос к Next.js API с авторизацией текущей Supabase-сессией.
 * Сервер читает Authorization: Bearer <access_token> (getRequestAccessContext)
 * и x-organization-id для выбора активной орг.
 */
export async function apiFetch<T = any>(path: string, init: RequestInit = {}, _retried = false): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (activeOrganizationId) headers['x-organization-id'] = activeOrganizationId
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, { ...init, headers })

  // Самолечение протухшего токена: при 401 один раз форсим refresh и повторяем.
  if (res.status === 401 && !_retried && token) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed?.session?.access_token) return apiFetch<T>(path, init, true)
    } catch {
      /* refresh не удался — отдадим исходную 401 ниже */
    }
  }

  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* пустой/не-JSON ответ */
  }

  if (!res.ok) {
    throw new ApiError(json?.error || json?.message || `Ошибка ${res.status}`, res.status, json?.code)
  }
  return json as T
}
