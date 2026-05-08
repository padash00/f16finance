/**
 * Cron: AI утренний инсайт владельцу.
 *
 * Раз в день (через Vercel Cron) собирает ключевые цифры за вчера и за неделю,
 * скармливает их в GPT с компактным промптом, и присылает владельцу
 * персонализированный «утренний обзор» в стиле AI-бухгалтера.
 *
 * В отличие от smart-insights/route.ts (правила-если-то) — этот выдаёт
 * человеческий текст, который меняется день ото дня и звучит живо.
 *
 * Расход на токены: ~300-500 input + ~200 output ≈ $0.0005 на компанию/день
 * с gpt-4o-mini.
 */

import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'
import { generateAiText } from '@/lib/ai/provider'

export const runtime = 'nodejs'

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtMoney(v: number) {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
  if (Math.abs(v) >= 1_000) return Math.round(v / 1_000) + 'к ₸'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

interface InsightData {
  yesterday: string
  yesterdayIncome: number
  weekAvgIncome: number
  yesterdayOperators: { name: string; sales: number; income: number }[]
  topProductsYesterday: { name: string; qty: number }[]
  lowStock: { name: string; qty: number }[]
  weekIncomeTrend: { date: string; income: number }[]
  cashAtPoint: number | null
  overdueDebts: number
  pendingTasks: number
}

async function collectInsights(supabase: ReturnType<typeof createAdminSupabaseClient>): Promise<InsightData> {
  const today = todayISO()
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

  const data: InsightData = {
    yesterday,
    yesterdayIncome: 0,
    weekAvgIncome: 0,
    yesterdayOperators: [],
    topProductsYesterday: [],
    lowStock: [],
    weekIncomeTrend: [],
    cashAtPoint: null,
    overdueDebts: 0,
    pendingTasks: 0,
  }

  try {
    // Выручка за неделю по дням
    const { data: incomes } = await supabase
      .from('incomes')
      .select('date, cash_amount, kaspi_amount, card_amount, online_amount')
      .gte('date', weekAgo)
      .lte('date', today)
    if (incomes) {
      const byDate = new Map<string, number>()
      for (const i of incomes as any[]) {
        const total = Number(i.cash_amount || 0) + Number(i.kaspi_amount || 0) + Number(i.card_amount || 0) + Number(i.online_amount || 0)
        byDate.set(i.date, (byDate.get(i.date) || 0) + total)
      }
      data.yesterdayIncome = byDate.get(yesterday) || 0
      const arr = Array.from(byDate.values())
      data.weekAvgIncome = arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0
      data.weekIncomeTrend = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, income]) => ({ date, income }))
    }

    // Кто работал вчера и сколько чеков сделал
    const { data: shifts } = await supabase
      .from('shifts')
      .select('id, operator_id, operator:operator_id(name, short_name)')
      .eq('date', yesterday)
    if (shifts && shifts.length > 0) {
      const shiftIds = (shifts as any[]).map((s) => s.id)
      const { data: sales } = await supabase
        .from('point_inventory_sales')
        .select('shift_id, total_amount')
        .in('shift_id', shiftIds)
      const byShift = new Map<string, { count: number; sum: number }>()
      for (const s of (sales as any[]) || []) {
        const cur = byShift.get(s.shift_id) || { count: 0, sum: 0 }
        cur.count++
        cur.sum += Number(s.total_amount || 0)
        byShift.set(s.shift_id, cur)
      }
      for (const sh of shifts as any[]) {
        const op = Array.isArray(sh.operator) ? sh.operator[0] : sh.operator
        const stats = byShift.get(sh.id) || { count: 0, sum: 0 }
        if (op?.name && stats.count > 0) {
          data.yesterdayOperators.push({
            name: op.short_name || op.name,
            sales: stats.count,
            income: stats.sum,
          })
        }
      }
      data.yesterdayOperators.sort((a, b) => b.income - a.income)
    }

    // Топ продуктов за вчера
    const { data: saleItems } = await supabase
      .from('point_inventory_sale_items')
      .select('quantity, item:item_id(name), sale:sale_id!inner(sale_date)')
      .eq('sale.sale_date', yesterday)
      .limit(500)
    if (saleItems) {
      const byProduct = new Map<string, number>()
      for (const it of saleItems as any[]) {
        const item = Array.isArray(it.item) ? it.item[0] : it.item
        const name = item?.name
        if (!name) continue
        byProduct.set(name, (byProduct.get(name) || 0) + Number(it.quantity || 0))
      }
      data.topProductsYesterday = Array.from(byProduct.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, qty]) => ({ name, qty }))
    }

    // Низкие остатки
    const { data: balances } = await supabase
      .from('inventory_balances')
      .select('quantity, item:item_id(name, low_stock_threshold)')
    if (balances) {
      for (const b of balances as any[]) {
        const item = Array.isArray(b.item) ? b.item[0] : b.item
        const threshold = Number(item?.low_stock_threshold || 0)
        const qty = Number(b.quantity || 0)
        if (threshold > 0 && qty <= threshold && data.lowStock.length < 5) {
          data.lowStock.push({ name: item?.name || '?', qty })
        }
      }
    }

    // Просроченные долги клиентов
    const { count: overdueDebtsCount } = await supabase
      .from('debts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .lt('due_date', today)
    data.overdueDebts = overdueDebtsCount || 0

    // Открытые задачи
    const { count: pendingTasksCount } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'done')
    data.pendingTasks = pendingTasksCount || 0
  } catch (e: any) {
    console.error('[morning-ai-insight] collect error:', e?.message)
  }

  return data
}

function buildPrompt(d: InsightData): string {
  const trendStr = d.weekIncomeTrend.map((t) => `${t.date}: ${fmtMoney(t.income)}`).join(', ')
  const opsStr = d.yesterdayOperators.length
    ? d.yesterdayOperators.map((o) => `${o.name} (${o.sales} чеков, ${fmtMoney(o.income)})`).join(', ')
    : 'нет данных'
  const topStr = d.topProductsYesterday.length
    ? d.topProductsYesterday.map((p) => `${p.name} (${p.qty} шт)`).join(', ')
    : 'нет данных'
  const lowStr = d.lowStock.length ? d.lowStock.map((l) => `${l.name}: ${l.qty}`).join(', ') : 'все ок'

  return [
    'Ты AI-помощник владельца компьютерного клуба в Казахстане. Прислал тебе данные за вчера и неделю.',
    `Вчера (${d.yesterday}) выручка: ${fmtMoney(d.yesterdayIncome)}`,
    `Среднее за неделю: ${fmtMoney(d.weekAvgIncome)}`,
    `Тренд недели: ${trendStr}`,
    `Операторы вчера: ${opsStr}`,
    `Топ товары вчера: ${topStr}`,
    `Низкие остатки: ${lowStr}`,
    `Просроченных долгов: ${d.overdueDebts}, открытых задач: ${d.pendingTasks}`,
    '',
    'Напиши КОРОТКОЕ утреннее сообщение владельцу (до 6 строк). Стиль: дружелюбный, энергичный, без воды. Используй эмодзи 1-2. Если есть аномалии (выручка резко упала/выросла, кончается товар, операторы переработали) — выдели их в первую очередь. Если день обычный — отметь это и дай 1 короткий совет на день. Не повторяй "доброе утро" если уже было.',
    'НЕ начинай с "Привет"/"Здравствуй". Начни с эмодзи и сразу к сути.',
  ].join('\n')
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!ownerChatId) {
    return NextResponse.json({ ok: true, skipped: 'no TELEGRAM_OWNER_CHAT_ID' })
  }

  const supabase = createAdminSupabaseClient()
  const insights = await collectInsights(supabase)

  // Если совсем нет данных — пропускаем
  if (insights.yesterdayIncome === 0 && insights.weekAvgIncome === 0 && insights.yesterdayOperators.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'no data yesterday' })
  }

  const prompt = buildPrompt(insights)

  try {
    const result = await generateAiText({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens: 300,
      messages: [
        { role: 'system', content: 'Ты — AI-ассистент владельца компьютерного клуба. Пиши кратко, по делу, на русском.' },
        { role: 'user', content: prompt },
      ],
    })

    const text = `🌅 <b>Утренний обзор</b>\n\n${result.text}\n\n<i>Спроси что-нибудь у бота, если хочешь подробнее.</i>`
    await sendTelegramMessage(ownerChatId, text, { parseMode: 'HTML' })

    return NextResponse.json({
      ok: true,
      sent: true,
      tokens: result.usage?.total_tokens || null,
      yesterdayIncome: insights.yesterdayIncome,
    })
  } catch (e: any) {
    console.error('[morning-ai-insight] error:', e?.message)
    // Fallback на минимальный текст без AI, если OpenAI лежит
    try {
      const fallback = `🌅 <b>Утренний обзор</b>\n\nВчера выручка: <b>${fmtMoney(insights.yesterdayIncome)}</b> (среднее за неделю: ${fmtMoney(insights.weekAvgIncome)})\n${insights.yesterdayOperators.length ? `Лучший: ${insights.yesterdayOperators[0].name} — ${fmtMoney(insights.yesterdayOperators[0].income)}\n` : ''}${insights.lowStock.length ? `\n⚠️ На исходе: ${insights.lowStock.slice(0, 3).map((l) => l.name).join(', ')}\n` : ''}${insights.overdueDebts > 0 ? `\n💰 Просроченных долгов: ${insights.overdueDebts}` : ''}`
      await sendTelegramMessage(ownerChatId, fallback, { parseMode: 'HTML' })
      return NextResponse.json({ ok: true, sent: true, fallback: true, error: e?.message })
    } catch (fallbackErr: any) {
      return NextResponse.json({ ok: false, error: e?.message, fallbackError: fallbackErr?.message }, { status: 500 })
    }
  }
}
