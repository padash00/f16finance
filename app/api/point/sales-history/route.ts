import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/**
 * История продаж точки для операторской кассы (v2.9).
 * Клиент пришёл за чеком назавтра — кассир находит продажу и печатает КОПИЮ.
 *
 * GET /api/point/sales-history?days=7&q=750&limit=100
 *  - days: глубина (максимум 7)
 *  - q: поиск — по сумме (число) или подстроке времени/комментария
 *  - все смены и кассиры этой точки (company_id устройства)
 */
export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!device.company_id) return json({ ok: true, data: { sales: [] } })

    const url = new URL(request.url)
    const days = Math.min(7, Math.max(1, Math.floor(Number(url.searchParams.get('days') || 7)) || 7))
    const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('limit') || 100)) || 100))
    const q = String(url.searchParams.get('q') || '').trim()

    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()

    let query = supabase
      .from('point_sales')
      .select(
        'id, sold_at, sale_date, shift, payment_method, cash_amount, kaspi_amount, card_amount, online_amount, total_amount, comment, customer_id, discount_amount, loyalty_points_earned, loyalty_points_spent, operator_id, operator:operator_id(name, short_name), items:point_sale_items(id, quantity, unit_price, total_price, item:item_id(name, unit))',
      )
      .eq('company_id', device.company_id)
      .gte('sold_at', since)
      .order('sold_at', { ascending: false })
      .limit(limit)

    // Поиск по точной сумме чека (самый частый сценарий «чек на 750»)
    const qNum = Number(q.replace(/\s/g, '').replace(',', '.'))
    if (q && Number.isFinite(qNum) && qNum > 0) {
      query = query.eq('total_amount', qNum)
    } else if (q) {
      query = query.ilike('comment', `%${q.replace(/[%_\\]/g, '\\$&')}%`)
    }

    const { data, error } = await query
    if (error) throw error

    const sales = ((data as any[]) || []).map((s) => {
      const operator = Array.isArray(s.operator) ? s.operator[0] : s.operator
      return {
        id: String(s.id),
        sold_at: s.sold_at,
        sale_date: s.sale_date,
        shift: s.shift,
        payment_method: s.payment_method,
        cash_amount: Number(s.cash_amount || 0),
        kaspi_amount: Number(s.kaspi_amount || 0),
        card_amount: Number(s.card_amount || 0),
        online_amount: Number(s.online_amount || 0),
        total_amount: Number(s.total_amount || 0),
        discount_amount: Number(s.discount_amount || 0),
        comment: s.comment || null,
        operator_name: String(operator?.short_name || operator?.name || '') || null,
        items: (Array.isArray(s.items) ? s.items : []).map((it: any) => {
          const item = Array.isArray(it.item) ? it.item[0] : it.item
          return {
            name: String(item?.name || 'Товар'),
            unit: String(item?.unit || 'шт'),
            quantity: Number(it.quantity || 0),
            unit_price: Number(it.unit_price || 0),
            total_price: Number(it.total_price || 0),
          }
        }),
      }
    })

    return json({ ok: true, data: { sales } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/point/sales-history.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Не удалось загрузить историю' }, 500)
  }
}
