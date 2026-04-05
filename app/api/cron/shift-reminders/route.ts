import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { requiredEnv } from '@/lib/server/env'

export const runtime = 'nodejs'

const KZ_OFFSET = 5 * 3600_000

function nowKZHour(): number {
  const d = new Date(Date.now() + KZ_OFFSET)
  return d.getUTCHours()
}

function todayKZISO(): string {
  const d = new Date(Date.now() + KZ_OFFSET)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

async function sendTg(chatId: string, text: string) {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

// Shift start hours (KZ time)
const SHIFT_TIMES: Record<string, { hour: number; label: string }> = {
  day: { hour: 9, label: '☀️ Дневная смена (09:00)' },
  night: { hour: 21, label: '🌙 Ночная смена (21:00)' },
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const currentHour = nowKZHour()
  const today = todayKZISO()

  // Find shift types that start in 1 hour from now
  const upcomingShiftTypes = Object.entries(SHIFT_TIMES)
    .filter(([, { hour }]) => hour === currentHour + 1)
    .map(([type]) => type)

  if (upcomingShiftTypes.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, hour: currentHour })
  }

  const supabase = createAdminSupabaseClient()

  const { data: shifts } = await supabase
    .from('shifts')
    .select('operator_id, shift_type, company:company_id(name), operators(telegram_chat_id, name, short_name, operator_profiles(full_name))')
    .eq('shift_date', today)
    .in('shift_type', upcomingShiftTypes)

  let sent = 0
  for (const shift of shifts ?? []) {
    const op = (shift as any).operators
    if (!op?.telegram_chat_id) continue

    const profiles = op.operator_profiles as Array<{ full_name: string | null }> | null
    const name = profiles?.[0]?.full_name || op.short_name || op.name || 'Оператор'
    const company = (shift as any).company?.name || ''
    const shiftLabel = SHIFT_TIMES[shift.shift_type]?.label || shift.shift_type

    const text = [
      `👋 <b>${name}</b>, напоминание!`,
      ``,
      `Через 1 час начинается твоя смена:`,
      `${shiftLabel}${company ? ` — ${company}` : ''}`,
      ``,
      `Не забудь прийти вовремя. Удачи! 💪`,
    ].join('\n')

    await sendTg(String(op.telegram_chat_id), text).catch(() => null)
    sent++
  }

  return NextResponse.json({ ok: true, hour: currentHour, upcomingShiftTypes, sent })
}
