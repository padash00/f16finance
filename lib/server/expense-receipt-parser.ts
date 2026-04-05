/**
 * PDF receipt parser for expense entry via Telegram bot.
 * Extracts expense details from PDF text using GPT-4o.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

export type ParsedExpense = {
  amount: number
  payment_method: 'cash' | 'kaspi' | 'card' | 'unknown'
  category: string
  date: string // YYYY-MM-DD
  vendor: string | null
  comment: string | null
  raw_text: string
}

const KNOWN_CATEGORIES = [
  'Зарплата', 'Аванс', 'Электроэнергия', 'Аренда', 'Ремонт новой зоны',
  'Ремонт / техобслуживание', 'Хозтовары', 'Уборщица', 'Дворник',
  'Покупка ПК / апгрейд', 'Инкассация / эквайринг', 'Развозка персонала',
  'Закуп товара', 'Доставка', 'Интернет', 'Вода / питание', 'Реклама',
  'Кофе / расходники', 'FoodMaster', 'Списание / брак', 'Прочее',
]

export async function parseExpenseFromText(text: string, apiKey: string, today: string): Promise<ParsedExpense | null> {
  const prompt = `Ты — финансовый аналитик. Тебе дан текст из PDF-чека или квитанции.

Извлеки данные и верни строго JSON (без markdown, без пояснений):
{
  "amount": <число, общая сумма к оплате>,
  "payment_method": "cash" | "kaspi" | "card" | "unknown",
  "category": "<одна из категорий ниже или придумай подходящую>",
  "date": "<YYYY-MM-DD, дата из чека или если нет — ${today}>",
  "vendor": "<название организации/поставщика или null>",
  "comment": "<краткое описание что куплено/оплачено, 1-2 предложения или null>"
}

Категории (выбери наиболее подходящую):
${KNOWN_CATEGORIES.join(', ')}

Текст чека:
${text.slice(0, 3000)}`

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        max_tokens: 400,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content?.trim() || ''
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim())
    return { ...json, raw_text: text.slice(0, 500) }
  } catch {
    return null
  }
}

// Parse expense receipt from photo using GPT-4o vision
export async function parseExpenseFromImage(imageDataUrl: string, apiKey: string, today: string): Promise<ParsedExpense | null> {
  const prompt = `Ты — финансовый аналитик. На фото — чек или квитанция об оплате.

Извлеки данные и верни строго JSON (без markdown):
{
  "amount": <итоговая сумма числом>,
  "payment_method": "cash" | "kaspi" | "card" | "unknown",
  "category": "<категория из списка ниже>",
  "date": "<YYYY-MM-DD, дата из чека или ${today} если нет>",
  "vendor": "<название организации/магазина или null>",
  "comment": "<что куплено/оплачено, кратко или null>"
}

Категории: ${KNOWN_CATEGORIES.join(', ')}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 400,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          ],
        }],
      }),
    })
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content?.trim() || ''
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim())
    return { ...json, raw_text: '' }
  } catch { return null }
}

export function extractTextFromPdf(buffer: ArrayBuffer): string {
  const buf = Buffer.from(buffer)
  const str = buf.toString('binary')
  const texts: string[] = []

  // Extract text from PDF BT...ET blocks (standard text streams)
  const btEtRegex = /BT\s*([\s\S]*?)ET/g
  let btMatch
  while ((btMatch = btEtRegex.exec(str)) !== null) {
    const block = btMatch[1]
    // Tj operator: (text) Tj
    const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g
    let m
    while ((m = tjRegex.exec(block)) !== null) {
      const decoded = m[1]
        .replace(/\\n/g, '\n').replace(/\\r/g, ' ').replace(/\\t/g, ' ')
        .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\(.)/g, '$1')
      if (decoded.trim()) texts.push(decoded.trim())
    }
    // TJ operator: [(text) ...] TJ
    const tjArrRegex = /\[((?:[^[\]]*|\[[^\]]*\])*)\]\s*TJ/g
    while ((m = tjArrRegex.exec(block)) !== null) {
      const inner = m[1]
      const strParts = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g
      let sm
      while ((sm = strParts.exec(inner)) !== null) {
        const part = sm[1].replace(/\\(.)/g, '$1').trim()
        if (part) texts.push(part)
      }
    }
  }

  // Fallback: extract readable ASCII sequences if nothing found
  if (texts.length === 0) {
    const readableRegex = /[\x20-\x7E]{6,}/g
    let m
    while ((m = readableRegex.exec(str)) !== null) {
      const chunk = m[0].trim()
      if (chunk && !chunk.startsWith('/') && !chunk.startsWith('stream')) {
        texts.push(chunk)
      }
    }
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim()
}
