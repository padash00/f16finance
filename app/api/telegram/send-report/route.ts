import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { sendTelegramMessage } from '@/lib/telegram/send'

function todayISO() {
  const now = new Date()
  const t = now.getTime() - now.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

function addDaysISO(iso: string, diff: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  const t = dt.getTime() - dt.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

function safeNum(v: number | null | undefined) {
  return Number(v || 0)
}

function fmtMoney(v: number) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + ' млн ₸'
  if (abs >= 1_000) return sign + Math.round(abs / 1_000) + ' тыс ₸'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!chatId) {
    return NextResponse.json(
      { error: 'TELEGRAM_CHAT_ID не настроен в .env' },
      { status: 400 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const type = body.type || 'daily'
  const today = todayISO()
  const dateFrom = type === 'weekly' ? addDaysISO(today, -6) : today

  // Fetch data using the user's supabase client (already authenticated)
  const [incomesRes, expensesRes] = await Promise.all([
    access.supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, online_amount, card_amount, date, company_id')
      .gte('date', dateFrom)
      .lte('date', today),
    access.supabase
      .from('expenses')
      .select('cash_amount, kaspi_amount, category, date')
      .gte('date', dateFrom)
      .lte('date', today),
  ])

  let totalIncome = 0
  let totalExpense = 0
  const categoryMap = new Map<string, number>()

  for (const row of incomesRes.data ?? []) {
    totalIncome +=
      safeNum(row.cash_amount) +
      safeNum(row.kaspi_amount) +
      safeNum(row.online_amount) +
      safeNum(row.card_amount)
  }
  for (const row of expensesRes.data ?? []) {
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount)
    totalExpense += total
    const cat = row.category || 'Прочее'
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + total)
  }

  const profit = totalIncome - totalExpense
  const margin = totalIncome > 0 ? (profit / totalIncome) * 100 : 0
  const topCategories = Array.from(categoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  const marginEmoji = margin >= 20 ? '🟢' : margin >= 10 ? '🟡' : '🔴'
  const reportTitle = type === 'weekly' ? 'Недельный отчёт' : 'Дневной отчёт'
  const sign = profit >= 0 ? '+' : ''

  const lines = [
    `<b>📊 Orda Control — ${reportTitle}</b>`,
    `<i>${dateFrom === today ? today : `${dateFrom} — ${today}`}</i>`,
    '',
    `💰 Выручка: <b>${fmtMoney(totalIncome)}</b>`,
    `📉 Расходы: <b>${fmtMoney(totalExpense)}</b>`,
    `💼 Прибыль: <b>${sign}${fmtMoney(profit)}</b>`,
    `${marginEmoji} Маржа: <b>${margin.toFixed(1)}%</b>`,
  ]

  if (topCategories.length > 0) {
    lines.push('')
    lines.push('<b>Топ статей расходов:</b>')
    for (const [cat, val] of topCategories) {
      lines.push(`  • ${cat}: ${fmtMoney(val)}`)
    }
  }

  lines.push('')
  lines.push(`<i>Отправлено из Orda Control</i>`)

  const result = await sendTelegramMessage(chatId, lines.join('\n'))
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, chatId, type })
}
