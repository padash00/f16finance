import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

type ShiftType = "day" | "night"
type CompanyCode = "arena" | "ramen" | "extra"

function monthBounds(year: number, month1to12: number) {
  const from = new Date(Date.UTC(year, month1to12 - 1, 1))
  const to = new Date(Date.UTC(year, month1to12, 0))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

function round0(n: number) {
  return Math.round(n)
}

async function sumTurnover(from: string, to: string, companyCode?: CompanyCode, shift?: ShiftType) {
  // incomes: cash + kaspi + card
  let q = supabase
    .from("incomes")
    .select("date, shift, cash_amount, kaspi_amount, card_amount, companies!inner(code)")
    .gte("date", from)
    .lte("date", to)

  if (companyCode) q = q.eq("companies.code", companyCode)
  if (shift) q = q.eq("shift", shift)

  const { data, error } = await q
  if (error) throw error

  const total = (data || []).reduce((s: number, r: any) => {
    const cash = Number(r.cash_amount || 0)
    const kaspi = Number(r.kaspi_amount || 0)
    const card = Number(r.card_amount || 0)
    return s + cash + kaspi + card
  }, 0)

  return total
}

export async function POST() {
  try {
    // Январь 2026 (пример): генерим план на следующий январь
    const targetYear = 2026
    const jan = { from: `${targetYear}-01-01`, to: `${targetYear}-01-31` }

    // Базовые месяцы: ноябрь и декабрь 2025
    const nov = monthBounds(2025, 11)
    const dec = monthBounds(2025, 12)

    const GROWTH = 0.05 // 5% — потом вынесем в настройки

    const companies: CompanyCode[] = ["arena", "ramen"]

    // 1) Коллективный план по точкам и общий
    let totalPlanAll = 0

    for (const code of companies) {
      const novTotal = await sumTurnover(nov.from, nov.to, code)
      const decTotal = await sumTurnover(dec.from, dec.to, code)

      const base = (novTotal + decTotal) / 2
      const planMonth = round0(base * (1 + GROWTH))
      totalPlanAll += planMonth

      // shift shares
      const novDay = await sumTurnover(nov.from, nov.to, code, "day")
      const novNight = await sumTurnover(nov.from, nov.to, code, "night")
      const decDay = await sumTurnover(dec.from, dec.to, code, "day")
      const decNight = await sumTurnover(dec.from, dec.to, code, "night")

      const baseDay = (novDay + decDay) / 2
      const baseNight = (novNight + decNight) / 2
      const baseTotal = baseDay + baseNight || 1

      const dayPlan = round0(planMonth * (baseDay / baseTotal))
      const nightPlan = round0(planMonth * (baseNight / baseTotal))

      // пишем планы (month + shift)
      const rows = [
        { period_start: jan.from, period_type: "month", company_code: code, metric: "turnover", target: planMonth },
        { period_start: jan.from, period_type: "shift", company_code: code, shift_type: "day", metric: "turnover", target: dayPlan },
        { period_start: jan.from, period_type: "shift", company_code: code, shift_type: "night", metric: "turnover", target: nightPlan },
      ]

      const ins = await supabase.from("kpi_plans").insert(rows)
      if (ins.error) throw ins.error
    }

    // общий план по всем точкам
    const insAll = await supabase.from("kpi_plans").insert([
      { period_start: jan.from, period_type: "month", company_code: null, metric: "turnover", target: totalPlanAll },
    ])
    if (insAll.error) throw insAll.error

    return NextResponse.json({ ok: true, jan, totalPlanAll })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ ok: false, error: e.message || "error" }, { status: 500 })
  }
}
