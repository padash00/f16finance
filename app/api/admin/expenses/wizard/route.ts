import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type WizardPayload = {
  date?: string | null
  company_id?: string | null
  operator_id?: string | null
  category_id?: string | null
  category_name?: string | null
  amount_cash?: number | null
  amount_kaspi?: number | null
  item_name?: string | null
  comment?: string | null
  backdated_confirmed?: boolean | null
  document_kind?: 'receipt' | 'invoice' | 'bill' | 'whitelist' | 'one_off' | null
  document_url?: string | null
  document_urls?: string[] | null
  whitelist_vendor_id?: string | null
  one_off_payee?: string | null
  one_off_reason?: string | null
}

function canCreateExpense(role: string, isSuperAdmin: boolean) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return isSuperAdmin || !!role
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    if (!canCreateExpense(access.staffRole, access.isSuperAdmin)) {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const userId = access.user?.id || null
    if (!userId) return json({ error: 'unauthorized' }, 401)

    const { data, error } = await supabase
      .from('expense_wizard_sessions')
      .insert([{
        user_id: userId,
        organization_id: access.activeOrganization?.id || null,
        step: 1,
        payload: {},
        status: 'in_progress',
      }])
      .select('id, expires_at, payload, step')
      .single()

    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: userId,
      entityType: 'expense_wizard',
      entityId: String(data.id),
      action: 'wizard.expense.start',
      payload: { session_id: data.id },
    })

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/wizard POST',
      message: error?.message || 'wizard start failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    if (!canCreateExpense(access.staffRole, access.isSuperAdmin)) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = await request.json().catch(() => null) as {
      session_id?: string
      step?: number
      payload?: WizardPayload
    } | null

    const sessionId = String(body?.session_id || '').trim()
    const step = Number(body?.step || 0)
    const incoming = (body?.payload || {}) as WizardPayload

    if (!sessionId) return json({ error: 'session_id обязателен' }, 400)
    if (step < 1 || step > 3) return json({ error: 'Некорректный шаг' }, 400)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const { data: session, error: sessionError } = await supabase
      .from('expense_wizard_sessions')
      .select('id, user_id, payload, status, expires_at, consumed_at')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) return json({ error: 'Сессия не найдена' }, 404)
    if (session.user_id !== access.user?.id) return json({ error: 'forbidden' }, 403)
    if (session.consumed_at) return json({ error: 'Сессия уже использована' }, 410)
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return json({ error: 'Сессия истекла' }, 410)
    }

    const merged = {
      ...(session.payload || {}),
      ...incoming,
    }

    if (step >= 1) {
      // Light validation per step. Final validation runs at submit time.
      if (incoming.amount_cash != null && Number(incoming.amount_cash) < 0) {
        return json({ error: 'Сумма наличных не может быть отрицательной' }, 400)
      }
      if (incoming.amount_kaspi != null && Number(incoming.amount_kaspi) < 0) {
        return json({ error: 'Сумма Kaspi не может быть отрицательной' }, 400)
      }
      if (incoming.date) {
        const d = new Date(incoming.date)
        if (Number.isNaN(d.getTime())) return json({ error: 'Некорректная дата' }, 400)
        if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
          return json({ error: 'Дата не может быть в будущем' }, 400)
        }
      }
      if (incoming.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          requestedCompanyId: incoming.company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('expense_wizard_sessions')
      .update({
        step,
        payload: merged,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .select('id, step, payload, expires_at')
      .single()

    if (updateError) throw updateError

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'expense_wizard',
      entityId: String(sessionId),
      action: 'wizard.expense.step',
      payload: {
        session_id: sessionId,
        step,
        payload_keys: Object.keys(incoming || {}),
      },
    })

    return json({ ok: true, data: updated })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/wizard PATCH',
      message: error?.message || 'wizard step failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    if (!canCreateExpense(access.staffRole, access.isSuperAdmin)) {
      return json({ error: 'forbidden' }, 403)
    }

    const url = new URL(request.url)
    const sessionId = String(url.searchParams.get('session_id') || '').trim()
    if (!sessionId) return json({ error: 'session_id обязателен' }, 400)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const { data, error } = await supabase
      .from('expense_wizard_sessions')
      .select('id, step, payload, status, expires_at, consumed_at, expense_id, user_id')
      .eq('id', sessionId)
      .single()

    if (error || !data) return json({ error: 'Сессия не найдена' }, 404)
    if (data.user_id !== access.user?.id) return json({ error: 'forbidden' }, 403)

    return json({ data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/wizard GET',
      message: error?.message || 'wizard get failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
