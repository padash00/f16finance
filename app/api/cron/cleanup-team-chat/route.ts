/**
 * Общий чат живёт сутки.
 *
 * Чат точки — это разговор смены: «принял кассу», «кончилась лента», фото
 * витрины. Через день он не нужен никому, а место занимает всерьёз: вложения
 * до 50 МБ каждое, и хранилище растёт быстрее, чем что-либо ещё в системе.
 *
 * Поэтому раз в сутки всё старше суток стирается вместе с файлами. Удалять
 * только строки бессмысленно: место занимают именно вложения, а без сообщения
 * файл превращается в мусор, на который никто уже не сошлётся.
 *
 * Что переживает уборку:
 *   — закреплённые сообщения, пока закрепление не истекло: их закрепили
 *     намеренно, чтобы висели;
 *   — объявления (`is_announcement`): это не болтовня смены, а то, что
 *     руководитель сказал команде.
 *
 * Опросы, реакции и голоса уезжают каскадом вместе с сообщением — они без него
 * не значат ничего.
 */
import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const RETENTION_HOURS = 24
const BUCKET = 'team-chat-attachments'

/** Путь файла внутри бакета из публичной ссылки. */
function storagePath(url: string): string | null {
  const marker = `/${BUCKET}/`
  const index = url.indexOf(marker)
  if (index === -1) return null
  const path = url.slice(index + marker.length).split('?')[0]
  return path ? decodeURIComponent(path) : null
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get('authorization') || ''
    if (auth !== `Bearer ${requiredEnv('CRON_SECRET')}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const supabase = createAdminSupabaseClient()
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()

    const { data: rows, error } = await supabase
      .from('team_chat_messages')
      .select('id, attachments, pinned_until, is_announcement')
      .lt('created_at', cutoff)
      .limit(5000)

    if (error) throw error

    const doomed = ((rows as any[]) || []).filter((row) => {
      if (row.is_announcement === true) return false
      // Закрепление могло уже истечь — такое сообщение больше не висит и
      // ничем не отличается от обычного.
      if (row.pinned_until && String(row.pinned_until) > now) return false
      return true
    })

    if (doomed.length === 0) {
      return NextResponse.json({ ok: true, cutoff, deleted: 0, files: 0 })
    }

    const files = doomed
      .flatMap((row) => (Array.isArray(row.attachments) ? row.attachments : []))
      .map((item: any) => (typeof item?.url === 'string' ? storagePath(item.url) : null))
      .filter((path): path is string => Boolean(path))

    // Файлы первыми: если упадём после удаления строк, ссылок на них уже не
    // будет, и место останется занятым навсегда.
    if (files.length > 0) {
      // Пачками: у Storage есть предел на размер запроса.
      for (let index = 0; index < files.length; index += 100) {
        await supabase.storage.from(BUCKET).remove(files.slice(index, index + 100))
      }
    }

    const ids = doomed.map((row) => row.id)
    for (let index = 0; index < ids.length; index += 500) {
      const { error: deleteError } = await supabase
        .from('team_chat_messages')
        .delete()
        .in('id', ids.slice(index, index + 500))
      if (deleteError) throw deleteError
    }

    await writeAuditLog(supabase, {
      entityType: 'team-chat',
      entityId: 'retention',
      action: 'cleanup-24h',
      payload: { cutoff, deleted: ids.length, files: files.length },
    })

    return NextResponse.json({ ok: true, cutoff, deleted: ids.length, files: files.length })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/cron/cleanup-team-chat',
      message: error?.message || 'team chat cleanup error',
    })
    return NextResponse.json({ ok: false, error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
