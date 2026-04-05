import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id')?.trim()
    const locationId = url.searchParams.get('location_id')?.trim() || null

    if (!companyId) return json({ error: 'company_id-required' }, 400)
    await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      requestedCompanyId: companyId,
    })

    const supabase = createAdminSupabaseClient()

    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0]

    // Fetch today's and yesterday's sales total
    const [todayRes, yesterdayRes] = await Promise.all([
      supabase
        .from('point_sales')
        .select('total_amount')
        .eq('company_id', companyId)
        .eq('sale_date', today),
      supabase
        .from('point_sales')
        .select('total_amount')
        .eq('company_id', companyId)
        .eq('sale_date', yesterday),
    ])

    const todayTotal = (todayRes.data || []).reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
    const yesterdayTotal = (yesterdayRes.data || []).reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
    const changePercent = yesterdayTotal > 0
      ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)
      : 0

    // Fetch today's sale IDs for this company
    const todaySaleIds = (todayRes.data || []).length > 0
      ? (await supabase.from('point_sales').select('id').eq('company_id', companyId).eq('sale_date', today)).data?.map((r) => r.id) || []
      : []

    // Fetch top 3 items sold today
    let topItemsText = 'нет продаж'
    if (todaySaleIds.length > 0) {
      const { data: saleItems } = await supabase
        .from('point_sale_items')
        .select('quantity, item:inventory_items(name)')
        .in('sale_id', todaySaleIds)

      if (saleItems?.length) {
        const itemQtyMap = new Map<string, number>()
        for (const si of saleItems) {
          const name = (si.item as any)?.name || 'Неизвестный'
          itemQtyMap.set(name, (itemQtyMap.get(name) || 0) + Number(si.quantity || 0))
        }
        const top3 = Array.from(itemQtyMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
        topItemsText = top3.map(([name, qty]) => `${name} (${qty} шт)`).join(', ')
      }
    }

    // Fetch low stock items for this location
    let lowStockText = 'нет'
    if (locationId) {
      const { data: lowItems } = await supabase
        .from('inventory_balances')
        .select('item_id, quantity, item:inventory_items(name, low_stock_threshold, unit)')
        .eq('location_id', locationId)

      if (lowItems?.length) {
        const low = lowItems.filter((row) => {
          const threshold = Number((row.item as any)?.low_stock_threshold || 0)
          return threshold > 0 && Number(row.quantity || 0) <= threshold
        })
        if (low.length > 0) {
          lowStockText = low
            .slice(0, 5)
            .map((row) => {
              const item = row.item as any
              return `${item.name} (${row.quantity} ${item.unit || 'шт'})`
            })
            .join(', ')
        }
      }
    }

    // Build prompt
    const prompt = `Ты — помощник кассира. Дай 2-3 коротких практических совета для кассира на основе данных.

Сегодня: ${Math.round(todayTotal)} ₸ (вчера: ${Math.round(yesterdayTotal)} ₸)
Топ товаров сегодня: ${topItemsText}
Заканчивается на складе: ${lowStockText}

Ответь на русском, кратко (2-3 совета), без лишних слов. Формат: • совет`

    // Call OpenAI GPT-4o-mini
    const openaiKey = process.env.OPENAI_API_KEY
    let hint = 'AI подсказки временно недоступны.'

    if (openaiKey) {
      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      }).catch(() => null)

      if (aiRes?.ok) {
        const aiData = await aiRes.json().catch(() => null)
        hint = aiData?.choices?.[0]?.message?.content?.trim() || hint
      }
    }

    return json({
      hint,
      today_total: todayTotal,
      yesterday_total: yesterdayTotal,
      change_percent: changePercent,
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось получить AI подсказку' }, 500)
  }
}
