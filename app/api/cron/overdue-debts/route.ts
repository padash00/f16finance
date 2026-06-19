import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
import { listOrgReportTargets } from '@/lib/server/report-targets'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

const KZ_OFFSET = 5 * 3600_000

function todayKZISO() {
  const now = new Date(Date.now() + KZ_OFFSET)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function fmtMoney(v: number) {
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('ru-RU')
  } catch {
    return String(value)
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const today = todayKZISO()

  // Изоляция: для каждой организации — только её просроченные долги в её чат.
  // Сбор данных + сообщение по одной (орг-скоуп: organizationId | null = все).
  async function runForScope(organizationId: string | null, chatId: string) {
    let q = supabase
      .from('supplier_debts')
      .select(
        `id, total_amount, due_date, is_consignment, organization_id,
         supplier:supplier_id(id, name, organization_name),
         receipt:receipt_id(id, invoice_number, received_at)`,
      )
      .eq('status', 'open')
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(50)
    if (organizationId) q = q.eq('organization_id', organizationId)
    const { data: debts, error } = await q
    if (error) throw new Error(error.message)

    const overdue = debts || []
    if (overdue.length === 0) return { sent: false, count: 0, total: 0 }

    const totalSum = overdue.reduce((acc: number, row: any) => acc + Number(row.total_amount || 0), 0)
    const lines: string[] = []
    lines.push(`<b>⚠️ Просроченные долги поставщикам</b>`)
    lines.push('')
    lines.push(`Всего: <b>${overdue.length}</b> · Сумма: <b>${escapeTelegramHtml(fmtMoney(totalSum))}</b>`)
    lines.push('')
    for (const row of overdue.slice(0, 20) as any[]) {
      const supplierName = row.supplier?.organization_name || row.supplier?.name || '—'
      const invoiceNo = row.receipt?.invoice_number || `#${String(row.receipt?.id || '').slice(0, 8)}`
      const due = fmtDate(row.due_date)
      const tag = row.is_consignment ? ' [реализация]' : ''
      lines.push(`• ${escapeTelegramHtml(supplierName)} · ${escapeTelegramHtml(invoiceNo)} · срок ${escapeTelegramHtml(due)} · <b>${escapeTelegramHtml(fmtMoney(Number(row.total_amount || 0)))}</b>${tag}`)
    }
    if (overdue.length > 20) {
      lines.push('')
      lines.push(`<i>... и ещё ${overdue.length - 20}</i>`)
    }
    await sendTelegramMessage(chatId, lines.join('\n'), { parseMode: 'HTML' })
    return { sent: true, count: overdue.length, total: totalSum }
  }

  try {
    const orgTargets = await listOrgReportTargets()
    if (orgTargets.length > 0) {
      const results = []
      for (const t of orgTargets) results.push({ org: t.organizationId, ...(await runForScope(t.organizationId, t.chatId)) })
      return NextResponse.json({ ok: true, perOrg: true, results })
    }
    // Прежнее поведение (нет per-org настройки): общий чат, без скоупа.
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (!chatId) return NextResponse.json({ ok: false, error: 'TELEGRAM_CHAT_ID not set' })
    const r = await runForScope(null, chatId)
    return NextResponse.json({ ok: true, perOrg: false, ...r })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 })
  }
}
