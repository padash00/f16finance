import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const CHAT_RETENTION_HOURS = 24

function getRetentionCutoffISO() {
  return new Date(Date.now() - CHAT_RETENTION_HOURS * 60 * 60 * 1000).toISOString()
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get('authorization') || ''
    const cronSecret = requiredEnv('CRON_SECRET')

    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const supabase = createAdminSupabaseClient()
    const cutoff = getRetentionCutoffISO()

    const { data: oldMessages, error: selectError } = await supabase
      .from('operator_chat_messages')
      .select('id', { count: 'exact' })
      .lt('created_at', cutoff)

    if (selectError) {
      throw selectError
    }

    const ids = (oldMessages || []).map((item: any) => item.id)
    let deleted = 0

    if (ids.length > 0) {
      const { error: deleteError } = await supabase.from('operator_chat_messages').delete().in('id', ids)
      if (deleteError) {
        throw deleteError
      }
      deleted = ids.length
    }

    await writeAuditLog(supabase, {
      entityType: 'operator-chat',
      entityId: 'retention',
      action: 'cleanup-24h',
      payload: {
        cutoff,
        deleted,
      },
    })

    return NextResponse.json({
      ok: true,
      retentionHours: CHAT_RETENTION_HOURS,
      cutoff,
      deleted,
    })
  } catch (error: any) {
    console.error('Operator chat cleanup cron error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/cron/cleanup-operator-chat',
      message: error?.message || 'Operator chat cleanup cron error',
    })
    return NextResponse.json({ ok: false, error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
