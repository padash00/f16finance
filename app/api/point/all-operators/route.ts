import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase } = point

    const { data, error } = await supabase
      .from('operators')
      .select('id, name, short_name, is_active, operator_profiles(full_name)')
      .eq('is_active', true)

    if (error) throw error

    const operators = ((data || []) as any[])
      .map((op) => {
        if (!op?.id || op.is_active === false) return null
        const profile = Array.isArray(op.operator_profiles)
          ? op.operator_profiles[0] || null
          : op.operator_profiles || null
        return {
          id: op.id,
          name: op.name,
          short_name: op.short_name || null,
          full_name: profile?.full_name || null,
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'))

    return json({ ok: true, operators })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-all-operators',
      message: error?.message || 'Failed to load operators',
    })
    return json({ error: error?.message || 'Не удалось загрузить операторов' }, 500)
  }
}
