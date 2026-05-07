import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  receipt_file_url?: string
}

function detectMimeFromUrl(url: string) {
  const lower = url.toLowerCase()
  if (lower.includes('.png')) return 'image/png'
  if (lower.includes('.webp')) return 'image/webp'
  if (lower.includes('.pdf')) return 'application/pdf'
  return 'image/jpeg'
}

async function urlToDataUrl(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Не удалось скачать чек (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const mime = detectMimeFromUrl(url)
  const base64 = Buffer.from(bytes).toString('base64')
  return { dataUrl: `data:${mime};base64,${base64}`, mime }
}

function parseAiJson<T>(text: string): T {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  return JSON.parse(cleaned) as T
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const ip = getClientIp(req)
    const rl = checkRateLimit(`ai-payment-receipt-parse:${access.user?.id || ip}`, 30, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as Body | null
    const fileUrl = String(body?.receipt_file_url || '').trim()
    if (!fileUrl) return json({ error: 'receipt_file_url обязателен' }, 400)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return json({ error: 'OPENAI_API_KEY не настроен' }, 500)

    const fileData = await urlToDataUrl(fileUrl)
    if (fileData.mime === 'application/pdf') {
      return json({ error: 'PDF-чеки распознаются позже — сейчас только фото' }, 400)
    }

    const prompt = `Извлеки данные из чека об оплате (Kaspi, банковский, фискальный) и верни ТОЛЬКО JSON.
Формат:
{
  "total_amount": число (в тенге),
  "paid_at": "YYYY-MM-DD" (дата платежа на чеке) или null,
  "payment_method": "cash" | "kaspi" | "card" | null,
  "merchant": "наименование получателя или null",
  "raw_text": "краткий текст чека"
}
Правила:
- Если в чеке есть Kaspi-логотип, перевод по номеру или иконка приложения — "kaspi".
- Если касса/наличные — "cash".
- Если банковская карта — "card".
- Если непонятно — null.
- Сумма всегда в тенге, число без пробелов и разделителей тысяч.`

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_completion_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: fileData.dataUrl, detail: 'high' } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })
    const openaiJson = await openaiRes.json().catch(() => null)
    if (!openaiRes.ok || openaiJson?.error) {
      const message = openaiJson?.error?.message || `OpenAI error (${openaiRes.status})`
      return json({ error: message }, 500)
    }

    const content = String(openaiJson?.choices?.[0]?.message?.content || '').trim()
    let parsed: { total_amount?: number; paid_at?: string | null; payment_method?: string | null; merchant?: string | null; raw_text?: string } | null = null
    try {
      parsed = parseAiJson(content)
    } catch {
      return json({ error: 'ИИ вернул некорректный JSON' }, 502)
    }

    await logAiUsageSafe(access.supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/admin/store/receipts/ai-parse-payment-receipt',
      model: 'gpt-4o',
      payload: { mime: fileData.mime },
    })

    const method = parsed?.payment_method
    const normalizedMethod: 'cash' | 'kaspi' | null =
      method === 'kaspi' ? 'kaspi' : method === 'cash' ? 'cash' : method === 'card' ? 'kaspi' : null

    return json({
      ok: true,
      data: {
        total_amount: parsed?.total_amount != null ? Number(parsed.total_amount) : null,
        paid_at: parsed?.paid_at || null,
        payment_method: normalizedMethod,
        merchant: parsed?.merchant || null,
        raw_text: parsed?.raw_text || null,
      },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось распознать чек' }, 500)
  }
}
