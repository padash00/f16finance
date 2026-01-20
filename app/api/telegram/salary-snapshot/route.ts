import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'

type ReqBody = {
  operatorId: string // uuid operators.id OR telegram_chat_id digits
  weekStart?: string // optional, YYYY-MM-DD (monday). if not provided -> derived from dateFrom
  dateFrom?: string  // YYYY-MM-DD
  dateTo?: string    // YYYY-MM-DD
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

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const formatMoney = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`

const parseISO = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (Number.isNaN(dt.getTime())) return null
  return dt
}

const toISO = (dt: Date) => dt.toISOString().slice(0, 10)

const addDaysISO = (iso: string, diff: number) => {
  const dt = parseISO(iso)
  if (!dt) return iso
  dt.setUTCDate(dt.getUTCDate() + diff)
  return toISO(dt)
}

// monday of given date
const mondayOf = (iso: string) => {
  const dt = parseISO(iso)
  if (!dt) return iso
  const day = dt.getUTCDay() // 0..6 (0=Sun)
  const diff = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + diff)
  return toISO(dt)
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as ReqBody | null
    if (!body?.operatorId) {
      return NextResponse.json({ error: 'operatorId обязателен' }, { status: 400 })
    }

    const SUPABASE_URL = must(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = must(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      'SUPABASE_SERVICE_ROLE_KEY',
    )
    const TG_TOKEN = must(process.env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN')

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    const dateFrom = (body.dateFrom || '').trim()
    const dateTo = (body.dateTo || '').trim()

    if (!dateFrom || !parseISO(dateFrom)) {
      return NextResponse.json({ error: 'dateFrom обязателен (YYYY-MM-DD)' }, { status: 400 })
    }
    if (!dateTo || !parseISO(dateTo)) {
      return NextResponse.json({ error: 'dateTo обязателен (YYYY-MM-DD)' }, { status: 400 })
    }

    // weekStart optional -> derive monday from dateFrom
    const weekStart = (body.weekStart || '').trim() || mondayOf(dateFrom)
    const weekEnd = addDaysISO(weekStart, 6)

    // operator lookup: uuid OR telegram_chat_id digits
    const opKey = body.operatorId.trim()
    const isDigits = /^[0-9]+$/.test(opKey)

    const opQuery = sb
      .from('operators')
      .select('id,name,short_name,telegram_chat_id,is_active')

    const { data: operator, error: opErr } = isDigits
      ? await opQuery.eq('telegram_chat_id', opKey).maybeSingle()
      : await opQuery.eq('id', opKey).maybeSingle()

    if (opErr) {
      console.error('operator lookup error', opErr)
      return NextResponse.json({ error: 'Ошибка поиска оператора' }, { status: 500 })
    }
    if (!operator) {
      return NextResponse.json(
        { error: `Оператор не найден (${isDigits ? 'telegram_chat_id' : 'id'}=${opKey})` },
        { status: 404 },
      )
    }
    if (!operator.telegram_chat_id) {
      return NextResponse.json({ error: 'У оператора нет telegram_chat_id' }, { status: 400 })
    }

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
      sb
        .from('debts')
        .select('amount')
        .eq('operator_id', operator.id)
        .eq('week_start', weekStart)
        .eq('status', 'active'),
    ])

    if (compErr || rulesErr || incErr || adjErr || debtErr) {
      console.error({ compErr, rulesErr, incErr, adjErr, debtErr })
      return NextResponse.json({ error: 'Ошибка загрузки данных для расчёта' }, { status: 500 })
    }

    const companyById = new Map<string, CompanyRow>()
    for (const c of (companies || []) as CompanyRow[]) companyById.set(c.id, c)

    const rulesMap = new Map<string, RuleRow>()
    for (const r of (rules || []) as RuleRow[]) {
      rulesMap.set(`${r.company_code}_${r.shift_type}`, r)
    }

    // aggregate shifts (company+date+shift -> turnover)
    const aggregated = new Map<string, number>()
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

    const DEFAULT_BASE = 8000

    let shifts = 0
    let baseSalary = 0
    let bonusSalary = 0

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

    let manualPlus = 0
    let manualMinus = 0
    let advances = 0

    for (const a of (adjs || []) as AdjRow[]) {
      const amount = Number(a.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue
      if (a.kind === 'bonus') manualPlus += amount
      else if (a.kind === 'advance') advances += amount
      else manualMinus += amount
    }

    let autoDebts = 0
    for (const d of (debts || []) as DebtRow[]) {
      const amount = Number(d.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue
      autoDebts += amount
    }

    const finalSalary = totalSalary + manualPlus - manualMinus - autoDebts - advances

    const name = escapeHtml(operator.short_name || operator.name || 'Оператор')
    const period = `${dateFrom} — ${dateTo}`

    let text = `👤 <b>${name}</b>\n`
    text += `📅 Период: <code>${escapeHtml(period)}</code>\n`
    text += `🗓 Неделя (пн-вс): <code>${escapeHtml(weekStart)} — ${escapeHtml(weekEnd)}</code>\n\n`

    if (body.lastItem?.name) {
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
      console.error('TG send error', raw)
      return NextResponse.json({ error: 'Telegram не принял сообщение' }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
