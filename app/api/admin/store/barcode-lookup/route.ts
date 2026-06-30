import { NextResponse } from 'next/server'

import { generateAiText } from '@/lib/ai/provider'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}
function canManageStore(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

// EAN-13 префикс страны (короткий справочник, для подсказки происхождения).
function countryByPrefix(code: string): string | null {
  const p = code.slice(0, 3)
  const n = Number(p)
  if (!Number.isFinite(n)) return null
  if (n >= 0 && n <= 19) return 'США/Канада'
  if (n >= 30 && n <= 39) return 'США'
  if (n >= 460 && n <= 469) return 'Россия'
  if (p === '487') return 'Казахстан'
  if (p === '486') return 'Грузия'
  if (p === '481') return 'Беларусь'
  if (p === '482') return 'Украина'
  if (n >= 400 && n <= 440) return 'Германия'
  if (n >= 690 && n <= 699) return 'Китай'
  if (n >= 450 && n <= 459) return 'Япония'
  if (n >= 880 && n <= 880) return 'Южная Корея'
  return null
}

type Suggestion = {
  barcode: string
  name: string | null
  brand: string | null
  category_raw: string | null
  description: string | null
  image_url: string | null
  country: string | null
  source: string
}

// Поиск в Open Food Facts (бесплатно, без ключа). Хорошо для еды/напитков/снеков.
async function lookupOpenFoodFacts(code: string): Promise<Partial<Suggestion> | null> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_ru,generic_name,brands,categories,image_url`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OrdaPoint/1.0 (ordaops.kz)' },
      // не держим запрос вечно
      signal: AbortSignal.timeout(7000),
    })
    if (!res.ok) return null
    const j: any = await res.json().catch(() => null)
    if (!j || j.status !== 1 || !j.product) return null
    const p = j.product
    const name = String(p.product_name_ru || p.product_name || p.generic_name || '').trim()
    if (!name) return null
    return {
      name,
      brand: String(p.brands || '').split(',')[0]?.trim() || null,
      category_raw: String(p.categories || '').split(',').slice(-1)[0]?.trim() || null,
      image_url: String(p.image_url || '').trim() || null,
      source: 'openfoodfacts',
    }
  } catch {
    return null
  }
}

// UPCitemdb (бесплатный trial-эндпоинт, без ключа, ~лимит в день). Глобальная база,
// шире Open Food Facts — ловит и не-еду. Фолбэк, когда OFF не нашёл.
async function lookupUpcItemDb(code: string): Promise<Partial<Suggestion> | null> {
  try {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OrdaPoint/1.0 (ordaops.kz)' },
      signal: AbortSignal.timeout(7000),
    })
    if (!res.ok) return null
    const j: any = await res.json().catch(() => null)
    const item = j?.items?.[0]
    if (!item) return null
    const name = String(item.title || '').trim()
    if (!name) return null
    return {
      name,
      brand: String(item.brand || '').trim() || null,
      category_raw: String(item.category || '').split('>').slice(-1)[0]?.trim() || null,
      image_url: Array.isArray(item.images) ? String(item.images[0] || '').trim() || null : null,
      source: 'upcitemdb',
    }
  } catch {
    return null
  }
}

// AI причёсывает сырьё: перевод названия на русский, ближайшая из СУЩЕСТВУЮЩИХ
// категорий, короткое описание. Код товара AI НЕ передаём как «угадай» — только
// нормализуем уже найденные данные (иначе галлюцинации).
async function aiNormalize(
  raw: { name: string; brand: string | null; category_raw: string | null },
  categories: Array<{ id: string; name: string }>,
): Promise<{ name: string; category_id: string | null; description: string | null } | null> {
  try {
    const catList = categories.slice(0, 80).map((c) => `${c.id} = ${c.name}`).join('\n')
    const sys =
      'Ты помощник товароведа. Тебе дают НАЙДЕННЫЕ в базе данные о товаре (название, бренд, сырая категория). ' +
      'Верни СТРОГО JSON: {"name": "...", "category_id": "...|null", "description": "..."}. ' +
      'name — аккуратное название на русском (бренд + суть, без мусора). ' +
      'category_id — ID из списка существующих категорий, наиболее подходящий, или null если ничего не подходит (НЕ выдумывай). ' +
      'description — 1 короткое предложение по-русски. Ничего не придумывай сверх данных.'
    const user = `Данные:\nНазвание: ${raw.name}\nБренд: ${raw.brand || '—'}\nКатегория(сырая): ${raw.category_raw || '—'}\n\nСуществующие категории (id = название):\n${catList || '(нет)'}\n`
    const result = await generateAiText({ messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], maxTokens: 300 })
    const text = String(result.text || '')
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    const catId = parsed.category_id && categories.some((c) => c.id === parsed.category_id) ? String(parsed.category_id) : null
    return {
      name: String(parsed.name || raw.name).trim() || raw.name,
      category_id: catId,
      description: parsed.description ? String(parsed.description).trim() : null,
    }
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-catalog.view')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const code = String(url.searchParams.get('code') || '').replace(/\D/g, '')
    if (code.length < 8) return json({ error: 'Введите корректный штрихкод (EAN/GTIN)' }, 400)

    const country = countryByPrefix(code)
    const orgId = access.activeOrganization?.id || null

    // 1) Уже в каталоге этой орг?
    const companyScope = await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin })
    let localQ = supabase.from('inventory_items').select('id, name, category_id, category:category_id(id, name)').eq('barcode', code).limit(1)
    if (!access.isSuperAdmin && orgId) localQ = localQ.or(`organization_id.eq.${orgId},organization_id.is.null`)
    void companyScope
    const { data: local } = await localQ.maybeSingle()
    if (local) {
      const cat = Array.isArray((local as any).category) ? (local as any).category[0] : (local as any).category
      return json({ ok: true, data: { found: 'local', name: (local as any).name, category_id: (local as any).category_id || null, category_name: cat?.name || null, country, message: 'Такой штрихкод уже есть в каталоге' } })
    }

    // 2) Глобальный кэш?
    const { data: cached } = await supabase.from('barcode_cache').select('*').eq('barcode', code).maybeSingle()
    let suggestion: Suggestion | null = cached
      ? {
          barcode: code,
          name: (cached as any).name,
          brand: (cached as any).brand,
          category_raw: (cached as any).category_raw,
          description: (cached as any).description,
          image_url: (cached as any).image_url,
          country: (cached as any).country || country,
          source: (cached as any).source || 'cache',
        }
      : null

    // 3) Внешний поиск (если не было в кэше): Open Food Facts → UPCitemdb.
    if (!suggestion) {
      const external = (await lookupOpenFoodFacts(code)) || (await lookupUpcItemDb(code))
      if (external && external.name) {
        suggestion = {
          barcode: code,
          name: external.name || null,
          brand: external.brand || null,
          category_raw: external.category_raw || null,
          description: null,
          image_url: external.image_url || null,
          country,
          source: external.source || 'external',
        }
      }
    }

    if (!suggestion) {
      return json({ ok: true, data: { found: 'none', country, message: 'Товар не найден в открытых базах. Заполните вручную — он сохранится в каталоге.' } })
    }

    // 4) AI-нормализация (если есть имя и не из кэша уже причёсанного)
    let categoryId: string | null = null
    let categoryName: string | null = null
    if (!cached && suggestion.name) {
      const { data: cats } = await supabase
        .from('inventory_categories')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
      const catList = ((cats as any[]) || []).map((c) => ({ id: String(c.id), name: String(c.name) }))
      const norm = await aiNormalize({ name: suggestion.name, brand: suggestion.brand, category_raw: suggestion.category_raw }, catList)
      if (norm) {
        suggestion.name = norm.name
        suggestion.description = norm.description
        categoryId = norm.category_id
        categoryName = categoryId ? catList.find((c) => c.id === categoryId)?.name || null : null
      }

      // 5) Сохраняем в глобальный кэш (best-effort)
      await supabase
        .from('barcode_cache')
        .upsert(
          {
            barcode: code,
            name: suggestion.name,
            brand: suggestion.brand,
            category_raw: suggestion.category_raw,
            description: suggestion.description,
            image_url: suggestion.image_url,
            country: suggestion.country,
            source: suggestion.source,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'barcode' },
        )
        .then(() => {}, () => {})
    }

    return json({
      ok: true,
      data: {
        found: 'external',
        name: suggestion.name,
        brand: suggestion.brand,
        description: suggestion.description,
        image_url: suggestion.image_url,
        country: suggestion.country,
        category_id: categoryId,
        category_name: categoryName,
        source: suggestion.source,
      },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка распознавания' }, 500)
  }
}
