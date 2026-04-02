import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { buildDailyKaspiSeriesFromRows, sumDailyKaspiReports, type DailyKaspiReport } from '@/lib/server/services/daily-kaspi'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type ProfitabilityPayload = {
  cash_revenue_override?: number | null
  pos_revenue_override?: number | null
  kaspi_qr_turnover?: number | null
  kaspi_qr_rate?: number | null
  kaspi_gold_turnover?: number | null
  kaspi_gold_rate?: number | null
  qr_gold_turnover?: number | null
  qr_gold_rate?: number | null
  other_cards_turnover?: number | null
  other_cards_rate?: number | null
  kaspi_red_turnover?: number | null
  kaspi_red_rate?: number | null
  kaspi_kredit_turnover?: number | null
  kaspi_kredit_rate?: number | null
  payroll_amount?: number | null
  payroll_taxes_amount?: number | null
  income_tax_amount?: number | null
  depreciation_amount?: number | null
  amortization_amount?: number | null
  other_operating_amount?: number | null
  notes?: string | null
}

type MutationBody = {
  month: string
  payload: ProfitabilityPayload
}

type ProfitabilityKaspiSeriesItem = {
  date: string
  total: number
  isPrecise: boolean
  warning: string | null
  parts: DailyKaspiReport['parts']
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeMonth(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()

  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed.slice(0, 7)}-01`

  return null
}

function monthStart(month: string) {
  return `${month.slice(0, 7)}-01`
}

function monthEnd(month: string) {
  const [year, monthNumber] = month.slice(0, 7).split('-').map(Number)
  const last = new Date(year, monthNumber, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

function prevDayISO(dateISO: string) {
  const next = new Date(`${dateISO}T00:00:00`)
  next.setDate(next.getDate() - 1)
  return next.toISOString().slice(0, 10)
}

function monthKey(dateISO: string) {
  return dateISO.slice(0, 7)
}

function normalizeAmount(value: number | null | undefined) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, numeric)
}

function normalizePayload(payload: ProfitabilityPayload) {
  return {
    cash_revenue_override: normalizeAmount(payload.cash_revenue_override),
    pos_revenue_override: normalizeAmount(payload.pos_revenue_override),
    kaspi_qr_turnover: normalizeAmount(payload.kaspi_qr_turnover),
    kaspi_qr_rate: normalizeAmount(payload.kaspi_qr_rate),
    kaspi_gold_turnover: normalizeAmount(payload.kaspi_gold_turnover),
    kaspi_gold_rate: normalizeAmount(payload.kaspi_gold_rate),
    qr_gold_turnover: normalizeAmount(payload.qr_gold_turnover),
    qr_gold_rate: normalizeAmount(payload.qr_gold_rate),
    other_cards_turnover: normalizeAmount(payload.other_cards_turnover),
    other_cards_rate: normalizeAmount(payload.other_cards_rate),
    kaspi_red_turnover: normalizeAmount(payload.kaspi_red_turnover),
    kaspi_red_rate: normalizeAmount(payload.kaspi_red_rate),
    kaspi_kredit_turnover: normalizeAmount(payload.kaspi_kredit_turnover),
    kaspi_kredit_rate: normalizeAmount(payload.kaspi_kredit_rate),
    payroll_amount: normalizeAmount(payload.payroll_amount),
    payroll_taxes_amount: normalizeAmount(payload.payroll_taxes_amount),
    income_tax_amount: normalizeAmount(payload.income_tax_amount),
    depreciation_amount: normalizeAmount(payload.depreciation_amount),
    amortization_amount: normalizeAmount(payload.amortization_amount),
    other_operating_amount: normalizeAmount(payload.other_operating_amount),
    notes: payload.notes?.trim() || null,
  }
}

function canManageProfitability(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner'
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!canManageProfitability(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(req.url)
    const from = normalizeMonth(url.searchParams.get('from'))
    const to = normalizeMonth(url.searchParams.get('to'))
    const includeKaspiDaily = url.searchParams.get('includeKaspiDaily') === '1'

    const supabase = createAdminSupabaseClient()
    let query = supabase.from('monthly_profitability_inputs').select('*').order('month', { ascending: true })

    if (from) query = query.gte('month', from)
    if (to) query = query.lte('month', to)

    const { data, error } = await query
    if (error) throw error

    if (!includeKaspiDaily || !from || !to) {
      return json({ items: data || [] })
    }

    const dateFrom = monthStart(from)
    const dateTo = monthEnd(to)
    const previousDate = prevDayISO(dateFrom)

    const [{ data: deviceRows, error: devicesError }, { data: incomeRows, error: incomesError }] = await Promise.all([
      supabase.from('point_devices').select('company_id, feature_flags').eq('is_active', true),
      supabase
        .from('incomes')
        .select('company_id,date,shift,kaspi_amount,kaspi_before_midnight')
        .gte('date', previousDate)
        .lte('date', dateTo),
    ])

    if (devicesError) throw devicesError
    if (incomesError) throw incomesError

    const splitCompanyIds = new Set<string>(
      ((deviceRows || []) as any[])
        .filter((row) => row?.company_id && row?.feature_flags?.kaspi_daily_split === true)
        .map((row) => String(row.company_id)),
    )

    const splitRows = ((incomeRows || []) as any[])
      .filter((row) => splitCompanyIds.has(String(row.company_id || '')))
      .map((row) => ({
        id: `${row.company_id}:${row.date}:${row.shift}`,
        date: String(row.date),
        shift: (row.shift === 'night' ? 'night' : 'day') as 'day' | 'night',
        kaspi_amount: Number(row.kaspi_amount || 0),
        kaspi_before_midnight: row.kaspi_before_midnight == null ? null : Number(row.kaspi_before_midnight || 0),
      }))

    const splitDaily = buildDailyKaspiSeriesFromRows({
      dateFrom,
      dateTo,
      rows: splitRows,
    })

    const rawByDate = new Map<string, number>()
    for (const row of ((incomeRows || []) as any[])) {
      const companyId = String(row.company_id || '')
      if (splitCompanyIds.has(companyId)) continue
      const date = String(row.date || '')
      rawByDate.set(date, Number(rawByDate.get(date) || 0) + Number(row.kaspi_amount || 0))
    }

    const mergedDaily: ProfitabilityKaspiSeriesItem[] = splitDaily.map((item) => ({
      ...item,
      total: item.total + Number(rawByDate.get(item.date) || 0),
      parts: item.parts,
      warning: item.warning,
      isPrecise: item.isPrecise,
    }))

    const monthlyKaspi = Object.fromEntries(
      Object.entries(
        mergedDaily.reduce<Record<string, number>>((acc, item) => {
          const key = monthKey(item.date)
          acc[key] = Number(acc[key] || 0) + Number(item.total || 0)
          return acc
        }, {}),
      ).map(([key, value]) => [key, Math.round((value + Number.EPSILON) * 100) / 100]),
    )

    return json({
      items: data || [],
      kaspiDaily: {
        from: dateFrom,
        to: dateTo,
        splitCompanyIds: Array.from(splitCompanyIds),
        days: mergedDaily,
        total: sumDailyKaspiReports(mergedDaily),
        monthly: monthlyKaspi,
      },
    })
  } catch (error: any) {
    console.error('Admin profitability GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/profitability.GET',
      message: error?.message || 'Admin profitability GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!canManageProfitability(access)) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as MutationBody | null
    const month = normalizeMonth(body?.month)
    if (!month) return json({ error: 'month обязателен в формате YYYY-MM' }, 400)

    const supabase = createAdminSupabaseClient()
    const payload = normalizePayload(body?.payload || {})

    const { data, error } = await supabase
      .from('monthly_profitability_inputs')
      .upsert(
        [
          {
            month,
            ...payload,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'month' },
      )
      .select('*')
      .single()

    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'profitability-input',
      entityId: month,
      action: 'upsert',
      payload: { month, ...payload },
    })

    return json({ ok: true, item: data })
  } catch (error: any) {
    console.error('Admin profitability POST error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/profitability.POST',
      message: error?.message || 'Admin profitability POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
