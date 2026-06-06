import 'server-only'

export type AiMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AiUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  raw?: unknown
}

export type AiTextResult = {
  text: string
  provider: 'openai' | 'gemini'
  model: string
  usage?: AiUsage | null
}

type GenerateAiTextOptions = {
  messages: AiMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

type StreamAiTextOptions = GenerateAiTextOptions & {
  onDelta: (text: string) => void | Promise<void>
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
// gpt-4o вместо gpt-4o-mini: умнее во всех AI-фичах (чат-ассистент, прогнозы,
// разбор). Переопределяется env OPENAI_MODEL.
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

function extractOpenAiText(payload: any): string {
  return String(payload?.choices?.[0]?.message?.content || '').trim()
}

function extractGeminiText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((part: any) => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function shouldFallback(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

function openAiUsage(raw: any): AiUsage | null {
  const usage = raw?.usage
  if (!usage) return null
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    raw: usage,
  }
}

function geminiUsage(raw: any): AiUsage | null {
  const usage = raw?.usageMetadata
  if (!usage) return null
  return {
    prompt_tokens: usage.promptTokenCount,
    completion_tokens: usage.candidatesTokenCount,
    total_tokens: usage.totalTokenCount,
    raw: usage,
  }
}

async function callOpenAi(options: GenerateAiTextOptions): Promise<AiTextResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY не настроен на сервере.')

  const model = options.model || DEFAULT_OPENAI_MODEL
  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      // gpt-5* принимает только temperature=1 (дефолт) — для них параметр опускаем,
      // иначе OpenAI вернёт ошибку. Остальные модели — как задано.
      ...(model.startsWith('gpt-5') ? {} : { temperature: options.temperature }),
      max_completion_tokens: options.maxTokens,
      messages: options.messages,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.error) {
    const detail = payload?.error?.message || `OpenAI API error (${response.status})`
    const error = new Error(detail)
    ;(error as any).status = response.status
    throw error
  }

  const text = extractOpenAiText(payload)
  if (!text) throw new Error('OpenAI не вернул текст.')
  return { text, provider: 'openai', model, usage: openAiUsage(payload) }
}

function extractOpenAiStreamDelta(payload: any): string {
  const delta = payload?.choices?.[0]?.delta?.content
  return typeof delta === 'string' ? delta : ''
}

async function callOpenAiStream(options: StreamAiTextOptions): Promise<AiTextResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY не настроен на сервере.')

  const model = options.model || DEFAULT_OPENAI_MODEL
  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      // gpt-5* принимает только temperature=1 (дефолт) — для них параметр опускаем,
      // иначе OpenAI вернёт ошибку. Остальные модели — как задано.
      ...(model.startsWith('gpt-5') ? {} : { temperature: options.temperature }),
      max_completion_tokens: options.maxTokens,
      messages: options.messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  })

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    const error = new Error(detail || `OpenAI API error (${response.status})`)
    ;(error as any).status = response.status
    throw error
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage: AiUsage | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() || ''

    for (const event of events) {
      const dataLines = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      for (const dataLine of dataLines) {
        if (!dataLine || dataLine === '[DONE]') continue
        const parsed = JSON.parse(dataLine)
        if (parsed?.usage) usage = openAiUsage(parsed)
        const delta = extractOpenAiStreamDelta(parsed)
        if (!delta) continue
        text += delta
        await options.onDelta(delta)
      }
    }
  }

  if (!text.trim()) throw new Error('OpenAI не вернул текст.')
  return { text: text.trim(), provider: 'openai', model, usage }
}

function toGeminiPayload(messages: AiMessage[], options: GenerateAiTextOptions) {
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
    .trim()

  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }))

  return {
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: systemText || 'Ответь кратко.' }] }],
    generationConfig: {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
    },
  }
}

async function callGemini(options: GenerateAiTextOptions): Promise<AiTextResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY не настроен на сервере.')

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(toGeminiPayload(options.messages, options)),
    },
  )

  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `Gemini API error (${response.status})`)
  }

  const text = extractGeminiText(payload)
  if (!text) throw new Error('Gemini не вернул текст.')
  return { text, provider: 'gemini', model, usage: geminiUsage(payload) }
}

export async function generateAiText(options: GenerateAiTextOptions): Promise<AiTextResult> {
  const errors: string[] = []

  if (process.env.OPENAI_API_KEY) {
    try {
      return await callOpenAi(options)
    } catch (error: any) {
      errors.push(error?.message || String(error))
      if (error?.name === 'AbortError') throw error
      if (error?.status && !shouldFallback(Number(error.status))) {
        throw error
      }
    }
  } else {
    errors.push('OPENAI_API_KEY не настроен на сервере.')
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      return await callGemini(options)
    } catch (error: any) {
      errors.push(error?.message || String(error))
      if (error?.name === 'AbortError') throw error
    }
  } else {
    errors.push('GEMINI_API_KEY не настроен на сервере.')
  }

  throw new Error(errors.filter(Boolean).join(' | ') || 'AI provider не настроен.')
}

export async function streamAiText(options: StreamAiTextOptions): Promise<AiTextResult> {
  const errors: string[] = []

  if (process.env.OPENAI_API_KEY) {
    try {
      return await callOpenAiStream(options)
    } catch (error: any) {
      errors.push(error?.message || String(error))
      if (error?.name === 'AbortError') throw error
      if (error?.status && !shouldFallback(Number(error.status))) {
        throw error
      }
    }
  } else {
    errors.push('OPENAI_API_KEY не настроен на сервере.')
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await callGemini(options)
      await options.onDelta(result.text)
      return result
    } catch (error: any) {
      errors.push(error?.message || String(error))
      if (error?.name === 'AbortError') throw error
    }
  } else {
    errors.push('GEMINI_API_KEY не настроен на сервере.')
  }

  throw new Error(errors.filter(Boolean).join(' | ') || 'AI provider не настроен.')
}
