/**
 * Public API библиотеки Copilot.
 *
 * Использование:
 *   import { runCopilotForTelegram, runCopilotForWeb } from '@/lib/ai/copilot'
 */

import 'server-only'

import { initializeCopilotTools } from './tools'
import { runCopilot, handleCallback } from './engine'
import { copilotResponseToTelegram } from './adapters/telegram'
import { loadUserCapabilities } from '@/lib/server/capabilities'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import type { CopilotContext, CopilotResponse } from './types'

// Lazy initialization (один раз на процесс)
initializeCopilotTools()

export type TelegramCopilotInput = {
  /** ID пользователя в нашей БД (auth.users.id если staff, иначе operator.id) */
  userId: string
  /** Роль для capability check */
  role: string | null
  /** Является ли super-admin */
  isSuperAdmin: boolean
  /** Активная организация */
  organizationId?: string | null
  /** Telegram chat_id */
  chatId: number
  /** Текст сообщения от пользователя ИЛИ callback_data от inline-кнопки */
  text?: string
  callbackData?: string
}

/**
 * Запустить Copilot для Telegram.
 * Вернёт payload готовый для sendMessage / answerCallbackQuery.
 */
export async function runCopilotForTelegram(input: TelegramCopilotInput): Promise<{
  text: string
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
}> {
  const ctx = await buildContext({
    userId: input.userId,
    role: input.role,
    isSuperAdmin: input.isSuperAdmin,
    organizationId: input.organizationId,
    source: 'telegram',
    telegramChatId: input.chatId,
  })

  let response: CopilotResponse
  if (input.callbackData) {
    response = await handleCallback(input.callbackData, ctx)
  } else if (input.text) {
    response = await runCopilot(input.text, ctx)
  } else {
    response = { text: 'Не получил ввод.' }
  }

  return copilotResponseToTelegram(response)
}

export type WebCopilotInput = {
  userId: string
  role: string | null
  isSuperAdmin: boolean
  organizationId?: string | null
  text?: string
  callbackData?: string
  currentPath?: string
}

/**
 * Запустить Copilot для веб-ассистента. Возвращает структурированный ответ
 * который React-компонент может отрендерить с кнопками.
 */
export async function runCopilotForWeb(input: WebCopilotInput): Promise<CopilotResponse> {
  const ctx = await buildContext({
    userId: input.userId,
    role: input.role,
    isSuperAdmin: input.isSuperAdmin,
    organizationId: input.organizationId,
    source: 'web',
    currentPath: input.currentPath,
  })

  if (input.callbackData) return await handleCallback(input.callbackData, ctx)
  if (input.text) return await runCopilot(input.text, ctx)
  return { text: 'Не получил ввод.' }
}

async function buildContext(params: {
  userId: string
  role: string | null
  isSuperAdmin: boolean
  organizationId?: string | null
  source: 'telegram' | 'web'
  telegramChatId?: number
  currentPath?: string
}): Promise<CopilotContext> {
  const supabase = createAdminSupabaseClient()
  const capabilities = params.isSuperAdmin
    ? new Set<string>()
    : await loadUserCapabilities(params.userId, params.role)
  return {
    userId: params.userId,
    telegramChatId: params.telegramChatId,
    organizationId: params.organizationId,
    isSuperAdmin: params.isSuperAdmin,
    capabilities,
    source: params.source,
    currentPath: params.currentPath,
    supabase,
  }
}
