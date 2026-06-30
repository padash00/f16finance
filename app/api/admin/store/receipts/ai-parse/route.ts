import { NextResponse } from 'next/server'
import { PDFParse } from 'pdf-parse'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { matchInvoiceItems, parseInvoiceWithGPT, type ParsedInvoice } from '@/lib/server/invoice-parser'
import { fetchInventoryItemsForMatching, fetchInvoiceNameMappings } from '@/lib/server/repositories/invoice'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  invoice_file_url?: string
  supplier_id?: string | null
}

type CogsSuggestion = {
  recommended_category_id: string | null
  recommended_category_name: string | null
  reason: string | null
  confidence: 'high' | 'medium' | 'low' | null
  alternatives: Array<{ id: string; name: string }>
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
  if (!response.ok) throw new Error(`Не удалось скачать файл накладной (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const mime = detectMimeFromUrl(url)
  const base64 = Buffer.from(bytes).toString('base64')
  return { dataUrl: `data:${mime};base64,${base64}`, bytes, mime }
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

async function suggestCogsCategory(params: {
  apiKey: string
  model: string
  categories: Array<{ id: string; name: string }>
  supplierName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  parsedItems: Array<{ invoice_name: string; quantity: number; unit_cost: number; total_cost: number }>
}): Promise<CogsSuggestion> {
  try {
    if (!params.categories.length) {
      return { recommended_category_id: null, recommended_category_name: null, reason: null, confidence: null, alternatives: [] }
    }
    const categoriesBlock = params.categories.map((c) => `- ${c.id} | ${c.name}`).join('\n')
    const itemsBlock = params.parsedItems
      .slice(0, 40)
      .map((it) => `- ${it.invoice_name} | qty=${it.quantity} | unit=${it.unit_cost} | total=${it.total_cost}`)
      .join('\n')

    const prompt = [
      'Выбери наиболее подходящую категорию COGS из списка для данной приемки.',
      'Верни только JSON: {"recommended_category_id":"...", "alternatives":["id1","id2"], "confidence":"high|medium|low", "reason":"..."}',
      'Нельзя придумывать id, бери только из списка.',
      'alternatives: до 2 id, не дублируй recommended_category_id.',
      '',
      `Поставщик: ${params.supplierName || '(не указан)'}`,
      `Накладная: ${params.invoiceNumber || '(не указан)'}`,
      `Дата: ${params.invoiceDate || '(не указана)'}`,
      '',
      'Строки накладной:',
      itemsBlock || '(строк нет)',
      '',
      'Категории COGS:',
      categoriesBlock,
    ].join('\n')

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        ...(params.model.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.1 }),
        max_completion_tokens: 220,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const openaiJson = await openaiRes.json().catch(() => null)
    if (!openaiRes.ok || openaiJson?.error) {
      return { recommended_category_id: null, recommended_category_name: null, reason: null, confidence: null, alternatives: [] }
    }
    const content = String(openaiJson?.choices?.[0]?.message?.content || '').trim()
    const parsed = parseAiJson<{ recommended_category_id?: string; alternatives?: string[]; confidence?: string; reason?: string }>(content)
    const pickedId = String(parsed?.recommended_category_id || '').trim()
    const found = params.categories.find((c) => c.id === pickedId) || null
    if (!found) return { recommended_category_id: null, recommended_category_name: null, reason: null, confidence: null, alternatives: [] }
    const altIds = Array.isArray(parsed?.alternatives)
      ? parsed.alternatives.map((v) => String(v || '').trim()).filter(Boolean)
      : []
    const alternatives = altIds
      .filter((id) => id && id !== found.id)
      .map((id) => params.categories.find((c) => c.id === id))
      .filter((row): row is { id: string; name: string } => !!row)
      .slice(0, 2)
    const parsedConfidence = String(parsed?.confidence || '').trim().toLowerCase()
    const confidence: 'high' | 'medium' | 'low' | null =
      parsedConfidence === 'high' || parsedConfidence === 'medium' || parsedConfidence === 'low'
        ? (parsedConfidence as 'high' | 'medium' | 'low')
        : alternatives.length > 0
          ? 'medium'
          : 'high'
    return {
      recommended_category_id: found.id,
      recommended_category_name: found.name,
      reason: String(parsed?.reason || '').trim() || null,
      confidence,
      alternatives,
    }
  } catch {
    return { recommended_category_id: null, recommended_category_name: null, reason: null, confidence: null, alternatives: [] }
  }
}

async function parseInvoiceFromPdfText(pdfBytes: Uint8Array): Promise<ParsedInvoice> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const parser = new PDFParse({ data: Buffer.from(pdfBytes) })
  let parsedPdf: { text?: string } | null = null
  try {
    parsedPdf = await parser.getText()
  } finally {
    await parser.destroy()
  }
  const rawText = String(parsedPdf?.text || '').trim()
  if (!rawText || rawText.length < 20) {
    throw new Error('PDF пустой или текст не распознан. Попробуйте фото накладной.')
  }

  const prompt = [
    'Извлеки данные накладной из текста и верни только JSON без пояснений.',
    'Формат строго:',
    '{"items":[{"invoice_name":"...", "quantity":1, "unit_cost":0, "total_cost":0, "barcode":null}], "supplier_name":"...", "invoice_number":"...", "invoice_date":"YYYY-MM-DD или null", "raw_text":"..."}',
    'Правила:',
    '- quantity число > 0, если не найдено ставь 1.',
    '- unit_cost и total_cost числа >= 0.',
    '- Если total_cost нет, можно quantity * unit_cost.',
    '- barcode либо строка, либо null.',
    '- raw_text верни кратко (до 2000 символов).',
    '',
    'Текст документа:',
    rawText.slice(0, 20000),
  ].join('\n')

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      ...(model.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.1 }),
      max_completion_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const openaiJson = await openaiRes.json().catch(() => null)
  if (!openaiRes.ok || openaiJson?.error) {
    throw new Error(openaiJson?.error?.message || `OpenAI error (${openaiRes.status})`)
  }

  const content = String(openaiJson?.choices?.[0]?.message?.content || '').trim()
  const parsed = parseAiJson<ParsedInvoice>(content)
  const items = Array.isArray(parsed?.items) ? parsed.items : []
  return {
    items: items.map((item: any) => ({
      invoice_name: String(item?.invoice_name || '').trim(),
      quantity: Number(item?.quantity || 0),
      unit_cost: Number(item?.unit_cost || 0),
      total_cost: Number(item?.total_cost || 0),
      barcode: item?.barcode ? String(item.barcode) : null,
    })).filter((item) => item.invoice_name && item.quantity > 0),
    supplier_name: parsed?.supplier_name ? String(parsed.supplier_name) : null,
    invoice_number: parsed?.invoice_number ? String(parsed.invoice_number) : null,
    invoice_date: parsed?.invoice_date ? String(parsed.invoice_date) : null,
    raw_text: parsed?.raw_text ? String(parsed.raw_text).slice(0, 2000) : rawText.slice(0, 2000),
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-receipts.ai_parse')
    if (denied) return denied

    const ip = getClientIp(req)
    const rl = checkRateLimit(`ai-store-receipts-parse:${access.user?.id || ip}`, 30, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const body = (await req.json().catch(() => null)) as Body | null
    const invoiceFileUrl = String(body?.invoice_file_url || '').trim()
    if (!invoiceFileUrl) return json({ error: 'invoice_file_url обязателен' }, 400)
    const supplierId = String(body?.supplier_id || '').trim() || null

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const orgId = access.activeOrganization?.id || null
    const matchScope = { organizationId: orgId, supplierId }

    // Изоляция: поставщик читается только в своей орг (раньше — по присланному id без орг).
    let supplierQuery: any = Promise.resolve({ data: null })
    if (supplierId) {
      let sq = supabase.from('inventory_suppliers').select('id, name, organization_name').eq('id', supplierId)
      if (orgId) sq = sq.eq('organization_id', orgId)
      supplierQuery = sq.maybeSingle()
    }
    const [inventoryItems, nameMappings, fileData, supplierRow] = await Promise.all([
      fetchInventoryItemsForMatching(supabase as any, { organizationId: orgId }),
      fetchInvoiceNameMappings(supabase as any, matchScope),
      urlToDataUrl(invoiceFileUrl),
      supplierQuery,
    ])
    const apiKey = process.env.OPENAI_API_KEY
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const supplierAliases = supplierId
      ? nameMappings
          .filter((m) => m.supplier_id && String(m.supplier_id) === String(supplierId))
          .map((m) => ({
            raw_name: m.invoice_name,
            item_id: m.item_id,
            item_name: m.item_name,
            last_unit_cost: m.last_unit_cost ?? null,
          }))
      : []
    const supplierName: string | null = supplierRow && (supplierRow as any).data
      ? ((supplierRow as any).data?.organization_name || (supplierRow as any).data?.name || null)
      : null

    const parsed = fileData.mime === 'application/pdf'
      ? await parseInvoiceFromPdfText(fileData.bytes)
      : await parseInvoiceWithGPT(fileData.dataUrl, inventoryItems, { supplierAliases, supplierName })
    const matched = matchInvoiceItems(parsed.items || [], inventoryItems, nameMappings, { supplierId })
    const cogsRes = await supabase
      .from('expense_categories')
      .select('id,name,accounting_group')
      .order('name', { ascending: true })
    const cogsCategories = (cogsRes.data || [])
      .filter((row: any) => String(row?.accounting_group || '').trim().toLowerCase() === 'cogs')
      .map((row: any) => ({ id: String(row.id), name: String(row.name || '').trim() }))
      .filter((row) => row.id && row.name)
    const cogsSuggestion = apiKey
      ? await suggestCogsCategory({
          apiKey,
          model,
          categories: cogsCategories,
          supplierName: parsed.supplier_name || null,
          invoiceNumber: parsed.invoice_number || null,
          invoiceDate: parsed.invoice_date || null,
          parsedItems: (parsed.items || []).map((item) => ({
            invoice_name: item.invoice_name,
            quantity: Number(item.quantity || 0),
            unit_cost: Number(item.unit_cost || 0),
            total_cost: Number(item.total_cost || 0),
          })),
        })
      : { recommended_category_id: null, recommended_category_name: null, reason: null, confidence: null, alternatives: [] }

    const matchedCount = matched.filter((item) => !!item.matched_item_id).length
    const unmatchedCount = matched.length - matchedCount
    const total = matched.reduce((sum, item) => sum + Number(item.total_cost || Number(item.quantity || 0) * Number(item.unit_cost || 0)), 0)

    await logAiUsageSafe(supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/admin/store/receipts/ai-parse',
      model,
      payload: { mime: fileData.mime, matchedCount, unmatchedCount },
    })

    return json({
      ok: true,
      data: {
        supplier_name: parsed.supplier_name || null,
        invoice_number: parsed.invoice_number || null,
        invoice_date: parsed.invoice_date || null,
        raw_text: parsed.raw_text || null,
        total_amount: total,
        matched_count: matchedCount,
        unmatched_count: unmatchedCount,
        cogs_suggestion: cogsSuggestion,
        items: matched.map((item) => ({
          invoice_name: item.invoice_name,
          quantity: Number(item.quantity || 0),
          unit_cost: Number(item.unit_cost || 0),
          total_cost: Number(item.total_cost || 0),
          barcode: item.barcode || null,
          matched_item_id: item.matched_item_id || null,
          matched_item_name: item.matched_item_name || null,
          match_source: item.match_source || null,
          last_unit_cost: item.last_unit_cost ?? null,
          last_sale_price: item.last_sale_price ?? null,
          unit_cost_change_pct: item.unit_cost_change_pct ?? null,
        })),
      },
    })
  } catch (error: any) {
    const access = await getRequestAccessContext(req).catch(() => null)
    if (access && !('response' in access)) {
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/admin/store/receipts/ai-parse',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        status: 'error',
        error: error?.message || String(error),
      })
    }
    return json({ error: error?.message || 'Не удалось распознать накладную' }, 500)
  }
}
