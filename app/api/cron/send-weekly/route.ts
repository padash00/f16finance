import { NextResponse } from 'next/server'

import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { requiredEnv } from '@/lib/server/env'
import { buildSalaryTelegramMessage, getOperatorSalarySnapshot } from '@/lib/server/services/salary'
import { listWeeklyTelegramOperators } from '@/lib/server/repositories/salary'
import { ordaTelegramFrame } from '@/lib/telegram/message-kit'

export const runtime = 'nodejs'

const KZ_OFFSET_HOURS = 5

function getPrevWeekKZ() {
  const now = new Date(Date.now() + KZ_OFFSET_HOURS * 3600_000)
  const dayOffset = (now.getUTCDay() + 6) % 7

  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - dayOffset - 7)

  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  const toISO = (date: Date) =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
      date.getUTCDate(),
    ).padStart(2, '0')}`

  return {
    from: toISO(monday),
    to: toISO(sunday),
    weekMonday: toISO(monday),
  }
}

async function sendTelegramMessage(chatId: string, text: string) {
  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN')
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: chatId,
      text: ordaTelegramFrame(text),
      parse_mode: 'HTML',
      disable_web_page_preview: 'true',
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!payload?.ok) {
    throw new Error(`TG: ${JSON.stringify(payload)}`)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')

  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const companyCode = process.env.SUPABASE_COMPANY_CODE || 'arena'
  const { from, to, weekMonday } = getPrevWeekKZ()

  const supabase = createAdminSupabaseClient()
  const operators = await listWeeklyTelegramOperators(supabase)

  let sent = 0
  let failed = 0
  const errors: Array<{ name: string; error: string }> = []

  for (const operator of operators) {
    try {
      const snapshot = await getOperatorSalarySnapshot(supabase, {
        operatorId: operator.id,
        dateFrom: from,
        dateTo: to,
        weekStart: weekMonday,
        companyCode,
      })

      const text = buildSalaryTelegramMessage({
        operatorName: operator.short_name || operator.name || 'Оператор',
        dateFrom: from,
        dateTo: to,
        weekStart: snapshot.weekStart,
        weekEnd: snapshot.weekEnd,
        summary: snapshot,
      })

      if (!dryRun) {
        await sendTelegramMessage(String(operator.telegram_chat_id), text)
        await sleep(350)
      }

      sent += 1
    } catch (error: any) {
      failed += 1
      errors.push({
        name: operator.name,
        error: String(error?.message || error).slice(0, 300),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    company_code: companyCode,
    period: { from, to, weekMonday },
    total: operators.length,
    sent,
    failed,
    errors,
  })
}
