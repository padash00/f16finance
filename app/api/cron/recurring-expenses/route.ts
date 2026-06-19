import { NextResponse } from 'next/server'

import { requiredEnv } from '@/lib/server/env'
import { listOrgReportTargets } from '@/lib/server/report-targets'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

const KZ_OFFSET = 5 * 3600_000

function todayKZ() {
  const now = new Date(Date.now() + KZ_OFFSET)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return { iso, dayOfMonth: d.getUTCDate(), monthKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
}

function fmtMoney(v: number) {
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const { iso: today, dayOfMonth, monthKey } = todayKZ()

  const { data: templates, error } = await supabase
    .from('expense_templates')
    .select('id, name, category, amount, payment_type, company_id, comment, recurring_day_of_month, recurring_last_run_at')
    .eq('recurring_active', true)
    .eq('recurring_day_of_month', dayOfMonth)
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const due = (templates || []).filter((t: any) => {
    if (!t.recurring_last_run_at) return true
    const last = String(t.recurring_last_run_at).slice(0, 7) // YYYY-MM
    return last !== monthKey
  })

  if (due.length === 0) {
    return NextResponse.json({ ok: true, created: 0 })
  }

  const created: Array<{ template_id: string; expense_id: string; amount: number; name: string; company_id: string }> = []
  for (const t of due as any[]) {
    if (!t.company_id) continue
    const amount = Number(t.amount || 0)
    if (amount <= 0) continue

    const expensePayload: Record<string, unknown> = {
      date: today,
      company_id: t.company_id,
      operator_id: null,
      category: String(t.category || '').trim(),
      cash_amount: t.payment_type === 'kaspi' ? 0 : amount,
      kaspi_amount: t.payment_type === 'kaspi' ? amount : 0,
      comment: `Авто из шаблона "${t.name}"${t.comment ? `\n${t.comment}` : ''}`,
      status: 'pending_approval',
    }

    const { data: inserted, error: insertError } = await supabase
      .from('expenses')
      .insert([expensePayload])
      .select('id')
      .single()
    if (insertError || !inserted?.id) continue

    await supabase
      .from('expense_templates')
      .update({ recurring_last_run_at: today })
      .eq('id', t.id)

    created.push({ template_id: t.id, expense_id: String(inserted.id), amount, name: t.name, company_id: String(t.company_id) })
  }

  // Изоляция Telegram-свода: каждой орг — только её созданные расходы в её чат.
  function buildSummary(items: typeof created): string {
    const totalSum = items.reduce((s, c) => s + c.amount, 0)
    const lines: string[] = []
    lines.push('<b>🔁 Повторяющиеся расходы созданы</b>')
    lines.push('')
    lines.push(`Всего: <b>${items.length}</b> · Сумма: <b>${escapeTelegramHtml(fmtMoney(totalSum))}</b>`)
    lines.push('')
    for (const c of items) lines.push(`• ${escapeTelegramHtml(c.name)} · <b>${escapeTelegramHtml(fmtMoney(c.amount))}</b>`)
    lines.push('')
    lines.push('<i>Расходы в статусе pending_approval — подтверди в /expenses/pending</i>')
    return lines.join('\n')
  }

  if (created.length > 0) {
    const orgTargets = await listOrgReportTargets()
    if (orgTargets.length > 0) {
      for (const t of orgTargets) {
        const allow = new Set(t.companyIds || [])
        const mine = created.filter((c) => allow.has(c.company_id))
        if (mine.length > 0) await sendTelegramMessage(t.chatId, buildSummary(mine), { parseMode: 'HTML' })
      }
    } else {
      const chatId = process.env.TELEGRAM_CHAT_ID
      if (chatId) await sendTelegramMessage(chatId, buildSummary(created), { parseMode: 'HTML' })
    }
  }

  return NextResponse.json({ ok: true, created: created.length, items: created })
}
