/**
 * Invoice OCR + product matching using GPT-4o vision.
 * Used by the Telegram bot to parse invoice/receipt photos and match
 * products to the inventory database.
 */

export type ParsedInvoiceItem = {
  invoice_name: string
  quantity: number
  unit_cost: number
  total_cost: number
  barcode: string | null
}

export type ParsedInvoice = {
  items: ParsedInvoiceItem[]
  supplier_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  raw_text: string | null
}

export type MatchedInvoiceItem = ParsedInvoiceItem & {
  matched_item_id: string | null
  matched_item_name: string | null
  match_source: 'barcode' | 'mapping' | 'gpt' | null
}

type InventoryItemShort = {
  id: string
  name: string
  barcode: string
  unit: string
}

type NameMapping = {
  invoice_name: string
  item_id: string
  item_name?: string
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

/**
 * Download a Telegram file and return it as a base64 data URL.
 * file_path comes from Telegram getFile API.
 */
export async function downloadTelegramFileAsBase64(filePath: string): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured')

  const url = `https://api.telegram.org/file/bot${token}/${filePath}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download Telegram file: ${res.status}`)

  const buffer = await res.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const mime = filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') ? 'image/jpeg' : 'image/jpeg'
  return `data:${mime};base64,${base64}`
}

/**
 * Parse an invoice photo using GPT-4o vision.
 * Returns structured data extracted from the image.
 */
export async function parseInvoiceWithGPT(imageDataUrl: string, inventoryItems: InventoryItemShort[]): Promise<ParsedInvoice> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const itemsContext = inventoryItems
    .slice(0, 200)
    .map((it) => `ID:${it.id} | Штрихкод:${it.barcode} | Название:${it.name} | Ед:${it.unit}`)
    .join('\n')

  const systemPrompt = `Ты — система OCR для накладных и товарных чеков.
Извлеки данные из изображения накладной/чека и верни JSON.

Список товаров в базе данных:
${itemsContext}

Правила:
1. Извлеки все строки товаров с количеством и ценами
2. Для каждого товара попробуй найти совпадение в базе данных по штрихкоду или названию
3. Накладные могут быть на русском или казахском языке
4. Если штрихкод есть на накладной — используй его для поиска
5. unit_cost и total_cost в тенге (₸)
6. Если цена не указана — поставь 0
7. quantity должно быть числом > 0

Формат ответа (ТОЛЬКО JSON, без markdown):
{
  "items": [
    {
      "invoice_name": "название товара как в накладной",
      "quantity": число,
      "unit_cost": число,
      "total_cost": число,
      "barcode": "штрихкод или null"
    }
  ],
  "supplier_name": "название поставщика или null",
  "invoice_number": "номер накладной или null",
  "invoice_date": "дата в формате YYYY-MM-DD или null",
  "raw_text": "весь текст накладной одной строкой"
}`

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageDataUrl, detail: 'high' },
            },
            {
              type: 'text',
              text: systemPrompt,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`OpenAI API error: ${response.status} ${err}`)
  }

  const result = await response.json()
  const content = result?.choices?.[0]?.message?.content || ''

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()

  try {
    return JSON.parse(cleaned) as ParsedInvoice
  } catch {
    throw new Error(`GPT returned invalid JSON: ${content.slice(0, 200)}`)
  }
}

/**
 * Match parsed invoice items to inventory items.
 * Priority: 1. barcode match 2. learned mapping 3. GPT suggestion (already embedded in invoice_name → item name similarity).
 */
export function matchInvoiceItems(
  parsedItems: ParsedInvoiceItem[],
  inventoryItems: InventoryItemShort[],
  mappings: NameMapping[],
): MatchedInvoiceItem[] {
  const barcodeMap = new Map(inventoryItems.map((it) => [it.barcode, it]))
  const mappingMap = new Map(mappings.map((m) => [m.invoice_name.toLowerCase(), m]))

  return parsedItems.map((item) => {
    // 1. Try barcode match
    if (item.barcode) {
      const found = barcodeMap.get(item.barcode)
      if (found) {
        return { ...item, matched_item_id: found.id, matched_item_name: found.name, match_source: 'barcode' as const }
      }
    }

    // 2. Try learned name mapping
    const mappingKey = item.invoice_name.toLowerCase()
    const mapping = mappingMap.get(mappingKey)
    if (mapping) {
      const foundItem = inventoryItems.find((it) => it.id === mapping.item_id)
      return {
        ...item,
        matched_item_id: mapping.item_id,
        matched_item_name: foundItem?.name || mapping.item_name || null,
        match_source: 'mapping' as const,
      }
    }

    // 3. Try fuzzy name match (simple contains check)
    const searchName = item.invoice_name.toLowerCase()
    const fuzzy = inventoryItems.find((it) => {
      const n = it.name.toLowerCase()
      return n.includes(searchName) || searchName.includes(n)
    })
    if (fuzzy) {
      return { ...item, matched_item_id: fuzzy.id, matched_item_name: fuzzy.name, match_source: 'gpt' as const }
    }

    return { ...item, matched_item_id: null, matched_item_name: null, match_source: null }
  })
}

/**
 * Build a human-readable confirmation message for Telegram.
 */
export function buildInvoiceConfirmationText(
  matchedItems: MatchedInvoiceItem[],
  invoice: ParsedInvoice,
  warehouseName: string,
): string {
  const matched = matchedItems.filter((it) => it.matched_item_id)
  const unmatched = matchedItems.filter((it) => !it.matched_item_id)

  const totalAmount = matched.reduce((sum, it) => sum + (it.total_cost || it.quantity * it.unit_cost), 0)

  const lines: string[] = [
    '<b>📦 Накладная распознана</b>',
    '',
  ]

  if (invoice.supplier_name) lines.push(`🏢 Поставщик: <b>${invoice.supplier_name}</b>`)
  if (invoice.invoice_number) lines.push(`📋 Накладная: <b>${invoice.invoice_number}</b>`)
  if (invoice.invoice_date) lines.push(`📅 Дата: <b>${invoice.invoice_date}</b>`)
  lines.push(`🏪 Склад: <b>${warehouseName}</b>`)
  lines.push('')

  if (matched.length > 0) {
    lines.push(`<b>✅ Распознано товаров: ${matched.length}</b>`)
    for (const item of matched) {
      const cost = item.total_cost || item.quantity * item.unit_cost
      const src = item.match_source === 'barcode' ? '🔍' : item.match_source === 'mapping' ? '📖' : '🤖'
      lines.push(`${src} ${item.matched_item_name} — ${item.quantity} шт × ${item.unit_cost.toLocaleString('ru-RU')} ₸`)
      if (item.invoice_name.toLowerCase() !== (item.matched_item_name || '').toLowerCase()) {
        lines.push(`   <i>Из накладной: «${item.invoice_name}»</i>`)
      }
      void cost
    }
    lines.push(`💰 Итого: <b>${totalAmount.toLocaleString('ru-RU')} ₸</b>`)
  }

  if (unmatched.length > 0) {
    lines.push('')
    lines.push(`<b>❓ Не найдено в базе: ${unmatched.length}</b>`)
    for (const item of unmatched) {
      lines.push(`• ${item.invoice_name} — ${item.quantity} шт`)
    }
    lines.push('<i>Эти товары будут пропущены при создании приёмки.</i>')
    lines.push('<i>Добавьте их в каталог, чтобы учитывать в будущем.</i>')
  }

  if (matched.length === 0) {
    lines.push('')
    lines.push('⚠️ Ни один товар не удалось сопоставить с базой данных.')
    lines.push('Добавьте товары в каталог или проверьте фото накладной.')
  }

  return lines.join('\n')
}
