import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const url = new URL(request.url)
    const nonce = url.searchParams.get('nonce')?.trim()
    if (!nonce) {
      return json({ error: 'nonce-required' }, 400)
    }

    const { data: row, error } = await supabase
      .from('point_qr_login_challenges')
      .select('id, status, result, expires_at, point_project_id')
      .eq('nonce', nonce)
      .eq('point_project_id', device.id)
      .maybeSingle()

    if (error) throw error
    if (!row) {
      return json({ error: 'not-found' }, 404)
    }

    const now = Date.now()
    const exp = new Date(row.expires_at as string).getTime()

    if (row.status === 'pending' && now > exp) {
      await supabase.from('point_qr_login_challenges').update({ status: 'expired' }).eq('id', row.id)
      return json({ status: 'expired' })
    }

    if (row.status === 'pending') {
      return json({ status: 'pending' })
    }

    if (row.status === 'expired') {
      return json({ status: 'expired' })
    }

    if (row.status === 'consumed') {
      return json({ status: 'consumed' })
    }

    if (row.status === 'approved' && row.result && typeof row.result === 'object') {
      const { error: upError } = await supabase
        .from('point_qr_login_challenges')
        .update({ status: 'consumed' })
        .eq('id', row.id)
        .eq('status', 'approved')

      if (upError) throw upError

      return json({ status: 'ready', ...(row.result as Record<string, unknown>) })
    }

    return json({ status: 'expired' })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'point-qr-login-poll'
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-qr-login-poll',
      message,
    })
    return json({ error: 'poll-failed' }, 500)
  }
}
