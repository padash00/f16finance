/**
 * Голосовать в опросе.
 * POST { optionId } — поставить голос (или убрать если уже стоит — toggle)
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pollId: string }> },
) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const { pollId } = await params
  const body = (await request.json().catch(() => null)) as { optionId?: string } | null
  const optionId = String(body?.optionId || '').trim()
  if (!optionId) return json({ error: 'optionId обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Проверяем что опрос есть и не истёк
  const { data: poll } = await supabase
    .from('team_chat_polls')
    .select('id, options, multiple_choice, expires_at')
    .eq('id', pollId)
    .maybeSingle()
  if (!poll) return json({ error: 'Опрос не найден' }, 404)
  if ((poll as any).expires_at && new Date((poll as any).expires_at).getTime() < Date.now()) {
    return json({ error: 'Опрос завершён' }, 400)
  }
  const validIds: string[] = ((poll as any).options || []).map((o: any) => o.id)
  if (!validIds.includes(optionId)) return json({ error: 'Вариант не найден' }, 400)

  // Имя голосующего
  let voterName = access.user.email || 'Аноним'
  if (access.staffMember) voterName = access.staffMember.full_name || voterName
  else if (access.operatorAuth) {
    const { data: op } = await supabase.from('operators').select('short_name, name').eq('id', access.operatorAuth.operator_id).maybeSingle()
    voterName = (op as any)?.short_name || (op as any)?.name || voterName
  }

  // Toggle: если уже голосовал за этот вариант — снимаем
  const { data: existing } = await supabase
    .from('team_chat_poll_votes')
    .select('id')
    .eq('poll_id', pollId)
    .eq('voter_user_id', access.user.id)
    .eq('option_id', optionId)
    .maybeSingle()

  if (existing) {
    await supabase.from('team_chat_poll_votes').delete().eq('id', (existing as any).id)
    return json({ ok: true, removed: true })
  }

  // Если не multiple_choice — удаляем все предыдущие голоса этого юзера за этот опрос
  if (!(poll as any).multiple_choice) {
    await supabase
      .from('team_chat_poll_votes')
      .delete()
      .eq('poll_id', pollId)
      .eq('voter_user_id', access.user.id)
  }

  const { error } = await supabase.from('team_chat_poll_votes').insert({
    poll_id: pollId,
    voter_user_id: access.user.id,
    voter_name: voterName,
    option_id: optionId,
  })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, added: true })
}
