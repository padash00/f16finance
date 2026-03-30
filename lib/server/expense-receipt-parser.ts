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

export async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  // Dynamic import to avoid build issues
  const pdfModule = await import('pdf-parse')
  const pdfParse = (pdfModule as any).default ?? pdfModule
  const data = await pdfParse(Buffer.from(buffer))
  return data.text?.trim() || ''
}
