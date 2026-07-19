/**
 * Дебаг-эндпоинт для расхождения расходов между /reports и /goals за январь.
 * Возвращает три варианта подсчёта расходов за выбранный месяц + диагностику.
 *
 * Использование: открой в браузере https://ordaops.kz/api/admin/debug/expenses-jan?year=2026&month=1
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// PostgREST режет ЛЮБОЙ запрос до 1000 строк — большие выборки только страницами по 1000.
const FETCH_PAGE = 1000
async function fetchAllPages(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await build(from, from + FETCH_PAGE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < FETCH_PAGE) break
  }
  return out
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()))
    const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1))

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin' }, 500)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const mm = String(month).padStart(2, '0')
    const lastDay = new Date(year, month, 0).getDate()
    const start = `${year}-${mm}-01`
    const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

    // 3 разных лимита, чтобы понять упирается ли в max-rows
    const limits = [1000, 9999, 49999]
    const results = []
    for (const lim of limits) {
      let q = supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount')
        .gte('date', start)
        .lte('date', end)
        .range(0, lim)
      if (scope.allowedCompanyIds !== null) q = q.in('company_id', scope.allowedCompanyIds)
      const { data, error } = await q
      const rows = data || []
      const sum = rows.reduce(
        (s: number, r: any) => s + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0),
        0,
      )
      results.push({
        rangeLimit: lim,
        rowsReturned: rows.length,
        sum: Math.round(sum * 100) / 100,
        firstDate: rows.length > 0 ? (rows[0] as any).date : null,
        lastDate: rows.length > 0 ? (rows[rows.length - 1] as any).date : null,
        error: error?.message || null,
      })
    }

    // Категории за период (агрегировано в БД)
    const catRows = await fetchAllPages((rFrom, rTo) => {
      let catQ = supabase
        .from('expenses')
        .select('category, cash_amount, kaspi_amount')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(rFrom, rTo)
      if (scope.allowedCompanyIds !== null) catQ = catQ.in('company_id', scope.allowedCompanyIds)
      return catQ
    }).catch(() => [] as any[])
    const categoryTotals: Record<string, number> = {}
    for (const r of (catRows || []) as any[]) {
      const cat = r.category || 'Без категории'
      categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
    }

    // Per-company breakdown
    const coRows = await fetchAllPages((rFrom, rTo) => {
      let coQ = supabase
        .from('expenses')
        .select('company_id, cash_amount, kaspi_amount')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(rFrom, rTo)
      if (scope.allowedCompanyIds !== null) coQ = coQ.in('company_id', scope.allowedCompanyIds)
      return coQ
    }).catch(() => [] as any[])
    const companyTotals: Record<string, number> = {}
    for (const r of (coRows || []) as any[]) {
      const cid = String(r.company_id || 'NULL')
      companyTotals[cid] = (companyTotals[cid] || 0) + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
    }

    return json({
      ok: true,
      params: { year, month, start, end },
      scope: {
        allowedCompanyIds: scope.allowedCompanyIds,
        organizationId: scope.organizationId,
        isSuperAdmin: access.isSuperAdmin,
      },
      byRangeLimit: results,
      categoryTotals: Object.fromEntries(
        Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]),
      ),
      companyTotals,
    })
  } catch (e: any) {
    return json({ error: e?.message || 'error' }, 500)
  }
}
