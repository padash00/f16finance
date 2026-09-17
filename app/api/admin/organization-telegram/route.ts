import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Чат владельца для cron/бот-отчётов организации
 * (`organizations.telegram_owner_chat_id`, читает lib/server/report-targets.ts).
 *
 * Раньше поле правили только SQL-ом — клиент без доступа к Supabase не мог
 * включить себе ежедневные отчёты. Пишем ТОЛЬКО активную организацию вызывающего.
 * requireCapability пропускает владельца и супер-админа, остальным нужен
 * 'telegram.setup_webhook'.
 */

const CHAT_ID_RE = /^-?\d+$/

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const denied = await requireCapability(access, 'telegram.setup_webhook')
  if (denied) return denied

  const orgId = access.activeOrganization?.id || null
  if (!orgId) return NextResponse.json({ ok: true, chatId: null, organizationId: null })
  if (!hasAdminSupabaseCredentials()) return NextResponse.json({ ok: true, chatId: null, organizationId: orgId })

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('organizations')
    .select('telegram_owner_chat_id')
    .eq('id', orgId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    organizationId: orgId,
    chatId: (data as { telegram_owner_chat_id?: string | null } | null)?.telegram_owner_chat_id || null,
  })
}

export async function PUT(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const denied = await requireCapability(access, 'telegram.setup_webhook')
  if (denied) return denied

  const orgId = access.activeOrganization?.id || null
  if (!orgId) return NextResponse.json({ error: 'Организация не выбрана' }, { status: 400 })
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'Supabase admin недоступен' }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  const chatId = String((body as { chatId?: unknown }).chatId ?? '').trim()
  if (chatId && !CHAT_ID_RE.test(chatId)) {
    return NextResponse.json({ error: 'Chat ID должен быть числом (у групп начинается с «-»)' }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()
  const { error } = await supabase
    .from('organizations')
    .update({ telegram_owner_chat_id: chatId || null })
    .eq('id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog(supabase, {
    actorUserId: access.user?.id || null,
    entityType: 'organization',
    entityId: orgId,
    action: 'telegram_owner_chat_updated',
    payload: { chat_id: chatId || null },
    organizationId: orgId,
  })

  return NextResponse.json({ ok: true, chatId: chatId || null })
}
