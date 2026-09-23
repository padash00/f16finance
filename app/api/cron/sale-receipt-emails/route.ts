import { NextResponse } from 'next/server'

import { verifyCronRequest } from '@/lib/server/cron-auth'
import { processSaleReceiptEmailQueue } from '@/lib/server/sale-receipt-email'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

// Добирает письма с чеками, которые не ушли с первой попытки: SMTP отказал,
// сеть моргнула. Паузы растут (1 мин, 5, 15, 60), после пятой неудачи — failed.

export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await processSaleReceiptEmailQueue(createAdminSupabaseClient())
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'queue-failed' }, { status: 500 })
  }
}
