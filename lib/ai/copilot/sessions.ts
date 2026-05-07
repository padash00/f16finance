/**
 * Conversational sessions для AI Copilot.
 *
 * Хранятся в памяти процесса (Map). Этого достаточно для MVP —
 * Vercel держит warm-instance долго, и сессия не должна жить дольше
 * 30 минут активности. Если процесс перезапустится — пользователь
 * просто начнёт диалог заново.
 *
 * Если потребуется persistence — заменим на Supabase table
 * `copilot_sessions` (структура та же).
 */

import type { CopilotSession } from './types'

const SESSIONS = new Map<string, CopilotSession>()
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 минут

function sessionKey(userId: string, telegramChatId?: number): string {
  return telegramChatId != null ? `tg:${telegramChatId}` : `user:${userId}`
}

export function getOrCreateSession(userId: string, telegramChatId?: number): CopilotSession {
  const key = sessionKey(userId, telegramChatId)
  const existing = SESSIONS.get(key)
  const now = Date.now()
  if (existing && now - existing.updatedAt < SESSION_TTL_MS) {
    existing.updatedAt = now
    return existing
  }
  const session: CopilotSession = {
    sessionId: key,
    userId,
    telegramChatId,
    activeTool: null,
    collectedParams: {},
    awaitingParam: null,
    history: [],
    createdAt: now,
    updatedAt: now,
  }
  SESSIONS.set(key, session)
  return session
}

export function clearSession(userId: string, telegramChatId?: number): void {
  SESSIONS.delete(sessionKey(userId, telegramChatId))
}

export function startTool(session: CopilotSession, toolName: string): void {
  session.activeTool = toolName
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
 * Проактивная очистка устаревших сессий. Вызывается из engine
 * перед обработкой нового запроса (lazy cleanup).
 */
export function cleanupExpiredSessions(): void {
  const now = Date.now()
  for (const [key, session] of SESSIONS) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      SESSIONS.delete(key)
    }
  }
}

export function getSessionsCount(): number {
  return SESSIONS.size
}
