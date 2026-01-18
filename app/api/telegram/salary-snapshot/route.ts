import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'

type ReqBody = {
  operatorId?: string
  operator_id?: string
  weekStart?: string // YYYY-MM-DD (желательно понедельник)
  dateFrom?: string
  dateTo?: string
  lastItem?: { name: string; qty: number; total: number }
}

type CompanyRow = { id: string; code: string | null; name: string }
type RuleRow = {
  company_code: string
  shift_type: 'day' | 'night'
  base_per_shift: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  is_active: boolean
}
type IncomeRow = {
  date: string
  company_id: string
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
}
type AdjRow = { amount: number; kind: AdjustmentKind }
type DebtRow = { amount: number | null }

const must = (v: string | undefined, key: string) => {
  if (!v) throw new Error(`ENV ${key} is not set`)
  return v
}

const isoRe = /^\d{4}-\d{2}-\d{2}$/

const toISODateUTC = (d: Date) => d.toISOString().slice(0, 10)

const addDaysISO = (iso: string, diff: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + diff)
  return toISODateUTC(dt)
}

const getMondayISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  const day = dt.getUTCDay() || 7 // 1..7 (Пн..Вс)
  dt.setUTCDate(dt.getUTCDate() - (day - 1))
  return toISODateUTC(dt)
}

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const formatMoney = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: 'Use POST with JSON body',
    example: {
      operatorId: 'UUID (operators.id) OR telegram_chat_id (digits)',
      dateFrom: '2026-01-19',
      dateTo: '2026-01-25',
      weekStart: '2026-01-19 (optional; will be derived from dateFrom)',
    },
  })
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as ReqBody | null
    const rawOperator = String(body?.operatorId || body?.operator_id || '').trim()
    if (!rawOperator) {
      return NextResponse.json({ error: 'operatorId обязателен' }, { status: 400 })
    }

    const SUPABASE_URL = must(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL')
    const SERVICE_KEY = must(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
    const TG_TOKEN = must(process.env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN')

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    // даты
    const dateFrom = (body?.dateFrom || '').trim()
    const dateTo = (body?.dateTo || '').trim()

    if (!dateFrom || !isoRe.test(dateFrom)) {
      return NextResponse.json({ error: 'dateFrom обязателен (YYYY-MM-DD)' }, { status: 400 })
    }
    if (!dateTo || !isoRe.test(dateTo)) {
      return NextResponse.json({ error: 'dateTo обязателен (YYYY-MM-DD)' }, { status: 400 })
    }

    // weekStart: если не дали — берём понедельник от dateFrom
    const weekStart = isoRe.test((body?.weekStart || '').trim())
      ? (body!.weekStart as string).trim()
      : getMondayISO(dateFrom)
    const weekEnd = addDaysISO(weekStart, 6)

    // ---- 1) Ищем оператора: UUID или telegram_chat_id ----
    const isDigits = /^\d+$/.test(rawOperator)

    let q = sb
      .from('operators')
      .select('id,name,short_name,telegram_chat_id,is_active')
    q = isDigits ? q.eq('telegram_chat_id', rawOperator) : q.eq('id', rawOperator)

    const { data: operator, error: opErr } = await q.maybeSingle()

    if (opErr) {
      return NextResponse.json(
        { error: `Supabase operators lookup failed: ${opErr.message}` },
        { status: 500 },
      )
    }
    if (!operator) {
      return NextResponse.json(
        { error: `Оператор не найден (${isDigits ? 'telegram_chat_id' : 'id'}=${rawOperator})` },
        { status: 404 },
      )
    }
    if (!operator.telegram_chat_id) {
      return NextResponse.json({ error: 'У оператора нет telegram_chat_id' }, { status: 400 })
    }

    // ---- 2) Тянем данные для расчёта ----
    const [
      { data: companies, error: compErr },
      { data: rules, error: rulesErr },
      { data: incomes, error: incErr },
      { data: adjs, error: adjErr },
      { data: debts, error: debtErr },
    ] = await Promise.all([
      sb.from('companies').select('id,code,name'),
      sb
        .from('operator_salary_rules')
        .select(
          'company_code,shift_type,base_per_shift,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus,is_active',
        )
        .eq('is_active', true),
      sb
        .from('incomes')
        .select('date,company_id,shift,cash_amount,kaspi_amount,card_amount')
        .eq('operator_id', operator.id)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      sb
        .from('operator_salary_adjustments')
        .select('amount,kind')
        .eq('operator_id', operator.id)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      // долги недели — по weekStart
      sb
        .from('debts')
        .select('amount')
        .eq('operator_id', operator.id)
        .eq('week_start', weekStart)
        .eq('status', 'active'),
    ])

    if (compErr || rulesErr || incErr || adjErr || debtErr) {
      return NextResponse.json(
        {
          error: 'Ошибка загрузки данных для расчёта',
          details: {
            comp: compErr?.message || null,
            rules: rulesErr?.message || null,
            incomes: incErr?.message || null,
            adjustments: adjErr?.message || null,
            debts: debtErr?.message || null,
          },
        },
        { status: 500 },
      )
    }

    const companyById = new Map<string, CompanyRow>()
    for (const c of (companies || []) as CompanyRow[]) companyById.set(c.id, c)

    const rulesMap = new Map<string, RuleRow>()
    for (const r of (rules || []) as RuleRow[]) {
      rulesMap.set(`${r.company_code}_${r.shift_type}`, r)
    }

    // ---- 3) Агрегация смен (как на /salary) ----
    const aggregated = new Map<string, number>() // key -> turnover
    for (const row of (incomes || []) as IncomeRow[]) {
      const company = companyById.get(row.company_id)
      const code = company?.code?.toLowerCase() || null
      if (!code) continue
      if (!['arena', 'ramen', 'extra'].includes(code)) continue

      const shift: 'day' | 'night' = row.shift === 'night' ? 'night' : 'day'
      const total =
        Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0) + Number(row.card_amount || 0)
      if (total <= 0) continue

      const key = `${code}_${row.date}_${shift}`
      aggregated.set(key, (aggregated.get(key) || 0) + total)
    }

    let shifts = 0
    let baseSalary = 0
    let bonusSalary = 0
    const DEFAULT_BASE = 8000

    for (const [key, turnover] of aggregated.entries()) {
      const [code, , shift] = key.split('_') as [string, string, 'day' | 'night']
      const rule = rulesMap.get(`${code}_${shift}`)
      const base = Number(rule?.base_per_shift ?? DEFAULT_BASE)

      let bonus = 0
      if (rule?.threshold1_turnover && turnover >= rule.threshold1_turnover) {
        bonus += Number(rule.threshold1_bonus || 0)
      }
      if (rule?.threshold2_turnover && turnover >= rule.threshold2_turnover) {
        bonus += Number(rule.threshold2_bonus || 0)
      }

      shifts += 1
      baseSalary += base
      bonusSalary += bonus
    }

    const totalSalary = baseSalary + bonusSalary

    // ---- 4) Корректировки ----
    let manualPlus = 0
    let manualMinus = 0
    let advances = 0

    for (const a of (adjs || []) as AdjRow[]) {
      const amount = Number(a.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue
      if (a.kind === 'bonus') manualPlus += amount
      else if (a.kind === 'advance') advances += amount
      else manualMinus += amount // debt/fine
    }

    // ---- 5) Долги недели ----
    let autoDebts = 0
    for (const d of (debts || []) as DebtRow[]) {
      const amount = Number(d.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue
      autoDebts += amount
    }

    const finalSalary = totalSalary + manualPlus - manualMinus - autoDebts - advances

    // ---- 6) Текст в Telegram ----
    const name = escapeHtml(operator.short_name || operator.name || 'Оператор')
    const period = `${dateFrom} — ${dateTo}`

    let text = `👤 <b>${name}</b>\n`
    text += `📅 Период: <code>${escapeHtml(period)}</code>\n`
    text += `🗓 Неделя: <code>${escapeHtml(weekStart)} — ${escapeHtml(weekEnd)}</code>\n\n`

    if (body?.lastItem?.name) {
      text += `🛒 Сегодня в долг: <b>${escapeHtml(body.lastItem.name)}</b> x${body.lastItem.qty} = <b>${formatMoney(body.lastItem.total)}</b>\n\n`
    }

    text += `📌 Смен: <b>${shifts}</b>\n`
    text += `💼 База: <b>${formatMoney(baseSalary)}</b>\n`
    text += `✅ Авто-бонусы: <b>${formatMoney(bonusSalary)}</b>\n`
    text += `🧾 Долги недели: <b>${formatMoney(autoDebts)}</b>\n`
    if (manualMinus > 0) text += `➖ Долги/штрафы: <b>${formatMoney(manualMinus)}</b>\n`
    if (advances > 0) text += `💸 Авансы: <b>${formatMoney(advances)}</b>\n`
    if (manualPlus > 0) text += `🎁 Премии: <b>${formatMoney(manualPlus)}</b>\n`
    text += `\n💰 <b>К выплате: ${formatMoney(finalSalary)}</b>`

    // ---- 7) Отправка ----
    const tgResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: operator.telegram_chat_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })

    if (!tgResp.ok) {
      const raw = await tgResp.text().catch(() => '')
      return NextResponse.json(
        { error: 'Telegram не принял сообщение', details: raw.slice(0, 800) },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
