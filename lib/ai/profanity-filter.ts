/**
 * Двухступенчатый фильтр мата для команд-чата и DM.
 *
 * 1. Локальный regex — мгновенно ловит явный мат (0мс, бесплатно)
 * 2. AI-проверка — для замаскированного мата ("сýка" с y вместо у), сленга, оскорблений
 *
 * Использование в /api/team-chat и /api/direct-messages POST:
 *   const check = await checkProfanity(messageText)
 *   if (check.blocked) return 422 with check.reason
 */

import 'server-only'
import { generateAiText } from './provider'

// Базовый список основных матных корней. Регистр и пробелы — не важно (нормализуем).
// Не пытаемся быть полными — это первая линия защиты от очевидного.
const RU_MAT_ROOTS = [
  'хуй', 'хуе', 'хуя', 'пизд', 'ебал', 'ебать', 'ебут', 'ебан', 'еб@', 'бляд', 'блять',
  'мудак', 'мудил', 'сука', 'сучк', 'сучар', 'долб', 'мраз', 'гандон', 'хер',
  'пидор', 'пидар', 'педрил', 'педик', 'жоп',
  // Казахский
  'көт', 'қотақ', 'котак', 'шыбж',
]

// Приветливые подсказки чтобы пользователь понял что не так
const FRIENDLY_REASONS = [
  'Сообщение содержит нецензурную лексику. Переформулируй пожалуйста.',
  'Без мата, пожалуйста. Чат проверяется ИИ.',
  'Не пиши нецензурно — это рабочий чат.',
]

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0]/g, 'о')
    .replace(/[3]/g, 'з')
    .replace(/[4]/g, 'ч')
    .replace(/[6]/g, 'б')
    .replace(/[@]/g, 'а')
    .replace(/\s+/g, '')   // склеиваем пробелы внутри ("х у й" → "хуй")
    .replace(/[^а-яёқғүұӣəіңұһөә]/gi, '') // оставляем только кириллицу
}

export type ProfanityCheck = {
  blocked: boolean
  reason: string | null
  source: 'regex' | 'ai' | null
}

export function checkProfanityRegex(text: string): ProfanityCheck {
  if (!text || text.length < 2) return { blocked: false, reason: null, source: null }
  const norm = normalize(text)
  for (const root of RU_MAT_ROOTS) {
    if (norm.includes(root)) {
      return {
        blocked: true,
        reason: FRIENDLY_REASONS[Math.floor(Math.random() * FRIENDLY_REASONS.length)],
        source: 'regex',
      }
    }
  }
  return { blocked: false, reason: null, source: null }
}

/**
 * AI-проверка для замаскированного / неочевидного. Зовётся ТОЛЬКО если regex пропустил.
 * Результат: {blocked, reason}.
 */
export async function checkProfanityAI(text: string): Promise<ProfanityCheck> {
  if (!text.trim()) return { blocked: false, reason: null, source: null }

  // Если AI не настроен — пропускаем (regex уже сработал бы)
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return { blocked: false, reason: null, source: null }
  }

  try {
    const result = await generateAiText({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 30,
      messages: [
        {
          role: 'system',
          content: `Ты модератор корпоративного чата на русском/казахском.
Анализируй сообщение на нецензурную лексику, сильные оскорбления, угрозы.

Отвечай СТРОГО одним из двух:
- "OK" — если сообщение нормальное (даже если эмоциональное, грубоватое, но без мата и оскорблений)
- "BLOCK: <короткая причина>" — если есть мат, оскорбления, угрозы. Учитывай замаскированные формы (с цифрами вместо букв, символами).

Без markdown, без объяснений.`,
        },
        { role: 'user', content: text.slice(0, 500) },
      ],
    })
    const verdict = result.text.trim()
    if (verdict.toUpperCase().startsWith('BLOCK')) {
      const reason = verdict.split(':').slice(1).join(':').trim() || 'Замаскированный мат'
      return {
        blocked: true,
        reason: `Сообщение заблокировано: ${reason}. Переформулируй.`,
        source: 'ai',
      }
    }
    return { blocked: false, reason: null, source: null }
  } catch {
    // Если AI упал — не блокируем (fail-open)
    return { blocked: false, reason: null, source: null }
  }
}

/**
 * Полная проверка: regex + AI fallback.
 * AI вызывается только если regex не сработал и текст длиннее 5 символов.
 */
export async function checkProfanity(text: string, useAI: boolean = true): Promise<ProfanityCheck> {
  const fast = checkProfanityRegex(text)
  if (fast.blocked) return fast
  if (!useAI || text.trim().length < 5) {
    return { blocked: false, reason: null, source: null }
  }
  return await checkProfanityAI(text)
}
