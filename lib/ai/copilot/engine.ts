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
import { fuzzyFindBest } from './fuzzy'

const OPENAI_API = 'https://api.openai.com/v1/chat/completions'
// gpt-4o-mini слишком слаб для выбора нужного инструмента из 100+ и рассуждения
// → копилот «тупил». gpt-4o заметно умнее в tool-calling. Можно поднять ещё выше
// через env OPENAI_MODEL (gpt-4.1 / gpt-5), если доступно на аккаунте.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'

const COPILOT_SYSTEM_PROMPT = `Ты — Orda, толковый операционный помощник владельца игрового клуба. Думаешь как опытный управляющий: разбираешься в деньгах, сменах, складе и команде. Действуешь решительно и по делу, без болтовни и извинений.

ЯЗЫК: отвечай по-русски. Понимаешь казахский, сленг и опечатки — улавливай СМЫСЛ, а не цепляйся к словам. "скок касса", "дай вперёд денег", "движ за неделю", "скок подняли" — это нормальные запросы, понимай и выполняй их.

КАК ТЫ ДЕЙСТВУЕШЬ:
У тебя есть TOOLS — это твои руки. Нужно действие или данные → СРАЗУ вызывай подходящий tool, не рассуждай вслух и не переспрашивай.
- Выбирай tool по СМЫСЛУ запроса, уверенно. Не уверен в параметрах — вызови с тем что есть (хоть {}), систему сама дособерёт недостающее кнопками.
- НИКОГДА не пиши текстом "укажите ID / уточните период / пришлите имя" — это делают кнопки, не ты.
- НИКОГДА не выдумывай UUID/ID — оставляй пустым, если не знаешь точно.
- Несколько действий в одном сообщении → вызывай НЕСКОЛЬКО tools сразу (parallel tool_calls).

ПРИМЕРЫ:
"добавь расход 8500 за курьера" → add_expense({cash_amount: 8500, comment: "курьер"})
"выдай Айгерим аванс 50к" → give_advance({amount: 50000})  (имя не резолвим — система покажет выбор оператора)
"оштрафуй за опоздание 2000" → add_fine({amount: 2000, reason: "опоздание"})
"скок выручки за неделю" → query_revenue({period: "week"})
"кто сегодня" → get_today_shifts({})
"покажи долги" → get_overdue_debts({})
"топ операторов" → get_top_operators({})
"поставь задачу убрать в зале на завтра" → create_task({title: "Убрать в зале", due_date: "<завтра>"})
"напомни через час позвонить поставщику" → schedule_reminder({text: "позвонить поставщику", remind_at: "<сейчас+1ч>"})
"выдай Айгерим 30к и оштрафуй на 5к за опоздание" → give_advance({amount: 30000}) + add_fine({amount: 5000, reason: "опоздание"}) (оба сразу)

ПОСЛЕ ДАННЫХ: если в цифрах есть что-то важное (резкий рост/спад, аномалия, что стоит проверить) — добавь ОДНУ короткую дельную мысль. Нечего сказать ценного — просто отдай данные, без воды и общих фраз.

ЗНАНИЕ СИСТЕМЫ (вызывай инструменты, не выдумывай):
- "что умеешь / что я могу / какие у меня права / список функций" → list_my_actions({})
- "какие страницы есть / где смотреть X / как открыть Y / куда зайти чтобы…" → find_page({query: "<тема>"})

ТЕКСТОМ (без tool) отвечай только когда:
- Приветствие / благодарность — коротко, по-человечески.
- Вопрос-определение ("что такое маржа", "как считается PI") — объясни коротко и по делу.
- Нет подходящего tool — честно скажи, что это пока не умеешь.

ФОРМАТ:
- Сразу к делу. Без "Конечно!", "Хорошо!", без повтора вопроса, без воды.
- Деньги: "10 000 ₸" (без копеек). Даты: YYYY-MM-DD.
- Пиши коротко и по-человечески, как толковый управляющий, а не робот.
- Никогда не раскрывай токены / API keys / env.`

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
    // АГЕНТНЫЙ МОЗГ для чтения: read-инструмент с готовыми параметрами →
    // выполняем, читаем результат, при нужде цепляем ещё, и СИНТЕЗИРУЕМ ответ.
    // Write-действия (аванс/штраф/расход и т.п.) сюда не попадают — у них своя
    // схема с подтверждением.
    if (isReadOnlyTool(tool.name)) {
      const missingReq = tool.params.find((p) => p.required && (llmResponse.toolCall!.args?.[p.name] == null || llmResponse.toolCall!.args?.[p.name] === ''))
      if (!missingReq) {
        const synth = await runAgenticRead(input, ctx, tools, session, llmResponse.toolCall)
        if (synth) { pushHistory(session, 'assistant', synth.text); return synth }
      }
    }
    startTool(session, tool.name)
    // Multi-step: если AI вернул несколько tool_calls — кладём остальные в очередь.
    // После выполнения первого, engine автоматически возьмёт следующий.
    if (llmResponse.extraTools && llmResponse.extraTools.length > 0) {
      session.pendingToolQueue = llmResponse.extraTools
    }
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
            // Может AI прислал имя ("Айгерим") вместо ID — fuzzy-найдём
            const candidates = options.map((opt) => ({ item: opt, haystack: opt.label }))
            const match = fuzzyFindBest(valueStr, candidates)
            if (match) {
              console.log(`[copilot] fuzzy-match ${param.name}: "${valueStr}" → "${match.item.label}" (${match.matchType})`)
              setParam(session, key, match.item.value)
              continue
            }
            console.warn(`[copilot] AI hallucinated ${param.name}=${valueStr} — not in getOptions, asking user.`)
            continue
          }
        } catch {
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

  if (callbackData === 'restart') {
    // Перезапускаем сбор параметров для текущего tool — параметры сбрасываем, tool остаётся
    if (!session.activeTool) return { text: 'Нечего перезапускать.' }
    const tool = getTool(session.activeTool)
    if (!tool) return { text: 'Действие не найдено.' }
    startTool(session, tool.name)
    return await continueToolCollection(tool, ctx, session)
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
      { label: '↩ Изменить', callbackData: 'restart', style: 'secondary' },
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
    // Авто-ретрай при transient ошибках (network/timeout/temporary db).
    // Только 1 раз — если упадёт второй — отдаём как есть.
    let result = await tool.handler(params, ctx)
    if (!result.ok && isTransientError(result.message)) {
      console.warn(`[copilot] transient error, retrying once: ${result.message}`)
      await new Promise((r) => setTimeout(r, 500))
      result = await tool.handler(params, ctx)
    }

    // Сохраняем очередь tools, потому что resetToolState её затрёт
    const queue = session.pendingToolQueue || []
    resetToolState(session)
    pushHistory(session, 'assistant', result.message)

    if (!result.ok) {
      // Прерываем multi-step при ошибке
      session.pendingToolQueue = []
      return { text: `❌ ${friendlyError(result.message)}` }
    }

    let msg = `✅ ${result.message}`
    if (tool.successTemplate) {
      msg = tool.successTemplate(params, result.data)
    }

    // Multi-step: если есть очередь, запускаем следующий tool
    if (queue.length > 0) {
      const next = queue[0]
      const nextTool = getTool(next.name)
      if (nextTool && (ctx.isSuperAdmin || ctx.capabilities.has(nextTool.requiredCapability))) {
        startTool(session, nextTool.name)
        session.pendingToolQueue = queue.slice(1)
        for (const [key, value] of Object.entries(next.args || {})) {
          if (value != null && value !== '') {
            const param = nextTool.params.find((p) => p.name === key)
            if (param) {
              if ((param.type === 'select' || param.type === 'multiselect') && param.getOptions) {
                try {
                  const options = await param.getOptions(ctx)
                  if (options.some((o) => String(o.value) === String(value))) {
                    setParam(session, key, value)
                  } else {
                    const cand = options.map((opt) => ({ item: opt, haystack: opt.label }))
                    const match = fuzzyFindBest(String(value), cand)
                    if (match) setParam(session, key, match.item.value)
                  }
                } catch {}
              } else {
                setParam(session, key, value)
              }
            }
          }
        }
        const nextResp = await continueToolCollection(nextTool, ctx, session)
        return { text: `${msg}\n\n— Дальше —\n${nextResp.text}`, buttons: nextResp.buttons, meta: nextResp.meta }
      }
    }

    // Кнопки follow-up: либо явно указанные tool'ом, либо дефолтные по категории.
    let buttons = (result.followUps || []).map((f) => ({
      label: f.label,
      callbackData: f.action,
      style: 'secondary' as const,
    }))
    if (buttons.length === 0) {
      buttons = defaultFollowUps(tool)
    }

    return { text: msg, buttons: buttons.length > 0 ? buttons : undefined }
  } catch (e: any) {
    session.pendingToolQueue = []
    resetToolState(session)
    return { text: `❌ ${friendlyError(e?.message || 'неизвестная ошибка')}` }
  }
}

/**
 * Дефолтные follow-up кнопки в зависимости от только что выполненного tool.
 * Цель — предложить логичный следующий шаг чтобы юзер не печатал заново.
 */
function defaultFollowUps(tool: CopilotTool): Array<{ label: string; callbackData: string; style: 'secondary' }> {
  const sec = (label: string, callbackData: string) => ({ label, callbackData, style: 'secondary' as const })
  switch (tool.name) {
    case 'give_advance':
      return [sec('+ ещё аванс', `tool:give_advance`), sec('💵 Зарплата', `tool:get_operator_salary`)]
    case 'add_fine':
      return [sec('+ ещё штраф', `tool:add_fine`), sec('🎁 Бонус', `tool:add_bonus`)]
    case 'add_bonus':
      return [sec('+ ещё бонус', `tool:add_bonus`), sec('⚠ Штраф', `tool:add_fine`)]
    case 'add_expense':
      return [sec('+ ещё расход', `tool:add_expense`), sec('📊 Расходы за неделю', `tool:query_expenses`)]
    case 'add_income':
      return [sec('+ ещё доход', `tool:add_income`), sec('📈 Выручка', `tool:query_revenue`)]
    case 'create_task':
      return [sec('+ ещё задача', `tool:create_task`), sec('📋 Все задачи', `tool:get_overdue_tasks`)]
    case 'mark_debt_paid':
      return [sec('Ещё долг', `tool:mark_debt_paid`), sec('📋 Все долги', `tool:get_overdue_debts`)]
    case 'assign_shift':
      return [sec('+ ещё смена', `tool:assign_shift`), sec('☀️ Сегодня', `tool:get_today_shifts`)]
    case 'create_receipt':
      return [sec('+ ещё приёмка', `tool:create_receipt`), sec('📦 Остатки', `tool:get_stock_value`)]
    case 'add_stock':
      return [sec('+ ещё', `tool:add_stock`), sec('📦 Остатки', `tool:get_stock_value`)]
    case 'writeoff_item':
      return [sec('+ ещё списание', `tool:writeoff_item`)]
    case 'void_adjustment':
      return [sec('💵 Зарплата', `tool:get_operator_salary`)]
    default:
      return []
  }
}

/**
 * Признаки transient (временной) ошибки — стоит повторить.
 */
function isTransientError(msg: string): boolean {
  const m = String(msg || '').toLowerCase()
  return (
    m.includes('timeout') ||
    m.includes('etimedout') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('network') ||
    m.includes('fetch failed') ||
    m.includes('socket hang up') ||
    m.includes('temporarily unavailable') ||
    m.includes('try again')
  )
}

/**
 * Превращает технические ошибки Postgres/Supabase в понятный русский текст.
 */
function friendlyError(msg: string): string {
  const m = String(msg || '')
  // bigint / uuid syntax errors → значит юзер ввёл текст там где ждали ID
  if (m.includes('invalid input syntax for type bigint') || m.includes('invalid input syntax for type uuid')) {
    return 'Ввёл что-то не то — нужен был ID из списка. Начни заново и выбери кнопкой.'
  }
  // FK violation
  if (m.includes('violates foreign key constraint')) {
    return 'Не нашлась связанная запись (оператор/точка/товар). Возможно она удалена или ты выбрал не из списка.'
  }
  // NOT NULL
  if (m.includes('null value in column') || m.includes('violates not-null')) {
    return 'Не хватает обязательных данных. Начни заново и заполни все поля.'
  }
  // Unique violation
  if (m.includes('duplicate key value violates unique')) {
    return 'Такая запись уже существует.'
  }
  // Check constraint
  if (m.includes('violates check constraint')) {
    return 'Значение не соответствует правилам (например процент скидки > 100, или сумма ≤ 0).'
  }
  // Permission denied
  if (m.includes('permission denied') || m.includes('row-level security')) {
    return 'Нет прав на это действие. Обратись к администратору.'
  }
  // Schema cache
  if (m.includes('column') && m.includes('does not exist')) {
    return 'Структура БД не синхронизирована. Скажи администратору применить миграции.'
  }
  // Timeout
  if (m.includes('timeout') || m.includes('ETIMEDOUT')) {
    return 'Сервер не ответил вовремя. Попробуй ещё раз.'
  }
  // Default — return original
  return m
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
  /** Дополнительные tool-вызовы (multi-step) — попадают в session.pendingToolQueue */
  extraTools?: Array<{ name: string; args: Record<string, unknown> }>
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

  // Подгружаем AI-memory (что сохранено пользователем через save_memory).
  // Это даёт боту контекст бизнеса: имена операторов, особые правила, приоритеты.
  let memoryHint = ''
  try {
    const memQ = ctx.supabase
      .from('ai_memory')
      .select('key, value')
      .order('created_at', { ascending: false })
      .limit(30)
    // Скоуп по организации — иначе в системный промпт попадут факты чужих компаний.
    const { data: memories } = await (ctx.organizationId
      ? memQ.eq('organization_id', ctx.organizationId)
      : memQ.is('organization_id', null))
    if (memories && memories.length > 0) {
      memoryHint = '\n\nЗАПОМНЕННЫЕ ФАКТЫ (используй при необходимости):\n' +
        memories.map((m: any) => `- ${m.key}: ${m.value}`).join('\n')
    }
  } catch { /* ai_memory может отсутствовать — не критично */ }

  const pageHint = ctx.currentPath
    ? `\n\nПОЛЬЗОВАТЕЛЬ СЕЙЧАС НА СТРАНИЦЕ: ${ctx.currentPath}\n` +
      `Если запрос неоднозначен — учитывай контекст страницы:\n` +
      `- /expenses → действие про расходы (add_expense, delete_expense, approve_expense)\n` +
      `- /salary → зарплата (give_advance, add_fine, add_bonus, void_adjustment)\n` +
      `- /shifts → смены (assign_shift, cancel_shift, get_today_shifts)\n` +
      `- /store/* → склад (create_request, decide_request, recount_balance)\n` +
      `- /tasks → задачи (create_task, close_task, update_task)\n` +
      `- /operators → команда (create_operator, update_operator, send_message_to_operator)\n` +
      `- /dashboard → общая аналитика (query_revenue, get_kpi_progress)\n` +
      `Например, на /expenses "удали последний" → delete_expense; на /salary "отмени" → void_adjustment.`
    : ''
  const systemPrompt = `${COPILOT_SYSTEM_PROMPT}\n\n${toolsDesc}\n\nКонтекст пользователя:\nИсточник: ${ctx.source}\nСупер-админ: ${ctx.isSuperAdmin}${pageHint}${memoryHint}`

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
        // Reasoning-модели (gpt-5*) ТРАТЯТ часть токенов на внутреннее
        // размышление. С лимитом 800 весь бюджет уходил в reasoning, и на
        // ответ/выбор инструмента не оставалось → бот «молчал/тупил».
        // Даём больше бюджета для gpt-5; для обычных моделей хватает меньше.
        max_completion_tokens: MODEL.startsWith('gpt-5') ? 4000 : 1000,
        // gpt-5: temperature не поддерживается; reasoning_effort НЕЛЬЗЯ вместе с
        // function-tools на /v1/chat/completions (gpt-5.4 падает с ошибкой) — поэтому
        // для gpt-5 не передаём ни то, ни другое (дефолтный reasoning).
        // Обычные модели — низкая температура для точного tool-calling.
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

    // Логируем расход токенов в ai_usage_log
    try {
      const { logAiUsageSafe } = await import('@/lib/ai/usage-tracker')
      await logAiUsageSafe(ctx.supabase, {
        userId: ctx.userId,
        endpoint: '/api/copilot:llm',
        model: MODEL,
        usage: data?.usage,
        status: res.ok && !data?.error ? 'success' : 'error',
        error: !res.ok || data?.error ? data?.error?.message || `OpenAI ${res.status}` : null,
        payload: { source: ctx.source, hasTools: openaiTools.length, currentPath: ctx.currentPath || null },
      })
    } catch {}

    const choice = data?.choices?.[0]
    const message = choice?.message
    if (!message) return { text: 'Не получил ответа от AI.' }

    // Tool calls (может быть несколько — multi-step)
    const toolCalls = message.tool_calls || []
    if (toolCalls.length > 0) {
      const parsed = toolCalls
        .filter((tc: any) => tc?.function?.name)
        .map((tc: any) => {
          let args = {}
          try { args = JSON.parse(tc.function.arguments || '{}') } catch {}
          return { name: tc.function.name, args: args as Record<string, unknown> }
        })
      if (parsed.length > 0) {
        return { toolCall: parsed[0], extraTools: parsed.slice(1) }
      }
    }

    return { text: message.content || '' }
  } catch (e: any) {
    console.error('[copilot] callLLM error:', e)
    return { text: `Ошибка AI: ${e?.message || 'unknown'}` }
  }
}

// Инструмент только читает данные (безопасно авто-выполнять и рассуждать)?
const READ_PREFIXES = ['query_', 'get_', 'compare_', 'who_', 'list_', 'search_', 'find_']
function isReadOnlyTool(name: string): boolean {
  return READ_PREFIXES.some((p) => name.startsWith(p))
}

// Выполняет read-инструмент и возвращает текст результата (для подачи модели).
async function runReadTool(name: string, args: Record<string, unknown>, ctx: CopilotContext): Promise<string> {
  const tool = getTool(name)
  if (!tool) return `Инструмент ${name} не найден.`
  if (!isReadOnlyTool(name)) return 'Это действие меняет данные — в авто-режиме не выполняется, нужно подтверждение пользователя.'
  if (!ctx.isSuperAdmin && !ctx.capabilities.has(tool.requiredCapability)) return 'Нет прав на это действие.'
  try {
    const result = await tool.handler(args || {}, ctx)
    if (!result.ok) return `Ошибка: ${result.message}`
    let out = result.message || ''
    if (result.data != null) {
      const json = JSON.stringify(result.data)
      out += '\nДАННЫЕ: ' + (json.length > 3000 ? json.slice(0, 3000) + '…' : json)
    }
    return out || 'Готово (без данных).'
  } catch (e: any) {
    return `Ошибка выполнения: ${e?.message || 'unknown'}`
  }
}

/**
 * АГЕНТНЫЙ ЦИКЛ ЧТЕНИЯ: выполняет read-инструменты, читает их результаты,
 * при необходимости вызывает ещё, и пишет ОСМЫСЛЕННЫЙ синтезированный ответ.
 * Только read-инструменты. Возвращает null если AI не настроен (→ фолбэк).
 */
async function runAgenticRead(
  userText: string,
  ctx: CopilotContext,
  tools: CopilotTool[],
  session: ReturnType<typeof getOrCreateSession>,
  first: { name: string; args: Record<string, unknown> },
): Promise<CopilotResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const readTools = tools.filter((t) => isReadOnlyTool(t.name))
  const openaiTools = readTools.map((t) => toolToOpenAISchema(t, ctx))

  const sys =
    'Ты — Orda, аналитик-управляющий клуба. У тебя есть инструменты ЧТЕНИЯ данных бизнеса. ' +
    'Чтобы ответить: вызывай нужные инструменты (можно несколько, последовательно), ЧИТАЙ их результаты, ' +
    'и напиши КОРОТКИЙ ответ по-русски с конкретными цифрами и одной дельной мыслью. ' +
    'Числа бери ТОЛЬКО из результатов инструментов — не выдумывай. Если данных не хватило — честно скажи. ' +
    'Деньги пиши как "10 000 ₸". Без воды, приветствий и повторения вопроса.'

  const msgs: any[] = [
    { role: 'system', content: sys },
    ...session.history.slice(-4).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ]

  // Сеем первым инструментом, который уже выбрал роутер — экономим один вызов.
  const seedId = 'call_seed'
  msgs.push({ role: 'assistant', content: null, tool_calls: [{ id: seedId, type: 'function', function: { name: first.name, arguments: JSON.stringify(first.args || {}) } }] })
  msgs.push({ role: 'tool', tool_call_id: seedId, content: await runReadTool(first.name, first.args, ctx) })

  let lastToolText = ''
  for (let iter = 0; iter < 3; iter++) {
    try {
      const res = await fetch(OPENAI_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          max_completion_tokens: MODEL.startsWith('gpt-5') ? 4000 : 1200,
          ...(MODEL.startsWith('gpt-5') ? {} : { temperature: 0.2 }),
          messages: msgs,
          tools: openaiTools,
          tool_choice: 'auto',
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { console.error('[copilot] agentic error:', data); break }
      const message = data?.choices?.[0]?.message
      if (!message) break

      const tcs = message.tool_calls || []
      if (tcs.length === 0) {
        const text = (message.content || '').trim()
        if (text) return { text }
        break
      }
      // Модель хочет ещё данных — выполняем read-инструменты.
      msgs.push({ role: 'assistant', content: message.content || null, tool_calls: tcs })
      for (const tc of tcs) {
        if (!tc?.function?.name) continue
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch {}
        const out = await runReadTool(tc.function.name, args, ctx)
        lastToolText = out
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: out })
      }
    } catch (e: any) {
      console.error('[copilot] agentic loop error:', e)
      break
    }
  }

  // Фолбэк: если синтез не получился — отдаём последний результат инструмента «как есть».
  const fallback = lastToolText || (await runReadTool(first.name, first.args, ctx))
  return { text: fallback.replace(/\nДАННЫЕ:[\s\S]*$/, '').trim() || 'Не удалось получить ответ.' }
}
