import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

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
    supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, online_amount, card_amount, operator_id, company_id, companies(name, code)')
      .eq('date', date),
    supabase.from('expenses').select('cash_amount, kaspi_amount, category').eq('date', date),
  ])

  // Fetch operator names for operators that worked today
  const operatorIds = [...new Set(
    (incomesRes.data ?? []).map((r: any) => r.operator_id).filter(Boolean)
  )]
  const operatorNames = new Map<string, string>()
  if (operatorIds.length > 0) {
    const { data: ops } = await supabase
      .from('operators')
      .select('id, name, short_name, operator_profiles(full_name)')
      .in('id', operatorIds)
    for (const op of ops ?? []) {
      const profile = Array.isArray((op as any).operator_profiles)
        ? (op as any).operator_profiles[0]
        : null
      const displayName = profile?.full_name || (op as any).short_name || op.name || 'Оператор'
      operatorNames.set(op.id, displayName)
    }
  }

  let totalIncome = 0
  let totalExpense = 0
  const opRevenue = new Map<string, number>()
  const companyRevenue = new Map<string, { name: string; total: number }>()
  const catMap = new Map<string, number>()

  for (const row of (incomesRes.data ?? []) as any[]) {
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
    totalIncome += total
    if (row.operator_id) opRevenue.set(row.operator_id, (opRevenue.get(row.operator_id) || 0) + total)
    if (row.company_id) {
      const compName = row.companies?.name || row.company_id
      const existing = companyRevenue.get(row.company_id)
      companyRevenue.set(row.company_id, { name: compName, total: (existing?.total || 0) + total })
    }
  }
  for (const row of (expensesRes.data ?? []) as any[]) {
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

  // 30-day rolling average for anomaly detection
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
  for (const row of (avgRes.data ?? []) as any[]) {
    const t = safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
    dayTotals.set(row.date, (dayTotals.get(row.date) || 0) + t)
  }
  const dayValues = Array.from(dayTotals.values()).filter(v => v > 0)
  const avgDailyIncome = dayValues.length > 0 ? dayValues.reduce((a, b) => a + b, 0) / dayValues.length : 0
  const dropPercent = avgDailyIncome > 0 ? ((avgDailyIncome - totalIncome) / avgDailyIncome) * 100 : 0
  const isAnomaly = avgDailyIncome > 0 && dropPercent > 30 && totalIncome < avgDailyIncome
  const isSurge = avgDailyIncome > 0 && totalIncome > avgDailyIncome * 1.3

  const lines = [
    `<b>☀️ Итоги дня</b>`,
    `<i>📅 ${date}</i>`,
    '',
    `💰 Выручка: <b>${fmtMoney(totalIncome)}</b>`,
    `📉 Расходы: <b>${fmtMoney(totalExpense)}</b>`,
    `💼 Прибыль: <b>${sign}${fmtMoney(profit)}</b>`,
    `${marginEmoji} Маржа: <b>${margin.toFixed(1)}%</b>`,
  ]

  if (avgDailyIncome > 0) {
    lines.push(`📊 Средняя выручка (30д): <b>${fmtMoney(avgDailyIncome)}</b>`)
  }

  // Per-company breakdown
  const sortedCompanies = Array.from(companyRevenue.values()).sort((a, b) => b.total - a.total)
  if (sortedCompanies.length > 1) {
    lines.push('', '<b>По точкам</b>')
    for (const { name, total } of sortedCompanies) {
      const pct = totalIncome > 0 ? Math.round((total / totalIncome) * 100) : 0
      lines.push(`  🏢 ${escapeTelegramHtml(name)}: <b>${fmtMoney(total)}</b> (${pct}%)`)
    }
  }

  // Operator breakdown
  const sortedOps = Array.from(opRevenue.entries()).sort((a, b) => b[1] - a[1])
  if (sortedOps.length > 0) {
    lines.push('', `<b>Операторы (${sortedOps.length})</b>`)
    for (const [opId, rev] of sortedOps) {
      const name = operatorNames.get(opId) || 'Оператор'
      lines.push(`  👤 ${escapeTelegramHtml(name)}: <b>${fmtMoney(rev)}</b>`)
    }
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
    lines.push('', '<b>Топ расходов</b>')
    for (const [cat, val] of topCats) lines.push(`  ▸ ${escapeTelegramHtml(cat)}: ${fmtMoney(val)}`)
  }

  const messageText = lines.join('\n')
  const recipients = [chatId, process.env.TELEGRAM_OWNER_CHAT_ID].filter(Boolean) as string[]
  const uniqueRecipients = [...new Set(recipients)]
  await Promise.all(
    uniqueRecipients.map((id) => sendTelegramMessage(id, messageText).then(() => null).catch(() => null)),
  )

  return NextResponse.json({ ok: true, date, totalIncome, totalExpense, profit, recipients: uniqueRecipients.length })
}
