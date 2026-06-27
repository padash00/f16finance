import { NextResponse } from 'next/server'

import { checkRateLimit } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { isStoreManager } from '@/lib/server/store-access'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Несколько фото по штрихкоду из UPCitemdb (массив images).
async function fromUpcItemDb(code: string): Promise<string[]> {
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, {
      headers: { 'User-Agent': 'OrdaPoint/1.0 (ordaops.kz)' },
      signal: AbortSignal.timeout(7000),
    })
    if (!res.ok) return []
    const j: any = await res.json().catch(() => null)
    const imgs = j?.items?.[0]?.images
    return Array.isArray(imgs) ? imgs.map((u: any) => String(u || '')).filter(Boolean) : []
  } catch {
    return []
  }
}

// Фото по штрихкоду из Open Food Facts.
async function fromOpenFoodFacts(code: string): Promise<string[]> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=image_url,image_front_url`, {
      headers: { 'User-Agent': 'OrdaPoint/1.0 (ordaops.kz)' },
      signal: AbortSignal.timeout(7000),
    })
    if (!res.ok) return []
    const j: any = await res.json().catch(() => null)
    const p = j?.product
    if (!p) return []
    return [p.image_front_url, p.image_url].map((u: any) => String(u || '')).filter(Boolean)
  } catch {
    return []
  }
}

// Поиск картинок по НАЗВАНИЮ через Google Custom Search (нужны env GOOGLE_CSE_KEY + GOOGLE_CSE_ID).
async function fromGoogle(query: string): Promise<string[]> {
  const key = process.env.GOOGLE_CSE_KEY
  const cx = process.env.GOOGLE_CSE_ID
  if (!key || !cx || !query) return []
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&searchType=image&num=8&safe=active&q=${encodeURIComponent(query)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const j: any = await res.json().catch(() => null)
    return Array.isArray(j?.items) ? j.items.map((i: any) => String(i?.link || '')).filter(Boolean) : []
  } catch {
    return []
  }
}

// GET ?code=<штрихкод>&name=<название> → { images: [url...] }. Кандидаты для выбора фото.
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!isStoreManager(access)) return json({ error: 'forbidden' }, 403)

    const rl = checkRateLimit(`img-search:${access.user?.id || 'anon'}`, 30, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    const url = new URL(request.url)
    const code = String(url.searchParams.get('code') || '').replace(/\D/g, '')
    const name = String(url.searchParams.get('name') || '').trim()

    const buckets: string[][] = []
    if (code.length >= 8) {
      const [a, b] = await Promise.all([fromUpcItemDb(code), fromOpenFoodFacts(code)])
      buckets.push(a, b)
    }
    if (name) buckets.push(await fromGoogle(name))

    const seen = new Set<string>()
    const images = buckets.flat().filter((u) => u && !seen.has(u) && (seen.add(u), true)).slice(0, 12)

    return json({
      ok: true,
      images,
      googleEnabled: !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID),
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка поиска изображений' }, 500)
  }
}
