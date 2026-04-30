import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
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

  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!chatId) return NextResponse.json({ ok: false, error: 'TELEGRAM_CHAT_ID not set' })

  const supabase = createAdminSupabaseClient()
  const today = todayKZISO()

  const { data: debts, error } = await supabase
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

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const overdue = debts || []
  if (overdue.length === 0) {
    return NextResponse.json({ ok: true, sent: false, count: 0 })
  }

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

  return NextResponse.json({ ok: true, sent: true, count: overdue.length, total: totalSum })
}
