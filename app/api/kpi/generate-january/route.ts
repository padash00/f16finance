import { NextResponse } from "next/server"

import { calculateForecast, type CompanyCode } from "@/lib/kpiEngine"
import { getRequestAccessContext } from "@/lib/server/request-auth"
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit"

type GenerateKpiBody = {
  monthStart?: string
  companies?: CompanyCode[]
}

type IncomeRow = {
  date: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  companies?: { code?: string | null } | null
}

const DEFAULT_COMPANIES: CompanyCode[] = ["arena", "ramen", "extra"]
const WEEKS_IN_MONTH = 4.345

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function monthStartFromInput(raw?: string) {
  if (raw) {
    const normalized = raw.length === 7 ? `${raw}-01` : raw.slice(0, 10)
    const parsed = new Date(`${normalized}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), 1)
    }
  }

  const nextMonth = new Date()
  return new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 1)
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function getAmount(row: IncomeRow) {
  return Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0) + Number(row.card_amount || 0)
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = checkRateLimit(`kpi-generate:${ip}`, 10, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: "too-many-requests" }, { status: 429 })
    }

    const access = await getRequestAccessContext(request)
    if ("response" in access) return access.response

    if (!access.isSuperAdmin && access.staffRole !== "manager" && access.staffRole !== "owner") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 })
    }

    const body = (await request.json().catch(() => null)) as GenerateKpiBody | null
    const targetMonth = monthStartFromInput(body?.monthStart)
    const prev1 = addMonths(targetMonth, -1)
    const prev2 = addMonths(targetMonth, -2)
    const monthStart = toIsoDate(targetMonth)

    const selectedCompanies = (body?.companies || DEFAULT_COMPANIES).filter((company): company is CompanyCode =>
      DEFAULT_COMPANIES.includes(company),
    )

    if (selectedCompanies.length === 0) {
      return NextResponse.json({ ok: false, error: "companies-required" }, { status: 400 })
    }

    const { data, error } = await access.supabase
      .from("incomes")
      .select("date, cash_amount, kaspi_amount, card_amount, companies!inner(code)")
      .gte("date", toIsoDate(prev2))
      .lte("date", toIsoDate(new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0)))
      .in("companies.code", selectedCompanies)

    if (error) throw error

    const prev1Key = getMonthKey(prev1)
    const prev2Key = getMonthKey(prev2)
    const totals = new Map<CompanyCode, { prev1: number; prev2: number }>()

    for (const company of selectedCompanies) {
      totals.set(company, { prev1: 0, prev2: 0 })
    }

    for (const row of ((data || []) as IncomeRow[])) {
      const companyCode = String(row.companies?.code || "").toLowerCase() as CompanyCode
      if (!totals.has(companyCode)) continue

      const bucket = totals.get(companyCode)!
      const amount = getAmount(row)
      const monthKey = String(row.date).slice(0, 7)

      if (monthKey === prev1Key) bucket.prev1 += amount
      if (monthKey === prev2Key) bucket.prev2 += amount
    }

    const rows = selectedCompanies.map((company) => {
      const source = totals.get(company) || { prev1: 0, prev2: 0 }
      const forecast = calculateForecast(targetMonth, source.prev1, source.prev2)
      const turnoverTargetMonth = Math.round(forecast.forecast)
      const turnoverTargetWeek = Math.round(turnoverTargetMonth / WEEKS_IN_MONTH)

      return {
        plan_key: `${monthStart}|collective|${company}`,
        month_start: monthStart,
        entity_type: "collective",
        company_code: company,
        operator_id: null,
        role_code: null,
        turnover_target_month: turnoverTargetMonth,
        turnover_target_week: turnoverTargetWeek,
        shifts_target_month: 0,
        shifts_target_week: 0,
        meta: {
          generated_via: "api/kpi/generate-january",
          baseline_prev2: Math.round(source.prev2),
          baseline_prev1: Math.round(source.prev1),
          prev1_estimated: Math.round(forecast.prev1Estimated),
          trend_percent: Number(forecast.trend.toFixed(1)),
          is_partial_month: forecast.isPartial,
        },
        is_locked: false,
      }
    })

    const { error: upsertError } = await access.supabase.from("kpi_plans").upsert(rows, { onConflict: "plan_key" })
    if (upsertError) throw upsertError

    return NextResponse.json({
      ok: true,
      monthStart,
      companies: selectedCompanies,
      totalTargetMonth: rows.reduce((sum, row) => sum + row.turnover_target_month, 0),
      rows,
    })
  } catch (e: any) {
    console.error("POST /api/kpi/generate-january failed:", e)
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 })
  }
}
