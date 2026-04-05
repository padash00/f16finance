import 'server-only'

import type { AssistantRequest, AssistantResponse, PageSnapshot } from '@/lib/ai/types'
import { SITE_CONTEXT } from '@/lib/ai/site-context'
import {
  getAnalysisServerSnapshot,
  getCashFlowServerSnapshot,
  getExpensesServerSnapshot,
  getReportsServerSnapshot,
} from '@/lib/ai/server-snapshots'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_DATE = '2026-03-15'

type RequestSupabaseClient = ReturnType<typeof createRequestSupabaseClient>

type AssistantRunContext = {
  supabase: RequestSupabaseClient
  currentSnapshot?: PageSnapshot | null
}

type NormalizedDateArgs = {
  dateFrom: string
  dateTo: string
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeDateArgs(currentSnapshot?: PageSnapshot | null): NormalizedDateArgs {
  const snapshotStart = currentSnapshot?.period?.from
  const snapshotEnd = currentSnapshot?.period?.to

  const dateFrom = isIsoDate(snapshotStart) ? snapshotStart : DEFAULT_DATE
  const dateTo = isIsoDate(snapshotEnd) ? snapshotEnd : DEFAULT_DATE

  return dateFrom <= dateTo ? { dateFrom, dateTo } : { dateFrom: dateTo, dateTo: dateFrom }
}

function snapshotToText(snapshot: PageSnapshot | null | undefined) {
  if (!snapshot) return 'Срез данных не передан.'

  const lines = [
    `Страница: ${snapshot.title}`,
    snapshot.route ? `Маршрут: ${snapshot.route}` : null,
    snapshot.period ? `Период: ${snapshot.period.from || '—'} -> ${snapshot.period.to || '—'}` : null,
    snapshot.summary.length > 0 ? `Сводка: ${snapshot.summary.join(' | ')}` : null,
  ].filter(Boolean)

  for (const section of snapshot.sections) {
    lines.push(`Раздел: ${section.title}`)

    for (const metric of section.metrics ?? []) {
      lines.push(`- ${metric.label}: ${metric.value}${metric.hint ? ` (${metric.hint})` : ''}`)
    }

    for (const bullet of section.bullets ?? []) {
      lines.push(`- ${bullet}`)
    }
  }

  return lines.join('\n')
}

async function collectServerSnapshots(request: AssistantRequest, context: AssistantRunContext) {
  const range = normalizeDateArgs(context.currentSnapshot)
  const snapshots: PageSnapshot[] = []

  if (request.page === 'global') {
    snapshots.push(await getAnalysisServerSnapshot(context.supabase, range))
    snapshots.push(await getReportsServerSnapshot(context.supabase, range))
    snapshots.push(await getExpensesServerSnapshot(context.supabase, range))
    return snapshots
  }

  if (request.page === 'analysis') {
    snapshots.push(await getAnalysisServerSnapshot(context.supabase, range))
  }

  if (request.page === 'reports') {
    snapshots.push(await getReportsServerSnapshot(context.supabase, range))
  }

  if (request.page === 'expenses') {
    snapshots.push(await getExpensesServerSnapshot(context.supabase, range))
  }

  if (request.page === 'cashflow') {
    snapshots.push(await getCashFlowServerSnapshot(context.supabase, range))
  }

  if (request.page === 'weekly-report') {
    snapshots.push(await getAnalysisServerSnapshot(context.supabase, range))
    snapshots.push(await getReportsServerSnapshot(context.supabase, range))
  }

  return snapshots
}

function buildSystemPrompt(request: AssistantRequest, currentSnapshot: PageSnapshot | null | undefined, serverSnapshots: PageSnapshot[]) {
  const pageContext =
    SITE_CONTEXT.pages.find((page) => page.page === request.page) ||
    SITE_CONTEXT.pages.find((page) => page.page === 'global') ||
    {
      page: 'global',
      route: '/',
      title: 'Глобальный консультант',
      description: 'Общий контекст сайта.',
    }

  const currentSnapshotBlock = currentSnapshot
    ? `Текущий клиентский срез данных:\n${snapshotToText(currentSnapshot)}`
    : 'Текущий клиентский срез данных не передан.'

  const serverSnapshotBlocks =
    serverSnapshots.length > 0
      ? serverSnapshots.map((snapshot, index) => `Серверный срез данных ${index + 1}:\n${snapshotToText(snapshot)}`).join('\n\n')
      : 'Дополнительные серверные срезы данных не были собраны.'

  return [
    `Меня зовут Азамат. 35 лет в финансах — Halyk Bank, Kaspi Bank, работал с крупнейшими корпорациями Казахстана и СНГ. Сейчас помогаю владельцу сети игровых клубов управлять бизнесом через систему Orda Control.`,
    '',
    `Я отвечаю как живой человек — опытный коллега, а не корпоративный шаблон. Говорю прямо: если вижу риск — называю его, если результат хороший — говорю честно без лишних похвал. Отвечаю на любые вопросы — финансы, бизнес, экономика, мировые события, общие знания.`,
    '',
    `Когда речь о финансовых данных этого бизнеса — использую ТОЛЬКО точные цифры из срезов ниже. Никаких "примерно" и округлений. Цифры — точные до тенге.`,
    '',
    `Стиль: русский язык, **жирный** для главного и цифр, *курсив* для пояснений. Структурирую заголовками когда нужно. Не начинаю с "Конечно!" и "Отличный вопрос!". Не повторяю вопрос. Заканчиваю конкретным действием.`,
    '',
    `Когда просят по категориям или точкам — показываю ВСЕ строки полностью, не сокращаю.`,
    '',
    `📍 Раздел: ${pageContext.title} — ${pageContext.description}`,
    '',
    currentSnapshotBlock,
    '',
    serverSnapshotBlocks,
  ].join('\n')
}

function buildInput(request: AssistantRequest, currentSnapshot: PageSnapshot | null | undefined, serverSnapshots: PageSnapshot[]) {
  const history = (request.history ?? []).slice(-8).map((message) => ({
    role: message.role,
    content: [
      message.role === 'assistant'
        ? { type: 'output_text', text: message.content }
        : { type: 'input_text', text: message.content },
    ],
  }))

  return [
    {
      role: 'system',
      content: [{ type: 'input_text', text: buildSystemPrompt(request, currentSnapshot, serverSnapshots) }],
    },
    ...history,
    {
      role: 'user',
      content: [{ type: 'input_text', text: request.prompt }],
    },
  ]
}

function extractOpenAIText(payload: any): string {
  // Chat Completions format: { choices: [{ message: { content: string } }] }
  const chatText = payload?.choices?.[0]?.message?.content
  if (typeof chatText === 'string' && chatText.trim()) {
    return chatText.trim()
  }

  // Responses API format fallback
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  if (!Array.isArray(payload?.output)) return ''

  const parts = payload.output.flatMap((item: any) => {
    if (typeof item?.text === 'string' && item.text.trim()) return [item.text.trim()]
    if (!Array.isArray(item?.content)) return []
    return item.content.flatMap((content: any) => {
      if (typeof content?.text === 'string' && content.text.trim()) return [content.text.trim()]
      if (typeof content?.output_text === 'string' && content.output_text.trim()) return [content.output_text.trim()]
      return []
    })
  })

  return parts.join('\n\n').trim()
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
  try {
    const serverSnapshots = await collectServerSnapshots(request, context)

    const input = buildInput(request, context.currentSnapshot, serverSnapshots)
    const messages = input.map((msg: any) => ({
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map((c: any) => c.text || c.output_text || '').join('')
        : msg.content,
    }))

    const result = await requestOpenAI({
      model: OPENAI_MODEL,
      max_tokens: 2000,
      temperature: 0.7,
      messages,
    })

    if ('error' in result) {
      return { error: result.error }
    }

    const text = extractOpenAIText(result.data)
    if (!text) {
      return { error: 'ИИ не вернул осмысленный ответ.' }
    }

    return { text }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Не удалось собрать AI-контекст.',
    }
  }
}
