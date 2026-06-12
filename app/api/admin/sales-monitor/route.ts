import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const round = (n: number) => Math.round(Number(n) || 0)

/**
 * Живой монитор продаж: агрегаты за дату + разбивка по точкам, по часам,
 * топ-товары, разбивка оплат, продажи за последний час и лента последних продаж
 * с именами точки/оператора. Используется страницей /sales-monitor (авто-обновление).
 */
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    // Платная фича магазина (shop.catalog): при ENTITLEMENTS_ENFORCE=true → 402.
    const gate = await requireOrgFeature(access, 'shop.catalog')
    if (gate) return gate

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' })
    const from = url.searchParams.get('from') || url.searchParams.get('date') || today
    const to = url.searchParams.get('to') || from
    const companyId = url.searchParams.get('company_id') || ''

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const empty = {
      from, to,
      totals: { amount: 0, count: 0, avg_check: 0, cash: 0, cashless: 0, net_profit: 0 },
      returns: { amount: 0, count: 0 },
      receipts: { amount: 0, count: 0 },
      prev: { amount: 0, delta_pct: null as number | null },
      last_hour: { amount: 0, count: 0 },
      payment: { cash: 0, kaspi: 0, card: 0, online: 0 },
      by_company: [] as any[],
      by_operator: [] as any[],
      by_category: [] as any[],
      by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, amount: 0, count: 0 })),
      by_day: [] as any[],
      top_items: [] as any[],
      recent: [] as any[],
    }

    // Календарный день по Алматы (UTC+5) по РЕАЛЬНОМУ времени продажи sold_at.
    // sale_date — «бизнес-дата» смены (ночная смена висит на прошлой дате, даже
    // продажи после полуночи), поэтому фильтруем по фактическому времени.
    const dayStart = new Date(`${from}T00:00:00+05:00`)
    const dayEnd = new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 24 * 3_600_000)

    const scopedIds = companyScope.allowedCompanyIds
    if (scopedIds !== null && scopedIds.length === 0) return json({ ok: true, data: empty })

    const SALES_SELECT =
      'id, sold_at, shift, payment_method, cash_amount, kaspi_amount, card_amount, online_amount, total_amount, company_id, operator_id, items:point_sale_items(quantity, total_price, universal_name, inventory_items(name, default_purchase_price, category:category_id(name)))'
    const scopeSales = (q: any) => {
      q = q.gte('sold_at', dayStart.toISOString()).lt('sold_at', dayEnd.toISOString())
      if (companyId) q = q.eq('company_id', companyId)
      if (scopedIds !== null) q = q.in('company_id', scopedIds)
      return q
    }

    // Пагинация: PostgREST режет выборку на 1000 строк, а за период (неделя/месяц)
    // продаж больше — иначе суммы/счётчики занижены, а сравнение врёт.
    const sales: any[] = []
    for (let off = 0; off < 50000; off += 1000) {
      const { data, error } = await scopeSales(
        supabase.from('point_sales').select(SALES_SELECT).order('sold_at', { ascending: false }).range(off, off + 999),
      )
      if (error) throw error
      const rows = (data || []) as any[]
      sales.push(...rows)
      if (rows.length < 1000) break
    }

    // Имена точек и операторов
    const companyIds = Array.from(new Set(sales.map((s) => s.company_id).filter(Boolean)))
    const operatorIds = Array.from(new Set(sales.map((s) => s.operator_id).filter(Boolean)))
    const [companiesRes, operatorsRes] = await Promise.all([
      companyIds.length ? supabase.from('companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [] as any[] }),
      operatorIds.length ? supabase.from('operators').select('id, name, short_name').in('id', operatorIds) : Promise.resolve({ data: [] as any[] }),
    ])
    const companyName = new Map<string, string>((companiesRes.data || []).map((c: any) => [String(c.id), c.name]))
    const operatorName = new Map<string, string>(
      (operatorsRes.data || []).map((o: any) => [String(o.id), o.short_name?.trim() || o.name?.trim() || 'Оператор']),
    )

    // Агрегаты
    let amount = 0, cash = 0, kaspi = 0, card = 0, online = 0, cost = 0
    let lastHourAmount = 0, lastHourCount = 0
    const hourMap: number[] = Array(24).fill(0)
    const hourCount: number[] = Array(24).fill(0)
    const byCompany = new Map<string, { company_id: string; name: string; amount: number; count: number }>()
    const byOperator = new Map<string, { name: string; amount: number; count: number }>()
    const byCategory = new Map<string, { name: string; qty: number; revenue: number }>()
    const itemMap = new Map<string, { name: string; qty: number; revenue: number }>()
    const byDay = new Map<string, { amount: number; count: number }>()
    const cutoff = Date.now() - 3_600_000

    for (const s of sales) {
      const total = Number(s.total_amount || 0)
      amount += total
      cash += Number(s.cash_amount || 0)
      kaspi += Number(s.kaspi_amount || 0)
      card += Number(s.card_amount || 0)
      online += Number(s.online_amount || 0)

      const t = new Date(s.sold_at)
      const shifted = new Date(t.getTime() + 5 * 3_600_000) // → время/дата по Алматы (UTC+5)
      const h = shifted.getUTCHours()
      hourMap[h] += total
      hourCount[h] += 1
      const dstr = shifted.toISOString().slice(0, 10)
      const dRow = byDay.get(dstr) || { amount: 0, count: 0 }
      dRow.amount += total; dRow.count += 1; byDay.set(dstr, dRow)
      if (t.getTime() >= cutoff) { lastHourAmount += total; lastHourCount += 1 }

      const cid = String(s.company_id || '')
      if (cid) {
        const c = byCompany.get(cid) || { company_id: cid, name: companyName.get(cid) || 'Точка', amount: 0, count: 0 }
        c.amount += total
        c.count += 1
        byCompany.set(cid, c)
      }

      const oid = String(s.operator_id || '')
      if (oid) {
        const o = byOperator.get(oid) || { name: operatorName.get(oid) || 'Оператор', amount: 0, count: 0 }
        o.amount += total
        o.count += 1
        byOperator.set(oid, o)
      }

      for (const it of (s.items || []) as any[]) {
        const inv = Array.isArray(it.inventory_items) ? it.inventory_items[0] : it.inventory_items
        cost += Number(inv?.default_purchase_price || 0) * Number(it.quantity || 0)
        const nm = inv?.name || it.universal_name || 'Товар'
        const row = itemMap.get(nm) || { name: nm, qty: 0, revenue: 0 }
        row.qty += Number(it.quantity || 0)
        row.revenue += Number(it.total_price || 0)
        itemMap.set(nm, row)

        const cat = (Array.isArray(inv?.category) ? inv?.category[0]?.name : inv?.category?.name) || (inv ? 'Без категории' : 'Прочее')
        const crow = byCategory.get(cat) || { name: cat, qty: 0, revenue: 0 }
        crow.qty += Number(it.quantity || 0)
        crow.revenue += Number(it.total_price || 0)
        byCategory.set(cat, crow)
      }
    }

    const count = sales.length
    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .map((v) => ({ name: v.name, qty: Math.round(v.qty * 100) / 100, revenue: round(v.revenue) }))

    const byCompanyArr = Array.from(byCompany.values())
      .map((c) => ({ ...c, amount: round(c.amount), avg_check: c.count ? round(c.amount / c.count) : 0 }))
      .sort((a, b) => b.amount - a.amount)

    const byOperatorArr = Array.from(byOperator.values())
      .map((o) => ({ name: o.name, amount: round(o.amount), count: o.count, avg_check: o.count ? round(o.amount / o.count) : 0 }))
      .sort((a, b) => b.amount - a.amount)

    const byCategoryArr = Array.from(byCategory.values())
      .map((c) => ({ name: c.name, qty: Math.round(c.qty * 100) / 100, revenue: round(c.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)

    // Разбивка по дням периода (для графика при диапазоне дат)
    const days: string[] = []
    {
      let cur = new Date(`${from}T00:00:00+05:00`)
      const end = new Date(`${to}T00:00:00+05:00`)
      for (let i = 0; i < 400 && cur.getTime() <= end.getTime(); i++) {
        days.push(new Date(cur.getTime() + 5 * 3_600_000).toISOString().slice(0, 10))
        cur = new Date(cur.getTime() + 24 * 3_600_000)
      }
    }
    const byDayArr = days.map((d) => ({ date: d, amount: round(byDay.get(d)?.amount || 0), count: byDay.get(d)?.count || 0 }))

    // Возвраты, приёмка и прошлый период (best-effort, с пагинацией)
    const applyScope = (q: any) => {
      if (companyId) q = q.eq('company_id', companyId)
      if (scopedIds !== null) q = q.in('company_id', scopedIds)
      return q
    }
    const periodMs = dayEnd.getTime() - dayStart.getTime()
    const prevStart = new Date(dayStart.getTime() - periodMs)
    const paginatedSum = async (build: (off: number) => any) => {
      let amt = 0, cnt = 0
      for (let off = 0; off < 50000; off += 1000) {
        const { data } = await build(off)
        const rows = (data || []) as any[]
        amt += rows.reduce((s, r) => s + Number(r.total_amount || 0), 0)
        cnt += rows.length
        if (rows.length < 1000) break
      }
      return { amt, cnt }
    }
    const locRes = await applyScope(supabase.from('inventory_locations').select('id').eq('is_active', true).not('company_id', 'is', null))
    const locationIds = (((locRes as any).data || []) as any[]).map((l) => String(l.id)).filter((x) => x && x !== 'null')
    const [returnsAgg, receiptsAgg, prevAgg] = await Promise.all([
      paginatedSum((off) => applyScope(supabase.from('point_returns').select('total_amount').gte('returned_at', dayStart.toISOString()).lt('returned_at', dayEnd.toISOString()).range(off, off + 999))),
      paginatedSum((off) => locationIds.length ? supabase.from('inventory_receipts').select('total_amount').in('location_id', locationIds).gte('received_at', from).lte('received_at', to).range(off, off + 999) : Promise.resolve({ data: [] as any[] })),
      paginatedSum((off) => applyScope(supabase.from('point_sales').select('total_amount').gte('sold_at', prevStart.toISOString()).lt('sold_at', dayStart.toISOString()).range(off, off + 999))),
    ])
    const returnsAmount = returnsAgg.amt, returnsCount = returnsAgg.cnt
    const receiptsAmount = receiptsAgg.amt, receiptsCount = receiptsAgg.cnt
    const prevAmount = prevAgg.amt
    const netProfit = amount - cost
    const deltaPct = prevAmount > 0 ? Math.round(((amount - prevAmount) / prevAmount) * 1000) / 10 : null

    const recent = sales.slice(0, 40).map((s) => ({
      id: s.id,
      sold_at: s.sold_at,
      company_name: companyName.get(String(s.company_id || '')) || '—',
      operator_name: s.operator_id ? operatorName.get(String(s.operator_id)) || '—' : '—',
      total_amount: round(s.total_amount),
      payment_method: s.payment_method,
      items: ((s.items || []) as any[])
        .map((it) => (Array.isArray(it.inventory_items) ? it.inventory_items[0]?.name : it.inventory_items?.name) || it.universal_name)
        .filter(Boolean)
        .slice(0, 4),
      items_count: (s.items || []).length,
    }))

    return json({
      ok: true,
      data: {
        from, to,
        totals: {
          amount: round(amount),
          count,
          avg_check: count ? round(amount / count) : 0,
          cash: round(cash),
          cashless: round(kaspi + card + online),
          net_profit: round(netProfit),
        },
        returns: { amount: round(returnsAmount), count: returnsCount },
        receipts: { amount: round(receiptsAmount), count: receiptsCount },
        prev: { amount: round(prevAmount), delta_pct: deltaPct },
        last_hour: { amount: round(lastHourAmount), count: lastHourCount },
        payment: { cash: round(cash), kaspi: round(kaspi), card: round(card), online: round(online) },
        by_company: byCompanyArr,
        by_operator: byOperatorArr,
        by_category: byCategoryArr,
        by_hour: hourMap.map((a, h) => ({ hour: h, amount: round(a), count: hourCount[h] })),
        by_day: byDayArr,
        top_items: topItems,
        recent,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/sales-monitor.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
