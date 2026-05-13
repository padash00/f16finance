import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const DEFAULTS = {
  tax_payer_name: '',
  tax_payer_bin: '',
  point_address: '',
  kkm_factory_number: '',
  kkm_registration_number: '',
  is_vat_payer: false,
  vat_rate: 12,
  ofd_name: '',
  ofd_check_url: '',
  receipt_language: 'ru' as 'ru' | 'kk' | 'both',
  receipt_footer_text: '',
  require_buyer_iin: false,
  marking_enabled: false,
  nkt_enabled: false,
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point

    const { data: row, error } = await supabase
      .from('point_receipt_settings')
      .select('*')
      .eq('company_id', device.company_id)
      .maybeSingle()

    if (error) throw error

    const settings = row
      ? {
          ...DEFAULTS,
          ...(row as any),
          vat_rate: Number((row as any).vat_rate) || 12,
        }
      : DEFAULTS

    return json({
      ok: true,
      data: {
        company: {
          id: device.company_id,
          name: device.company?.name || null,
          code: device.company?.code || null,
        },
        settings,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/receipt-settings.GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось загрузить реквизиты чека' }, 500)
  }
}
