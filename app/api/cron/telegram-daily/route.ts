import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const KZ_OFFSET = 5 * 3600_000

function yesterdayKZISO() {
  const now = new Date(Date.now() + KZ_OFFSET)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function safeNum(v: number | null | undefined) { return Number(v || 0) }

function fmtMoney(v: number) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + ' млн ₸'
  if (abs >= 1_000) return sign + Math.round(abs / 1_000) + ' тыс ₸'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

async function sendTg(chatId: string, text: string) {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
  const data = await res.json().catch(() => null)
  if (!data?.ok) throw new Error(data?.description || 'Telegram send failed')
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!chatId) return NextResponse.json({ ok: false, error: 'TELEGRAM_CHAT_ID not set' })

  const supabase = createAdminSupabaseClient()
  const date = yesterdayKZISO()

  const [incomesRes, expensesRes] = await Promise.all([
    supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount, operator_id').eq('date', date),
    supabase.from('expenses').select('cash_amount, kaspi_amount, category').eq('date', date),
  ])

  let totalIncome = 0
  let totalExpense = 0
  const opRevenue = new Map<string, number>()
  const catMap = new Map<string, number>()

  for (const row of incomesRes.data ?? []) {
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
    totalIncome += total
    if (row.operator_id) opRevenue.set(row.operator_id, (opRevenue.get(row.operator_id) || 0) + total)
  }
  for (const row of expensesRes.data ?? []) {
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount)
    totalExpense += total
    const cat = row.category || 'Прочее'
    catMap.set(cat, (catMap.get(cat) || 0) + total)
  }

  const profit = totalIncome - totalExpense
  const margin = totalIncome > 0 ? (profit / totalIncome) * 100 : 0
  const marginEmoji = margin >= 20 ? '🟢' : margin >= 10 ? '🟡' : '🔴'
  const sign = profit >= 0 ? '+' : ''
  const topCats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)

  // Fetch 30-day rolling average for anomaly detection
  const thirtyDaysAgo = (() => {
    const d = new Date(Date.now() + KZ_OFFSET)
    const past = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 31))
    return `${past.getUTCFullYear()}-${String(past.getUTCMonth() + 1).padStart(2, '0')}-${String(past.getUTCDate()).padStart(2, '0')}`
  })()
  const avgRes = await supabase
    .from('incomes')
    .select('date, cash_amount, kaspi_amount, online_amount, card_amount')
    .gte('date', thirtyDaysAgo)
    .lt('date', date)

  const dayTotals = new Map<string, number>()
  for (const row of avgRes.data ?? []) {
    const t = safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
    dayTotals.set(row.date, (dayTotals.get(row.date) || 0) + t)
  }
  const dayValues = Array.from(dayTotals.values()).filter(v => v > 0)
  const avgDailyIncome = dayValues.length > 0 ? dayValues.reduce((a, b) => a + b, 0) / dayValues.length : 0
  const dropPercent = avgDailyIncome > 0 ? ((avgDailyIncome - totalIncome) / avgDailyIncome) * 100 : 0
  const isAnomaly = avgDailyIncome > 0 && dropPercent > 30 && totalIncome < avgDailyIncome
  const isSurge = avgDailyIncome > 0 && totalIncome > avgDailyIncome * 1.3

  const lines = [
    `<b>☀️ Orda Control — Итоги дня</b>`,
    `<i>${date}</i>`,
    '',
    `💰 Выручка: <b>${fmtMoney(totalIncome)}</b>`,
    `📉 Расходы: <b>${fmtMoney(totalExpense)}</b>`,
    `💼 Прибыль: <b>${sign}${fmtMoney(profit)}</b>`,
    `${marginEmoji} Маржа: <b>${margin.toFixed(1)}%</b>`,
    `👥 Операторов работало: <b>${opRevenue.size}</b>`,
  ]

  if (avgDailyIncome > 0) {
    lines.push(`📊 Средняя выручка (30д): <b>${fmtMoney(avgDailyIncome)}</b>`)
  }
  if (isAnomaly) {
    lines.push('')
    lines.push(`⚠️ <b>АНОМАЛИЯ:</b> выручка на ${dropPercent.toFixed(0)}% ниже среднего!`)
  }
  if (isSurge) {
    lines.push('')
    lines.push(`🚀 <b>Рекорд дня:</b> выручка на ${((totalIncome / avgDailyIncome - 1) * 100).toFixed(0)}% выше нормы!`)
  }

  if (topCats.length > 0) {
    lines.push('', '<b>Топ расходов:</b>')
    for (const [cat, val] of topCats) lines.push(`  • ${cat}: ${fmtMoney(val)}`)
  }

  await sendTg(chatId, lines.join('\n'))

  return NextResponse.json({ ok: true, date, totalIncome, totalExpense, profit })
}
