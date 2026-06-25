/**
 * Conversational sessions для AI Copilot.
 *
 * ДВУХУРОВНЕВОЕ хранение:
 *   L1 — Map в памяти процесса (быстро, для тёплого инстанса).
 *   L2 — таблица Supabase `copilot_sessions` (источник правды, переживает
 *        смену serverless-инстанса). Сессия хранится целиком как JSONB.
 *
 * Почему L2: на Vercel соседние HTTP-запросы могут попасть на разные инстансы.
 * Без БД многошаговое действие (выдай аванс → выбери → подтверди) теряло
 * состояние между запросами → «Сессия устарела». Теперь состояние читается из
 * БД при промахе кэша и пишется обратно после каждого запроса.
 *
 * getOrCreateSession / saveSession / clearSession — АСИНХРОННЫЕ (ходят в БД).
 * Мутаторы (startTool/setParam/...) — синхронные, меняют объект; реальная
 * запись в БД происходит через saveSession в конце обработки запроса.
 */

import type { CopilotSession } from './types'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const SESSIONS = new Map<string, CopilotSession>()
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 минут — общий TTL для history контекста
const ACTIVE_DIALOG_TTL_MS = 10 * 60 * 1000 // 10 минут — для активного сбора параметров
const TABLE = 'copilot_sessions'

function sessionKey(userId: string, telegramChatId?: number): string {
  return telegramChatId != null ? `tg:${telegramChatId}` : `user:${userId}`
}

function isFresh(session: CopilotSession, now: number): boolean {
  const age = now - session.updatedAt
  const inActiveDialog = !!(session.activeTool && session.awaitingParam)
  return age < (inActiveDialog ? ACTIVE_DIALOG_TTL_MS : SESSION_TTL_MS)
}

function newSession(key: string, userId: string, telegramChatId: number | undefined, now: number): CopilotSession {
  return {
    sessionId: key,
    userId,
    telegramChatId,
    activeTool: null,
    collectedParams: {},
    awaitingParam: null,
    pendingOptions: {},
    history: [],
    createdAt: now,
    updatedAt: now,
  }
}

let adminClient: ReturnType<typeof createAdminSupabaseClient> | null = null
function admin() {
  if (!hasAdminSupabaseCredentials()) return null
  if (!adminClient) adminClient = createAdminSupabaseClient()
  return adminClient
}

async function loadFromDb(key: string, now: number): Promise<CopilotSession | null> {
  const db = admin()
  if (!db) return null
  try {
    const { data } = await db.from(TABLE).select('data').eq('session_key', key).maybeSingle()
    const session = (data?.data || null) as CopilotSession | null
    if (session && isFresh(session, now)) return session
  } catch { /* таблицы может не быть — деградируем до in-memory */ }
  return null
}

/**
 * Загружает сессию (L1 кэш → БД → новая). Асинхронная.
 */
export async function getOrCreateSession(userId: string, telegramChatId?: number): Promise<CopilotSession> {
  const key = sessionKey(userId, telegramChatId)
  const now = Date.now()

  const cached = SESSIONS.get(key)
  if (cached && isFresh(cached, now)) {
    cached.updatedAt = now
    return cached
  }

  const fromDb = await loadFromDb(key, now)
  if (fromDb) {
    fromDb.updatedAt = now
    SESSIONS.set(key, fromDb)
    return fromDb
  }

  const session = newSession(key, userId, telegramChatId, now)
  SESSIONS.set(key, session)
  return session
}

/**
 * Пишет сессию в БД (write-through). Вызывать в конце обработки запроса.
 * Без admin-кредов работает только in-memory (L1) — деградация, не ошибка.
 */
export async function saveSession(session: CopilotSession): Promise<void> {
  SESSIONS.set(session.sessionId, session)
  const db = admin()
  if (!db) return
  try {
    await db.from(TABLE).upsert(
      { session_key: session.sessionId, data: session, updated_at: new Date().toISOString() },
      { onConflict: 'session_key' },
    )
  } catch { /* не критично — L1 кэш уже обновлён */ }
}

export async function clearSession(userId: string, telegramChatId?: number): Promise<void> {
  const key = sessionKey(userId, telegramChatId)
  SESSIONS.delete(key)
  const db = admin()
  if (!db) return
  try { await db.from(TABLE).delete().eq('session_key', key) } catch { /* ignore */ }
}

export function startTool(session: CopilotSession, toolName: string): void {
  session.activeTool = toolName
  session.collectedParams = {}
  session.awaitingParam = null
  session.pendingOptions = {}
  session.updatedAt = Date.now()
}

/**
 * Сбросить состояние tool (после выполнения) НО сохранить историю диалога —
 * чтобы AI помнил предыдущие действия в этой сессии для multi-step.
 */
export function resetToolState(session: CopilotSession): void {
  session.activeTool = null
  session.collectedParams = {}
  session.awaitingParam = null
  session.pendingOptions = {}
  session.updatedAt = Date.now()
}

export function setParam(session: CopilotSession, paramName: string, value: unknown): void {
  session.collectedParams[paramName] = value
  if (session.awaitingParam === paramName) session.awaitingParam = null
  session.updatedAt = Date.now()
}

export function awaitParam(session: CopilotSession, paramName: string): void {
  session.awaitingParam = paramName
  session.updatedAt = Date.now()
}

export function pushHistory(session: CopilotSession, role: 'user' | 'assistant', content: string): void {
  session.history.push({ role, content, ts: Date.now() })
  // Держим только последние 20 сообщений
  if (session.history.length > 20) session.history = session.history.slice(-20)
  session.updatedAt = Date.now()
}

/**
 * Проактивная очистка устаревших сессий из L1-кэша (in-memory).
 * БД-строки чистятся по TTL при загрузке (стейл игнорируется) — отдельный
 * cleanup не критичен.
 */
export function cleanupExpiredSessions(): void {
  const now = Date.now()
  for (const [key, session] of SESSIONS) {
    if (!isFresh(session, now)) SESSIONS.delete(key)
  }
}

export function getSessionsCount(): number {
  return SESSIONS.size
}
