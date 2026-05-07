/**
 * Copilot Engine — единый AI движок.
 *
 * Принимает на вход текст или callback от пользователя,
 * возвращает CopilotResponse (текст + кнопки + meta).
 *
 * Используется и Telegram-ботом и веб-ассистентом.
 *
 * Алгоритм:
 *  1. Получить сессию (или создать новую)
 *  2. Если сессия в процессе сбора параметров для tool — обработать как ответ на param
 *  3. Иначе — отправить текст в LLM с tools, чтобы определить intent
 *  4. Если LLM решил вызвать tool → начать сбор параметров (или сразу выполнить если все есть)
 *  5. Если LLM просто ответил текстом → вернуть текст
 */
import 'server-only'

import {
  cleanupExpiredSessions,
  getOrCreateSession,
  startTool,
  setParam,
  awaitParam,
  pushHistory,
  clearSession,
  resetToolState,
} from './sessions'
import {
  getTool,
  getToolsForUser,
  describeToolsForPrompt,
  toolToOpenAISchema,
} from './registry'
import type { CopilotContext, CopilotResponse, CopilotTool, CopilotParam } from './types'

const OPENAI_API = 'https://api.openai.com/v1/chat/completions'
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

const COPILOT_SYSTEM_PROMPT = `Ты — AI-ассистент Orda Control. Помогаешь владельцу/менеджеру управлять игровым клубом через диалог: выдавать авансы, штрафы, бонусы, добавлять расходы/доходы, ставить задачи, смотреть аналитику и т.п.

ЯЗЫК: русский. Понимаешь казахский, отвечаешь по-русски.

🔴 ГЛАВНЫЙ ПРИНЦИП:
У тебя есть СПИСОК TOOLS — это все действия которые ты можешь сделать.
Когда пользователь просит что-то сделать → ВЫЗОВИ ПОДХОДЯЩИЙ TOOL.
Если параметров не хватает — НЕ СПРАШИВАЙ ТЕКСТОМ, просто вызови tool с теми что есть (даже с пустыми {}). Система сама покажет интерактивные кнопки для недостающих полей.

🔴 НИКОГДА не отвечай текстом типа "укажите ID", "уточните период", "пришлите имя оператора".
🔴 НИКОГДА не выдумывай UUID/ID — оставляй их пустыми если не знаешь точно.

ПРИМЕРЫ ПРАВИЛЬНОГО ПОВЕДЕНИЯ:

User: "добавь расход 8500 за курьера"
You: вызвать add_expense({cash_amount: 8500, comment: "курьер"})

User: "выдай аванс"
You: вызвать give_advance({})

User: "выдай Айгерим аванс 50к"
You: вызвать give_advance({amount: 50000}) — operator_id оставить пустым, по имени система не находит

User: "оштрафуй за опоздание 2000"
You: вызвать add_fine({amount: 2000, reason: "опоздание"})

User: "сколько выручки за неделю?"
You: вызвать query_revenue({period: "week"})

User: "кто работает сегодня?"
You: вызвать get_today_shifts({})

User: "отмени аванс"
You: вызвать void_adjustment({})

User: "покажи долги"
You: вызвать get_overdue_debts({})

User: "покажи топ операторов"
You: вызвать get_top_operators({})

User: "поставь задачу убрать в зале на завтра"
You: вызвать create_task({title: "Убрать в зале", due_date: "<завтра>"})

User: "напомни через час позвонить поставщику"
You: вызвать schedule_reminder({text: "позвонить поставщику", remind_at: "<сейчас+1ч>"})

КОГДА можно отвечать текстом БЕЗ tool:
- Приветствия: "Привет" / "Здарова" / "Спасибо"
- Вопросы про возможности: "Что ты умеешь?" → краткий список основных действий
- Определения: "Что такое маржа?" / "Как считается PI?"
- Если в списке tools НЕТ подходящего

ФОРМАТ ОТВЕТОВ:
- Не начинай с "Конечно!", "Хорошо!", "Отлично!" — сразу к делу
- Деньги: число + ₸, без копеек ("10 000 ₸")
- Даты: YYYY-MM-DD
- Не повторяй вопрос пользователя
- Кратко, по делу, без воды
- Никогда не раскрывай токены / API keys / env переменные`

export async function runCopilot(
  input: string,
  ctx: CopilotContext,
): Promise<CopilotResponse> {
  cleanupExpiredSessions()

  const session = getOrCreateSession(ctx.userId, ctx.telegramChatId)
  pushHistory(session, 'user', input)

  // ─── Если в процессе сбора параметров — пробуем интерпретировать ввод как ответ ─
  if (session.activeTool && session.awaitingParam) {
    const tool = getTool(session.activeTool)
    if (tool) {
      const param = tool.params.find((p) => p.name === session.awaitingParam)
      if (param) {
        const parsed = parseParamValue(param, input)
        if (parsed.ok) {
          setParam(session, param.name, parsed.value)
          // Переходим к следующему недостающему параметру
          return await continueToolCollection(tool, ctx, session)
        }
        return {
          text: `Не понял "${input}" как ${param.label}. ${parsed.error || 'Попробуй ещё раз.'}`,
          meta: { activeTool: tool.name, awaitingParam: param.name },
        }
      }
    }
  }

  // ─── Свежий запрос — спрашиваем LLM что делать ─────────────────────────────
  const tools = getToolsForUser(ctx)
  if (tools.length === 0) {
    return {
      text: 'У тебя нет доступа ни к одному действию в системе. Обратись к администратору.',
    }
  }

  const llmResponse = await callLLM(input, ctx, tools, session)
  pushHistory(session, 'assistant', llmResponse.text || '')

  // Если LLM вызвал tool
  if (llmResponse.toolCall) {
    const tool = getTool(llmResponse.toolCall.name)
    if (!tool) {
      return { text: `Извини, действие "${llmResponse.toolCall.name}" не найдено.` }
    }
    if (!ctx.isSuperAdmin && !ctx.capabilities.has(tool.requiredCapability)) {
      return { text: `У тебя нет права для "${tool.description}". Обратись к администратору.` }
    }
    startTool(session, tool.name)
    // Пред-заполняем те параметры что LLM смог извлечь.
    // ВАЖНО: для select-параметров валидируем значение по getOptions —
    // если AI выдумал ID/значение которого нет в реальном списке,
    // НЕ устанавливаем и engine спросит пользователя через кнопки.
    for (const [key, value] of Object.entries(llmResponse.toolCall.args || {})) {
      if (value == null || value === '') continue
      const param = tool.params.find((p) => p.name === key)
      if (!param) continue

      if ((param.type === 'select' || param.type === 'multiselect') && param.getOptions) {
        try {
          const options = await param.getOptions(ctx)
          const valueStr = String(value)
          const valid = options.some((opt) => String(opt.value) === valueStr)
          if (!valid) {
            console.warn(`[copilot] AI hallucinated ${param.name}=${valueStr} — not in getOptions, asking user.`)
            continue
          }
        } catch {
          // Если getOptions упал — лучше пропустить чем принять выдуманное
          continue
        }
      }

      setParam(session, key, value)
    }
    return await continueToolCollection(tool, ctx, session)
  }

  // Просто текст
  return { text: llmResponse.text || 'Не понял запрос.' }
}

/**
 * Обрабатывает callback от inline-кнопки. callback_data:
 *   - param:<name>:<value> — выбор значения параметра
 *   - confirm — подтвердить выполнение
 *   - cancel — отменить текущую операцию
 *   - tool:<name> — запустить tool (с предустановленными параметрами)
 */
export async function handleCallback(
  callbackData: string,
  ctx: CopilotContext,
): Promise<CopilotResponse> {
  const session = getOrCreateSession(ctx.userId, ctx.telegramChatId)

  if (callbackData === 'cancel') {
    clearSession(ctx.userId, ctx.telegramChatId)
    return { text: '❌ Отменено.' }
  }

  if (callbackData === 'confirm') {
    if (!session.activeTool) return { text: 'Нечего подтверждать.' }
    const tool = getTool(session.activeTool)
    if (!tool) return { text: 'Действие не найдено.' }
    return await executeTool(tool, ctx, session)
  }

  if (callbackData.startsWith('param:')) {
    // Format: param:<name>:<value> или param:<name>:#<index> для длинных опций.
    const colonAfterParam = callbackData.indexOf(':', 6)
    if (colonAfterParam < 0) return { text: 'Неверный формат кнопки.' }
    const paramName = callbackData.slice(6, colonAfterParam)
    let value = callbackData.slice(colonAfterParam + 1)

    // Если значение начинается с `#` — это индекс опции из session.pendingOptions.
    // Резолвим обратно в реальное value (UUID / название категории / etc).
    if (value.startsWith('#')) {
      const idx = Number(value.slice(1))
      const cached = session.pendingOptions?.[paramName]
      if (!cached || isNaN(idx) || idx < 0 || idx >= cached.length) {
        return { text: '⚠ Сессия устарела. Начни заново.' }
      }
      value = String(cached[idx].value)
    }

    if (!session.activeTool) return { text: 'Сначала начни действие.' }
    const tool = getTool(session.activeTool)
    if (!tool) return { text: 'Действие не найдено.' }
    setParam(session, paramName, value)
    return await continueToolCollection(tool, ctx, session)
  }

  if (callbackData.startsWith('tool:')) {
    const toolName = callbackData.slice(5)
    const tool = getTool(toolName)
    if (!tool) return { text: 'Действие не найдено.' }
    startTool(session, toolName)
    return await continueToolCollection(tool, ctx, session)
  }

  return { text: 'Неизвестная команда.' }
}

/**
 * Проверяет какие параметры собраны, спрашивает следующий или
 * показывает финальное подтверждение.
 */
async function continueToolCollection(
  tool: CopilotTool,
  ctx: CopilotContext,
  session: ReturnType<typeof getOrCreateSession>,
): Promise<CopilotResponse> {
  // Найти первый недостающий обязательный параметр
  const missing = tool.params.find((p) => p.required && session.collectedParams[p.name] == null)

  if (missing) {
    awaitParam(session, missing.name)
    return await askForParam(missing, ctx, tool)
  }

  // Все параметры собраны — спрашиваем подтверждение
  const summary = formatSummary(tool, session.collectedParams, session.pendingOptions)
  return {
    text: `${summary}\n\nВыполнить?`,
    buttons: [
      { label: '✅ Подтвердить', callbackData: 'confirm', style: 'primary' },
      { label: '❌ Отмена', callbackData: 'cancel', style: 'secondary' },
    ],
    meta: { activeTool: tool.name, isComplete: true },
  }
}

/**
 * Спрашивает у пользователя значение параметра (с кнопками если select).
 */
async function askForParam(
  param: CopilotParam,
  ctx: CopilotContext,
  tool: CopilotTool,
): Promise<CopilotResponse> {
  if ((param.type === 'select' || param.type === 'multiselect') && param.getOptions) {
    let options: Awaited<ReturnType<typeof param.getOptions>>
    try {
      options = await param.getOptions(ctx)
    } catch (e: any) {
      console.error('[copilot] getOptions failed:', param.name, e)
      return {
        text: `Не удалось получить варианты для "${param.label}": ${e?.message || 'unknown'}.\nМожешь ввести значение текстом.`,
        buttons: [{ label: '❌ Отмена', callbackData: 'cancel', style: 'secondary' }],
        meta: { activeTool: tool.name, awaitingParam: param.name },
      }
    }
    if (options.length === 0) {
      // Сбрасываем tool state но сохраняем history (для multi-step контекста).
      const session = getOrCreateSession(ctx.userId, ctx.telegramChatId)
      resetToolState(session)
      return {
        text: `Нет доступных вариантов для "${param.label}". Действие отменено.\nВозможно нужная запись отсутствует. Попробуй другую команду.`,
      }
    }
    // Telegram имеет два лимита:
    //   - hard cap ~100 кнопок (8×13)
    //   - reply_markup JSON не более ~9KB (иначе "reply markup is too long")
    // Сначала режем по 96 штук, потом дополнительно по размеру JSON.
    const HARD_BUTTONS = 96
    const MAX_MARKUP_BYTES = 8500  // оставляем запас от ~10KB лимита
    let visible = options.slice(0, HARD_BUTTONS)

    // Считаем размер JSON и режем пока не влезет
    while (visible.length > 1) {
      const sample = visible.map((opt, idx) => ({
        text: opt.label + (opt.hint ? ` · ${opt.hint}` : ''),
        callback_data: `cp:param:${param.name}:#${idx}`,
      }))
      const size = Buffer.byteLength(JSON.stringify(sample), 'utf8')
      if (size <= MAX_MARKUP_BYTES) break
      visible = visible.slice(0, Math.floor(visible.length * 0.8))
    }

    const truncated = options.length > visible.length

    // Кэшируем visible в сессии — нужно для резолва индекса в callback.
    const session = getOrCreateSession(ctx.userId, ctx.telegramChatId)
    if (!session.pendingOptions) session.pendingOptions = {}
    session.pendingOptions[param.name] = visible

    return {
      text: truncated
        ? `${param.label}? (всего ${options.length}; показано ${visible.length} — если нужного нет, введи текстом)`
        : `${param.label}? (всего ${options.length})`,
      buttons: [
        ...visible.map((opt, idx) => ({
          label: opt.label + (opt.hint ? ` · ${opt.hint}` : ''),
          callbackData: `param:${param.name}:#${idx}`,
          style: 'secondary' as const,
        })),
        { label: '❌ Отмена', callbackData: 'cancel', style: 'secondary' as const },
      ],
      meta: { activeTool: tool.name, awaitingParam: param.name },
    }
  }

  // Свободный ввод
  const example = param.extractHint ? ` (например: ${param.extractHint})` : ''
  return {
    text: `${param.label}?${example}`,
    buttons: [{ label: '❌ Отмена', callbackData: 'cancel', style: 'secondary' }],
    meta: { activeTool: tool.name, awaitingParam: param.name },
  }
}

async function executeTool(
  tool: CopilotTool,
  ctx: CopilotContext,
  session: ReturnType<typeof getOrCreateSession>,
): Promise<CopilotResponse> {
  try {
    const params = session.collectedParams
    const result = await tool.handler(params, ctx)
    // Сбрасываем состояние tool НО сохраняем history — чтобы AI помнил
    // что только что произошло, и можно было сразу продолжить:
    // "выдай аванс Айгерим" → done → "теперь оштрафуй её на 2000"
    resetToolState(session)
    pushHistory(session, 'assistant', result.message)
    if (!result.ok) {
      return { text: `❌ ${result.message}` }
    }
    let msg = `✅ ${result.message}`
    if (tool.successTemplate) {
      msg = tool.successTemplate(params, result.data)
    }
    const buttons = (result.followUps || []).map((f) => ({
      label: f.label,
      callbackData: f.action,
      style: 'secondary' as const,
    }))
    return { text: msg, buttons: buttons.length > 0 ? buttons : undefined }
  } catch (e: any) {
    resetToolState(session)
    return { text: `❌ Ошибка выполнения: ${e?.message || 'неизвестная ошибка'}` }
  }
}

function formatSummary(
  tool: CopilotTool,
  params: Record<string, unknown>,
  pendingOptions?: Record<string, Array<{ value: string; label: string; hint?: string }>>,
): string {
  const lines: string[] = [`📋 ${tool.description}:`]
  for (const p of tool.params) {
    const val = params[p.name]
    if (val != null && val !== '') {
      lines.push(`  ${p.label}: ${formatValue(p, val, pendingOptions?.[p.name])}`)
    }
  }
  return lines.join('\n')
}

function formatValue(
  param: CopilotParam,
  value: unknown,
  options?: Array<{ value: string; label: string; hint?: string }>,
): string {
  if (param.type === 'number' && typeof value === 'number') {
    return value.toLocaleString('ru-RU') + (param.name.includes('amount') ? ' ₸' : '')
  }
  // Для select-параметров: подменяем UUID/код на читаемое название из cached options
  if ((param.type === 'select' || param.type === 'multiselect') && options) {
    const match = options.find((o) => String(o.value) === String(value))
    if (match) return match.label
  }
  return String(value)
}

function parseParamValue(param: CopilotParam, raw: string): { ok: true; value: unknown } | { ok: false; error?: string } {
  const trimmed = raw.trim()
  if (param.type === 'number') {
    const cleaned = trimmed.replace(/[\s ]/g, '').replace(',', '.')
    const num = Number(cleaned)
    if (Number.isNaN(num)) return { ok: false, error: 'Жду число.' }
    return { ok: true, value: num }
  }
  if (param.type === 'boolean') {
    const lower = trimmed.toLowerCase()
    if (['да', 'yes', 'true', '1', 'ок'].includes(lower)) return { ok: true, value: true }
    if (['нет', 'no', 'false', '0'].includes(lower)) return { ok: true, value: false }
    return { ok: false, error: 'Жду «да» или «нет».' }
  }
  if (param.type === 'date') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: true, value: trimmed }
    return { ok: false, error: 'Жду дату в формате YYYY-MM-DD.' }
  }
  return { ok: true, value: trimmed }
}

// ─── LLM CALL ────────────────────────────────────────────────────────────────

type LLMResult = {
  text?: string
  toolCall?: { name: string; args: Record<string, unknown> }
}

async function callLLM(
  userText: string,
  ctx: CopilotContext,
  tools: CopilotTool[],
  session: ReturnType<typeof getOrCreateSession>,
): Promise<LLMResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { text: 'AI не настроен (нет OPENAI_API_KEY).' }

  const toolsDesc = describeToolsForPrompt(tools)
  const systemPrompt = `${COPILOT_SYSTEM_PROMPT}\n\n${toolsDesc}\n\nКонтекст пользователя:\nИсточник: ${ctx.source}\nСупер-админ: ${ctx.isSuperAdmin}\n${ctx.currentPath ? `Текущая страница: ${ctx.currentPath}` : ''}`

  const messages = [
    { role: 'system', content: systemPrompt },
    ...session.history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ]

  const openaiTools = tools.map((t) => toolToOpenAISchema(t, ctx))

  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        // gpt-5+ требуют max_completion_tokens вместо max_tokens.
        // gpt-4o-mini и старше поддерживают оба варианта.
        max_completion_tokens: 800,
        // gpt-5+ требует temperature=1 (только дефолт). Старые модели
        // умнее на низкой температуре для tool-calling.
        ...(MODEL.startsWith('gpt-5') ? {} : { temperature: 0.1 }),
        messages,
        tools: openaiTools,
        tool_choice: 'auto',
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error('[copilot] OpenAI error:', data)
      return { text: `AI вернул ошибку: ${data?.error?.message || res.status}` }
    }

    const choice = data?.choices?.[0]
    const message = choice?.message
    if (!message) return { text: 'Не получил ответа от AI.' }

    // Tool call
    const toolCall = message.tool_calls?.[0]
    if (toolCall?.function?.name) {
      let args = {}
      try {
        args = JSON.parse(toolCall.function.arguments || '{}')
      } catch {}
      return { toolCall: { name: toolCall.function.name, args: args as Record<string, unknown> } }
    }

    return { text: message.content || '' }
  } catch (e: any) {
    console.error('[copilot] callLLM error:', e)
    return { text: `Ошибка AI: ${e?.message || 'unknown'}` }
  }
}
