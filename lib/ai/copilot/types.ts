/**
 * Базовые типы AI Copilot.
 *
 * Tool — это один action который AI может выполнить.
 * Каждый tool привязан к capability (для permission check),
 * описывает свои параметры (для conversational form),
 * и имеет handler (вызывает API endpoint).
 */

export type CopilotParamType = 'string' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect'

export type CopilotSelectOption = {
  value: string
  label: string
  // Опциональная мета: иконка/группа/доп.информация для UI
  hint?: string
}

export type CopilotParam = {
  /** Имя поля (передаётся в API) */
  name: string
  /** Человеческое название для подсказки в диалоге */
  label: string
  /** Тип параметра */
  type: CopilotParamType
  /** Обязательный? */
  required: boolean
  /** Описание для AI (что это и когда заполнять) */
  description: string
  /** Для select/multiselect — функция получения опций (динамически) */
  getOptions?: (ctx: CopilotContext) => Promise<CopilotSelectOption[]>
  /** Дефолтное значение если есть */
  defaultValue?: unknown
  /** Подсказка для AI как извлечь из пользовательского ввода */
  extractHint?: string
}

export type CopilotTool = {
  /** Уникальное имя (snake_case) — то что AI видит как tool name */
  name: string
  /** Категория для группировки (finance, inventory, team, etc) */
  category: 'finance' | 'salary' | 'shifts' | 'inventory' | 'team' | 'pos' | 'tasks' | 'analytics' | 'system'
  /** Краткое описание для AI */
  description: string
  /** Capability требуется для использования этого tool. AI получит tool только если у юзера есть это право */
  requiredCapability: string
  /** Severity для подтверждения: high требует явного "✅ Подтвердить" перед выполнением */
  severity: 'low' | 'medium' | 'high'
  /** Параметры — собираются через диалог если не все указаны сразу */
  params: CopilotParam[]
  /** Handler — выполняет действие, возвращает результат */
  handler: (input: Record<string, unknown>, ctx: CopilotContext) => Promise<CopilotToolResult>
  /** Шаблон сообщения после успешного выполнения */
  successTemplate?: (input: Record<string, unknown>, result: unknown) => string
}

export type CopilotToolResult = {
  ok: boolean
  message: string
  data?: unknown
  /** Если предлагаем follow-up действия — список */
  followUps?: Array<{ label: string; action: string }>
}

export type CopilotContext = {
  /** Кто запросил действие (user_id) */
  userId: string
  /** Telegram chat_id если из бота */
  telegramChatId?: number
  /** Активная организация */
  organizationId?: string | null
  /** Является ли super-admin */
  isSuperAdmin: boolean
  /** Список capabilities пользователя (Set для O(1) проверки) */
  capabilities: Set<string>
  /** Источник запроса */
  source: 'telegram' | 'web'
  /** Текущая страница (если web) — для контекста */
  currentPath?: string
  /** Supabase admin client */
  supabase: any
}

/**
 * Состояние диалога: какой tool сейчас собирается, какие параметры
 * уже заполнены, что ждём от пользователя следующим шагом.
 */
export type CopilotSession = {
  sessionId: string
  userId: string
  telegramChatId?: number
  /** Активный tool (если в процессе сбора параметров) */
  activeTool: string | null
  /** Уже собранные значения параметров */
  collectedParams: Record<string, unknown>
  /** Какой param ждём ответом */
  awaitingParam: string | null
  /** История последних 10 сообщений (для контекста LLM) */
  history: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>
  /** Кэш опций по имени параметра — нужен чтобы в callback_data передавать
   *  короткий индекс `#0`, `#1` (UUID + длинное название категории
   *  не влезают в 64 байта Telegram callback_data limit). */
  pendingOptions?: Record<string, CopilotSelectOption[]>
  /** Очередь tool-вызовов из multi-step ответа AI. Если AI вернул несколько
   *  tool_calls (например "выдай аванс и пометь долг"), первый запускаем,
   *  остальные кладём сюда и берём после завершения первого. */
  pendingToolQueue?: Array<{ name: string; args: Record<string, unknown> }>
  /** Когда сессия создана */
  createdAt: number
  /** Когда последняя активность */
  updatedAt: number
}

/**
 * Ответ engine — что показать пользователю и какие действия предложить.
 */
export type CopilotResponse = {
  /** Текст для пользователя */
  text: string
  /** Inline-кнопки (для выбора параметров или подтверждения действия) */
  buttons?: Array<{
    /** Текст на кнопке */
    label: string
    /** Что произойдёт при нажатии: 'param:<name>:<value>' для выбора параметра, 'confirm' для подтверждения, 'cancel' для отмены, 'tool:<name>' для запуска другого tool */
    callbackData: string
    /** Стиль кнопки */
    style?: 'primary' | 'secondary' | 'danger'
  }>
  /** Метаданные: статус сессии и т.п. */
  meta?: {
    activeTool?: string | null
    awaitingParam?: string | null
    isComplete?: boolean
  }
}
