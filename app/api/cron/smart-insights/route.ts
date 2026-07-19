/**
 * Cron: умные подсказки владельцу.
 * Раз в день анализирует данные и шлёт владельцу актуальные инсайты:
 * — операторы со штрафами или работающие подряд много дней
 * — резкие изменения выручки/расходов
 * — низкие остатки товаров
 * — задачи с истекающим сроком
 */

import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

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

// PostgREST режет ответ до 1000 строк — забираем постранично.
const PAGE = 1000
async function fetchAllPages(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
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
  const today = todayISO()
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const insights: string[] = []

  // Мультитенант: TELEGRAM_OWNER_ORG_ID → отчёт только по точкам этой орг.
  // Не задан → по всем (текущее поведение для единственного тенанта).
  const ownerOrgId = process.env.TELEGRAM_OWNER_ORG_ID || null
  let ownerCompanyIds: string[] | null = null
  if (ownerOrgId) {
    const { data: cos } = await supabase.from('companies').select('id').eq('organization_id', ownerOrgId)
    ownerCompanyIds = (cos || []).map((c: any) => String(c.id))
  }

  try {
    // 1. Сравнение выручки (вчера vs средняя за 7 дней)
    let incQ = supabase
      .from('incomes')
      .select('date, cash_amount, kaspi_amount, card_amount, online_amount')
      .gte('date', weekAgo)
      .lte('date', today)
    if (ownerCompanyIds) incQ = incQ.in('company_id', ownerCompanyIds)
    const { data: weekIncomes } = await incQ
    if (weekIncomes && weekIncomes.length > 0) {
      const byDate = new Map<string, number>()
      for (const i of weekIncomes as any[]) {
        const total = Number(i.cash_amount || 0) + Number(i.kaspi_amount || 0) + Number(i.card_amount || 0) + Number(i.online_amount || 0)
        byDate.set(i.date, (byDate.get(i.date) || 0) + total)
      }
      const yesterdaySum = byDate.get(yesterday) || 0
      const allDays = Array.from(byDate.values())
      const avg = allDays.reduce((s, x) => s + x, 0) / allDays.length
      if (yesterdaySum > 0 && avg > 0) {
        const pct = ((yesterdaySum - avg) / avg) * 100
        if (Math.abs(pct) >= 25) {
          const arrow = pct > 0 ? '📈' : '📉'
          insights.push(`${arrow} <b>Выручка вчера:</b> ${fmtMoney(yesterdaySum)} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}% к среднему за неделю)`)
        }
      }
    }

    // 2. Операторы работающие много дней подряд
    let shiftsQ = supabase
      .from('shifts')
      .select('operator_id, date, operator:operator_id(name, short_name)')
      .gte('date', weekAgo)
      .lte('date', today)
      .order('date', { ascending: false })
    if (ownerCompanyIds) shiftsQ = shiftsQ.in('company_id', ownerCompanyIds)
    const { data: shifts } = await shiftsQ
    if (shifts) {
      const byOp = new Map<string, { name: string; dates: Set<string> }>()
      for (const sh of shifts as any[]) {
        if (!sh.operator_id) continue
        const op = Array.isArray(sh.operator) ? sh.operator[0] : sh.operator
        const cur = byOp.get(sh.operator_id) || { name: op?.short_name || op?.name || '?', dates: new Set<string>() }
        cur.dates.add(sh.date)
        byOp.set(sh.operator_id, cur)
      }
      for (const [_, info] of byOp) {
        if (info.dates.size >= 6) {
          insights.push(`💪 <b>${info.name}</b> работал ${info.dates.size} дней из 7. Может выдать бонус?`)
        }
      }
    }

    // 3. Низкие остатки (скоуп по орг через товар — inventory_items.organization_id NOT NULL)
    // Балансов может быть >1000 (товары × локации) — постранично, иначе счёт «на исходе» врёт.
    const balances = await fetchAllPages((from, to) => {
      let balQ = supabase
        .from('inventory_balances')
        .select('quantity, item:item_id!inner(name, low_stock_threshold, organization_id)')
        .order('quantity')
        .order('item_id')
        .range(from, to)
      if (ownerOrgId) balQ = balQ.eq('item.organization_id', ownerOrgId)
      return balQ
    }).catch(() => null)
    if (balances) {
      let lowCount = 0
      const examples: string[] = []
      for (const b of balances as any[]) {
        const item = Array.isArray(b.item) ? b.item[0] : b.item
        const threshold = Number(item?.low_stock_threshold || 0)
        if (threshold > 0 && Number(b.quantity || 0) <= threshold) {
          lowCount++
          if (examples.length < 3 && item?.name) examples.push(item.name)
        }
      }
      if (lowCount > 0) {
        insights.push(`📦 <b>${lowCount} товаров</b> на исходе${examples.length ? ` (${examples.join(', ')})` : ''}. Заказать?`)
      }
    }

    // 4. Просроченные задачи
    const { data: overdueTasks } = await supabase
      .from('tasks')
      .select('id, title, due_date')
      .neq('status', 'done')
      .lt('due_date', today)
      .order('due_date')
      .limit(5)
    if (overdueTasks && overdueTasks.length > 0) {
      const titles = (overdueTasks as any[]).slice(0, 3).map((t) => t.title).join(', ')
      insights.push(`⚠️ <b>${overdueTasks.length} просроченных задач</b>: ${titles}`)
    }

    // 5. Расходы за неделю vs предыдущую
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
    let expQ = supabase
      .from('expenses')
      .select('date, cash_amount, kaspi_amount')
      .gte('date', twoWeeksAgo)
      .lte('date', today)
    if (ownerCompanyIds) expQ = expQ.in('company_id', ownerCompanyIds)
    const { data: expenses } = await expQ
    if (expenses && expenses.length > 0) {
      const thisWeek = (expenses as any[]).filter((e) => e.date >= weekAgo).reduce((s, e) => s + Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0), 0)
      const prevWeek = (expenses as any[]).filter((e) => e.date < weekAgo).reduce((s, e) => s + Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0), 0)
      if (prevWeek > 0) {
        const pct = ((thisWeek - prevWeek) / prevWeek) * 100
        if (Math.abs(pct) >= 30) {
          const arrow = pct > 0 ? '📈' : '📉'
          insights.push(`${arrow} <b>Расходы за неделю:</b> ${fmtMoney(thisWeek)} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}% к предыдущей)`)
        }
      }
    }

    if (insights.length === 0) {
      return NextResponse.json({ ok: true, sent: false, reason: 'no insights' })
    }

    const text = `🔮 <b>Подсказки на сегодня:</b>\n\n${insights.join('\n\n')}\n\n<i>Можешь ответить боту: "выдай Айгерим бонус 5к", "поставь задачу заказать колу", и т.п.</i>`
    await sendTelegramMessage(ownerChatId, text, { parseMode: 'HTML' })

    return NextResponse.json({ ok: true, sent: true, count: insights.length })
  } catch (e: any) {
    console.error('[smart-insights] error:', e?.message)
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
