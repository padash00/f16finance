import { NextResponse } from 'next/server'

import { resolvePointOperatorLoginForDevice } from '@/lib/server/point-operator-login'
import { loadPointProjectContext } from '@/lib/server/point-devices'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

type Body = {
  nonce?: string
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'service-unavailable' }, 503)
    }

    const ctx = await getRequestOperatorContext(request)
    if ('response' in ctx) return ctx.response

    const userId = ctx.user?.id
    if (!userId) {
      return json({ error: 'unauthorized' }, 401)
    }

    const body = (await request.json().catch(() => null)) as Body | null
    const nonce = typeof body?.nonce === 'string' ? body.nonce.trim() : ''
    if (!nonce) {
      return json({ error: 'nonce-required' }, 400)
    }

    const admin = createAdminSupabaseClient()
    const nowIso = new Date().toISOString()

    const { data: row, error: fetchError } = await admin
      .from('point_qr_login_challenges')
      .select('id, status, expires_at, point_project_id')
      .eq('nonce', nonce)
      .eq('status', 'pending')
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!row) {
      return json({ error: 'invalid-or-used-code' }, 404)
    }

    if (new Date(row.expires_at as string).getTime() <= Date.now()) {
      await admin.from('point_qr_login_challenges').update({ status: 'expired' }).eq('id', row.id)
      return json({ error: 'code-expired' }, 410)
    }

    const project = await loadPointProjectContext(String(row.point_project_id))
    if (!project) {
      return json({ error: 'point-unavailable' }, 503)
    }

    const resolved = await resolvePointOperatorLoginForDevice({
      supabase: project.supabase,
      device: project.device,
      authUserId: userId,
      audit: { method: 'qr', enteredUsername: ctx.operatorAuth.username || undefined },
    })

    if (!resolved.ok) {
      return json({ error: resolved.error }, resolved.status)
    }

    if (resolved.body.must_change_password) {
      return json(
        {
          error: 'must-change-password-web-first',
          message: 'Войдите по паролю на терминале или смените временный пароль в кабинете.',
        },
        403,
      )
    }

    const { data: updatedRows, error: updateError } = await admin
      .from('point_qr_login_challenges')
      .update({
        status: 'approved',
        result: resolved.body as unknown as Record<string, unknown>,
        approved_at: nowIso,
        approved_user_id: userId,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')

    if (updateError) throw updateError
    if (!updatedRows?.length) {
      return json({ error: 'invalid-or-used-code' }, 409)
    }

    return json({ ok: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'point-qr-confirm'
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-qr-confirm',
      message,
    })
    return json({ error: 'confirm-failed' }, 500)
  }
}
