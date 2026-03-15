import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point

    const { data: assignments, error: assignmentsError } = await supabase
      .from('operator_company_assignments')
      .select(
        'id, operator_id, company_id, role_in_company, is_primary, is_active, operator:operator_id(id, name, short_name, telegram_chat_id, is_active, operator_profiles(*))',
      )
      .eq('company_id', device.company_id)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    if (assignmentsError) throw assignmentsError

    const operators = ((assignments || []) as any[])
      .map((row) => {
        const operator = Array.isArray(row.operator) ? row.operator[0] || null : row.operator || null
        if (!operator?.id) return null
        const profile = Array.isArray(operator.operator_profiles) ? operator.operator_profiles[0] || null : null

        return {
          id: operator.id,
          name: operator.name,
          short_name: operator.short_name || null,
          full_name: profile?.full_name || null,
          telegram_chat_id: operator.telegram_chat_id || null,
          is_active: operator.is_active !== false,
          role_in_company: row.role_in_company,
          is_primary: !!row.is_primary,
        }
      })
      .filter(Boolean)

    await writeAuditLog(supabase, {
      entityType: 'point-device',
      entityId: device.id,
      action: 'bootstrap',
      payload: {
        company_id: device.company_id,
        operator_count: operators.length,
        point_mode: device.point_mode,
      },
    })

    return json({
      ok: true,
      device: {
        id: device.id,
        name: device.name,
        point_mode: device.point_mode,
        feature_flags: device.feature_flags || {},
      },
      company: {
        id: device.company_id,
        name: device.company?.name || 'Точка',
        code: device.company?.code || null,
      },
      operators,
      sync: {
        mode: 'server-api',
        supports_shift_report: true,
        supports_income_report: true,
        supports_debt_report: false,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-bootstrap',
      message: error?.message || 'Unknown point bootstrap error',
    })
    return json({ error: error?.message || 'Не удалось загрузить точку' }, 500)
  }
}
