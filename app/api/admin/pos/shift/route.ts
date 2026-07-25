import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Смена для веб-кассы ВЛАДЕЛЬЦА/менеджера (Q6).
 *
 * Тот же контур смены, что у оператора и десктопа (RPC point_shift_open/close,
 * таблица point_shifts, инвариант «одна смена на точку»). Отличие: точку владелец
 * выбирает сам (company_id), а смену открывает «от себя» (operator_id = null),
 * без проверки графика. Изоляция — точка обязана входить в орг вызывающего.
 */

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function assertCompanyInScope(access: any, companyId: string) {
  // Бросит 'company-out-of-scope' если точка не принадлежит орг вызывающего.
  await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    requestedCompanyId: companyId,
    isSuperAdmin: access.isSuperAdmin,
  })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const companyId = String(new URL(request.url).searchParams.get('company_id') || '').trim()
    if (!companyId) return json({ shift: null })
    try {
      await assertCompanyInScope(access, companyId)
    } catch {
      return json({ error: 'company-out-of-scope' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data: shift, error } = await supabase
      .from('point_shifts')
      .select(
        'id, company_id, shift_type, opened_at, opening_cash, operator_id, operator:staff!operator_id ( id, full_name, short_name )',
      )
      .eq('company_id', companyId)
      .eq('status', 'open')
      .maybeSingle()

    if (error) return json({ error: 'point-shift-current-failed', detail: (error as any).message }, 500)
    return json({ shift: shift || null })
  } catch (error: any) {
    return json({ error: error?.message || 'error' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const body = (await request.json().catch(() => ({}))) as any
    const action = String(body?.action || '').trim()
    const companyId = String(body?.company_id || '').trim()
    if (!companyId) return json({ error: 'company-required' }, 400)
    try {
      await assertCompanyInScope(access, companyId)
    } catch {
      return json({ error: 'company-out-of-scope' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    if (action === 'open') {
      const openingCashRaw = body?.opening_cash
      const openingCash =
        openingCashRaw === undefined || openingCashRaw === null || String(openingCashRaw).trim() === ''
          ? Number.NaN
          : Number(openingCashRaw)
      if (!Number.isFinite(openingCash) || openingCash < 0) {
        return json({ error: 'opening-cash-required', message: 'Укажите старт кассы.' }, 400)
      }

      const { data, error } = await supabase.rpc('point_shift_open', {
        p_company_id: companyId,
        p_operator_id: null, // владелец открывает «от себя»
        p_point_device_id: null,
        p_shift_type: body?.shift_type || 'day',
        p_opening_cash: openingCash,
        p_opening_notes: body?.opening_notes || null,
        p_handover_from: null,
      })

      if (error) {
        const code = String((error as any).message || '').toLowerCase()
        if (code.includes('point-shift-already-open')) {
          const { data: existing } = await supabase
            .from('point_shifts')
            .select('id, opened_at, operator_id, shift_type, opening_cash')
            .eq('company_id', companyId)
            .eq('status', 'open')
            .maybeSingle()
          return json({ error: 'point-shift-already-open', shift: existing || null }, 409)
        }
        return json({ error: 'point-shift-open-failed', detail: (error as any).message }, 400)
      }

      const shiftId = (data as unknown as string) || ''
      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'point_shift.open',
        entityType: 'point_shift',
        entityId: shiftId,
        payload: { company_id: companyId, opening_cash: openingCash, shift_type: body?.shift_type || 'day', source: 'owner-web' },
      })
      return json({ shift_id: shiftId, opening_cash: openingCash })
    }

    if (action === 'close') {
      const { data: open } = await supabase
        .from('point_shifts')
        .select('id')
        .eq('company_id', companyId)
        .eq('status', 'open')
        .maybeSingle()
      if (!open) return json({ error: 'point-shift-no-open' }, 409)
      const shiftId = (open as any).id as string

      const { data, error } = await supabase.rpc('point_shift_close', {
        p_shift_id: shiftId,
        p_closed_by: null,
        p_closing_cash: Number(body?.closing_cash || 0),
        p_closing_kaspi: Number(body?.closing_kaspi || 0),
        p_kaspi_before_midnight: Number(body?.kaspi_before_midnight || 0),
        p_kaspi_after_midnight: Number(body?.kaspi_after_midnight || 0),
        p_z_report_url: null,
        p_x_report_url: null,
        p_closing_notes: body?.closing_notes || null,
      })
      if (error) return json({ error: 'point-shift-close-failed', detail: (error as any).message }, 400)

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'point_shift.close',
        entityType: 'point_shift',
        entityId: shiftId,
        payload: { company_id: companyId, totals: data, source: 'owner-web' },
      })
      return json({ shift_id: shiftId, totals: data })
    }

    return json({ error: 'invalid-action' }, 400)
  } catch (error: any) {
    return json({ error: error?.message || 'error' }, 500)
  }
}
