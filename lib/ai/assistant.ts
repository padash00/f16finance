import 'server-only'

import type { AssistantRequest, AssistantResponse, PageSnapshot } from '@/lib/ai/types'
import { SITE_CONTEXT } from '@/lib/ai/site-context'
import {
  getAnalysisServerSnapshot,
  getExpensesServerSnapshot,
  getReportsServerSnapshot,
} from '@/lib/ai/server-snapshots'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/responses'
const MAX_TOOL_ROUNDS = 4
const DEFAULT_DATE = '2026-03-15'

type RequestSupabaseClient = ReturnType<typeof createRequestSupabaseClient>

type AssistantRunContext = {
  supabase: RequestSupabaseClient
  currentSnapshot?: PageSnapshot | null
}

type ToolCall = {
  call_id: string
  name: string
  arguments?: string
}

type NormalizedDateArgs = {
  dateFrom: string
  dateTo: string
}

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'get_site_context',
    description: 'Возвращает структуру сайта, роли страниц и правила безопасной работы с данными.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'get_current_page_snapshot',
    description: 'Возвращает готовый snapshot текущей страницы, если он уже был передан клиентом.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'get_analysis_snapshot',
    description: 'Возвращает безопасный snapshot AI-разбора по периоду.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dateFrom: { type: 'string', description: 'Начало периода в формате YYYY-MM-DD' },
        dateTo: { type: 'string', description: 'Конец периода в формате YYYY-MM-DD' },
      },
    },
  },
  {
    type: 'function',
    name: 'get_reports_snapshot',
    description: 'Возвращает безопасный snapshot отчётов по периоду.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dateFrom: { type: 'string', description: 'Начало периода в формате YYYY-MM-DD' },
        dateTo: { type: 'string', description: 'Конец периода в формате YYYY-MM-DD' },
      },
    },
  },
  {
    type: 'function',
    name: 'get_expenses_snapshot',
    description: 'Возвращает безопасный snapshot расходов по периоду.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dateFrom: { type: 'string', description: 'Начало периода в формате YYYY-MM-DD' },
        dateTo: { type: 'string', description: 'Конец периода в формате YYYY-MM-DD' },
      },
    },
  },
] as const

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function safeParseArguments(raw: string | undefined) {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}

  return {}
}

function normalizeDateArgs(args: Record<string, unknown>, currentSnapshot?: PageSnapshot | null): NormalizedDateArgs {
  const snapshotStart = currentSnapshot?.period?.from
  const snapshotEnd = currentSnapshot?.period?.to

  const dateFrom = isIsoDate(args.dateFrom) ? args.dateFrom : isIsoDate(snapshotStart) ? snapshotStart : DEFAULT_DATE
  const dateTo = isIsoDate(args.dateTo) ? args.dateTo : isIsoDate(snapshotEnd) ? snapshotEnd : DEFAULT_DATE

  return dateFrom <= dateTo ? { dateFrom, dateTo } : { dateFrom: dateTo, dateTo: dateFrom }
}

function summarizeSnapshot(snapshot: PageSnapshot | null | undefined) {
  if (!snapshot) return 'Текущий snapshot не передан.'

  const metrics = snapshot.sections.flatMap((section) => section.metrics ?? []).slice(0, 6)
  const metricText =
    metrics.length > 0
      ? metrics.map((metric) => `- ${metric.label}: ${metric.value}`).join('\n')
      : '- Внутри snapshot пока нет метрик.'

  return [
    `Текущая страница: ${snapshot.title} (${snapshot.route})`,
    snapshot.period ? `Период: ${snapshot.period.from} -> ${snapshot.period.to}` : 'Период: не указан',
    snapshot.summary.length > 0 ? `Короткая сводка: ${snapshot.summary.join(' | ')}` : 'Короткая сводка: не указана',
    'Быстрые метрики:',
    metricText,
  ].join('\n')
}

function buildSystemPrompt(request: AssistantRequest, currentSnapshot?: PageSnapshot | null) {
  const pageContext =
    SITE_CONTEXT.pages.find((page) => page.page === request.page) ||
    SITE_CONTEXT.pages.find((page) => page.page === 'global') ||
    {
      page: 'global',
      route: '/',
      title: 'Глобальный консультант',
      description: 'Общий контекст сайта.',
    }

  return [
    'Ты работаешь как финансовый консультант и операционный аналитик для сайта Orda Control.',
    'Отвечай на русском языке, кратко и по делу.',
    'Никогда не придумывай числа, если их нет в snapshot или tool-ответах.',
    'Если данных не хватает, прямо скажи, какие именно данные нужны.',
    'Не запрашивай и не упоминай service role key, секреты или прямой доступ к базе.',
    'Используй доступные tool-функции, если нужно обновить картину по другой странице или периоду.',
    '',
    `Текущая роль страницы: ${pageContext.title}`,
    pageContext.description,
    '',
    'Правила сайта:',
    ...SITE_CONTEXT.rules.map((rule) => `- ${rule}`),
    '',
    summarizeSnapshot(currentSnapshot),
  ].join('\n')
}

function toResponseInput(request: AssistantRequest, currentSnapshot?: PageSnapshot | null) {
  const history = (request.history ?? []).slice(-8).map((message) => ({
    role: message.role,
    content: [{ type: 'input_text', text: message.content }],
  }))

  return [
    {
      role: 'system',
      content: [{ type: 'input_text', text: buildSystemPrompt(request, currentSnapshot) }],
    },
    ...history,
    {
      role: 'user',
      content: [{ type: 'input_text', text: request.prompt }],
    },
  ]
}

function extractOpenAIText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  if (!Array.isArray(payload?.output)) return ''

  const parts = payload.output.flatMap((item: any) => {
    if (typeof item?.text === 'string' && item.text.trim()) {
      return [item.text.trim()]
    }

    if (!Array.isArray(item?.content)) return []

    return item.content.flatMap((content: any) => {
      if (typeof content?.text === 'string' && content.text.trim()) {
        return [content.text.trim()]
      }

      if (typeof content?.output_text === 'string' && content.output_text.trim()) {
        return [content.output_text.trim()]
      }

      if (typeof content?.text?.value === 'string' && content.text.value.trim()) {
        return [content.text.value.trim()]
      }

      return []
    })
  })

  return parts.join('\n\n').trim()
}

function extractToolCalls(payload: any): ToolCall[] {
  if (!Array.isArray(payload?.output)) return []

  return payload.output
    .filter((item: any) => item?.type === 'function_call' && item?.call_id && item?.name)
    .map((item: any) => ({
      call_id: String(item.call_id),
      name: String(item.name),
      arguments: typeof item.arguments === 'string' ? item.arguments : undefined,
    }))
}

async function executeToolCall(call: ToolCall, context: AssistantRunContext) {
  const args = safeParseArguments(call.arguments)

  switch (call.name) {
    case 'get_site_context':
      return {
        site: SITE_CONTEXT,
      }
    case 'get_current_page_snapshot':
      return context.currentSnapshot
        ? { snapshot: context.currentSnapshot }
        : { snapshot: null, note: 'Текущий snapshot не был передан из клиента.' }
    case 'get_analysis_snapshot': {
      const range = normalizeDateArgs(args, context.currentSnapshot)
      return {
        snapshot: await getAnalysisServerSnapshot(context.supabase, range),
      }
    }
    case 'get_reports_snapshot': {
      const range = normalizeDateArgs(args, context.currentSnapshot)
      return {
        snapshot: await getReportsServerSnapshot(context.supabase, range),
      }
    }
    case 'get_expenses_snapshot': {
      const range = normalizeDateArgs(args, context.currentSnapshot)
      return {
        snapshot: await getExpensesServerSnapshot(context.supabase, range),
      }
    }
    default:
      return {
        error: `Неизвестный tool: ${call.name}`,
      }
  }
}

async function requestOpenAI(payload: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      error: 'OPENAI_API_KEY не настроен на сервере.',
    } as const
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    const json = await response.json().catch(() => null)

    if (!response.ok || json?.error) {
      return {
        error: json?.error?.message || `OpenAI API error (${response.status})`,
      } as const
    }

    return {
      data: json,
    } as const
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Не удалось связаться с OpenAI API.',
    } as const
  }
}

export async function runAssistant(request: AssistantRequest, context: AssistantRunContext): Promise<AssistantResponse> {
  const basePayload: Record<string, unknown> = {
    model: OPENAI_MODEL,
    reasoning: { effort: 'medium' },
    max_output_tokens: 1200,
    tools: TOOL_DEFINITIONS,
    input: toResponseInput(request, context.currentSnapshot),
  }

  let previousResponseId: string | null = null

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const payload =
      round === 0
        ? basePayload
        : {
            model: OPENAI_MODEL,
            reasoning: { effort: 'medium' },
            tools: TOOL_DEFINITIONS,
            previous_response_id: previousResponseId,
            max_output_tokens: 1200,
            input: basePayload.input,
          }

    const result = await requestOpenAI(payload)
    if ('error' in result) {
      return { error: result.error }
    }

    const json = result.data
    const text = extractOpenAIText(json)
    const toolCalls = extractToolCalls(json)

    if (toolCalls.length === 0) {
      if (text) return { text }
      return { error: 'ИИ не вернул осмысленный ответ.' }
    }

    previousResponseId = typeof json?.id === 'string' ? json.id : null

    const toolOutputs = []
    for (const call of toolCalls) {
      const output = await executeToolCall(call, context)
      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(output),
      })
    }

    basePayload.input = toolOutputs

    if (!previousResponseId) {
      return { error: 'OpenAI не вернул id ответа для продолжения tool-цикла.' }
    }

    if (round === MAX_TOOL_ROUNDS - 1) {
      return text ? { text } : { error: 'ИИ не завершил цепочку tool-вызовов вовремя.' }
    }
  }

  return { error: 'ИИ не смог завершить ответ.' }
}
