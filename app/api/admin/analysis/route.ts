import { NextResponse } from 'next/server'

import { buildAnalysis } from '@/lib/analysis/build-analysis'
import { DATA_SOURCE_NOTE, MAX_DAYS_HARD_LIMIT, PLANS_TABLE, getDefaultAllPeriodStartISO } from '@/lib/analysis/constants'
import { parseISODateSafe, toISODateLocal } from '@/lib/analysis/core-utils'
import { buildFullHistory } from '@/lib/analysis/history'
import type { AnalysisResult, DataPoint } from '@/lib/analysis/types'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

const PAGE_SIZE = 5000

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function computeRange(
  rangePreset: string,
  customStart: string | null,
  customEnd: string | null,
): { start: Date; end: Date; error?: string } {
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  let start: Date
  let end: Date = today

  if (rangePreset === 'all') start = parseISODateSafe(getDefaultAllPeriodStartISO())
  else {
    const days = Number(rangePreset)
    if (!Number.isFinite(days) || days <= 0) {
      return { start: today, end: today, error: 'Некорректный период' }
    }
    start = new Date(today)
    start.setDate(today.getDate() - days + 1)
  }

  if (customStart) start = parseISODateSafe(customStart)
  if (customEnd) end = parseISODateSafe(customEnd)

  const maxStart = new Date(end)
  maxStart.setDate(end.getDate() - MAX_DAYS_HARD_LIMIT + 1)
  if (start < maxStart) start = maxStart

  return { start, end }
}

async function fetchAllIncomes(
  supabase: ReturnType<typeof createRequestSupabaseClient>,
  from: string,
  to: string,
  allowedCompanyIds: string[] | null,
) {
  const all: any[] = []
  let page = 0
  while (true) {
    let q = supabase
      .from('incomes')
      .select('id, date, company_id, cash_amount, kaspi_amount, online_amount, card_amount')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (allowedCompanyIds !== null) {
      if (allowedCompanyIds.length === 0) return []
      q = q.in('company_id', allowedCompanyIds)
    }
    const { data, error } = await q
    if (error) throw error
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    page++
  }
  return all
}

async function fetchAllExpenses(
  supabase: ReturnType<typeof createRequestSupabaseClient>,
  from: string,
  to: string,
  allowedCompanyIds: string[] | null,
) {
  const all: any[] = []
  let page = 0
  while (true) {
    let q = supabase
      .from('expenses')
      .select('id, date, company_id, category, cash_amount, kaspi_amount')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (allowedCompanyIds !== null) {
      if (allowedCompanyIds.length === 0) return []
      q = q.in('company_id', allowedCompanyIds)
    }
    const { data, error } = await q
    if (error) throw error
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    page++
  }
  return all
}

export type AdminAnalysisResponse = {
  history: DataPoint[]
  expenseCategories: Record<string, number>
  plansWarning: string | null
  dataSourceNote: string
  analysis: {
    excludeZeroDays: AnalysisResult | null
    includeZeroDays: AnalysisResult | null
  } | null
  range: { from: string; to: string }
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const rangePreset = url.searchParams.get('range') || '365'
    const customStart = url.searchParams.get('from')
    const customEnd = url.searchParams.get('to')
    const companyId = url.searchParams.get('company_id')
    const plansEnabled = url.searchParams.get('plans') !== '0'

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId && companyId !== 'all' ? companyId : null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowed = companyScope.allowedCompanyIds

    const { start, end, error: rangeError } = computeRange(
      rangePreset,
      customStart,
      customEnd,
    )
    if (rangeError) return json({ error: rangeError }, 400)

    const fromDateStr = toISODateLocal(start)
    const toDateStr = toISODateLocal(end)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)

    const [incomeRows, expenseRows] = await Promise.all([
      fetchAllIncomes(supabase, fromDateStr, toDateStr, allowed),
      fetchAllExpenses(supabase, fromDateStr, toDateStr, allowed),
    ])

    let planRows: { date: string; planned_income: number; planned_expense: number }[] = []
    let plansWarning: string | null = null
    if (plansEnabled) {
      const planRes = await supabase
        .from(PLANS_TABLE)
        .select('date, planned_income, planned_expense')
        .gte('date', fromDateStr)
        .lte('date', toDateStr)
        .order('date')
      if (planRes.error) {
        const msg = String((planRes.error as any).message || planRes.error)
        const isMissingTable = msg.includes('Could not find the table') || msg.includes('schema cache')
        if (isMissingTable) {
          planRows = []
          plansWarning = `Планы отключены: таблица "${PLANS_TABLE}" не найдена.`
        } else {
          throw planRes.error
        }
      } else {
        planRows = (planRes.data ?? []) as any
      }
    }

    const { history, expenseCategories } = buildFullHistory(start, end, incomeRows, expenseRows, planRows)

    let analysis: AdminAnalysisResponse['analysis'] = null
    if (history.length) {
      const excludeZeroDays = buildAnalysis(history, false)
      const includeZeroDays = buildAnalysis(history, true)
      analysis = { excludeZeroDays, includeZeroDays }
    }

    const payload: AdminAnalysisResponse = {
      history,
      expenseCategories,
      plansWarning,
      dataSourceNote: DATA_SOURCE_NOTE,
      analysis,
      range: { from: fromDateStr, to: toDateStr },
    }

    return json(payload)
  } catch (error: any) {
    if (error?.message === 'company-out-of-scope') {
      return json({ error: 'Компания недоступна' }, 403)
    }
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/analysis GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
