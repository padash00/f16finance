import { NextResponse } from 'next/server'

import { ensureOrganizationOperatorAccess, ensureOrganizationStaffAccess } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { isTelegramConfigured, sendTelegram } from '@/lib/server/telegram'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type DismissalType = 'voluntary' | 'mutual_agreement' | 'cause' | 'contract_end' | 'other'

const DISMISSAL_TYPES: DismissalType[] = ['voluntary', 'mutual_agreement', 'cause', 'contract_end', 'other']
const DISMISSAL_TYPE_LABELS: Record<DismissalType, string> = {
  voluntary: 'По собственному желанию',
  mutual_agreement: 'По соглашению сторон',
  cause: 'По статье',
  contract_end: 'Истёк срок договора',
  other: 'Другое',
}

type Body = {
  kind?: 'staff' | 'operator'
  id?: string
  reason?: string
  dismissal_date?: string
  dismissal_type?: DismissalType
}

function escHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    if (!access.isSuperAdmin && access.staffRole !== 'owner') {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as Body | null
    const kind = body?.kind
    const id = String(body?.id || '').trim()
    const reason = String(body?.reason || '').trim()
    const dismissalType: DismissalType = DISMISSAL_TYPES.includes(body?.dismissal_type as DismissalType)
      ? (body!.dismissal_type as DismissalType)
      : 'other'

    let dismissalDate = String(body?.dismissal_date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dismissalDate)) {
      dismissalDate = new Date().toISOString().slice(0, 10)
    }

    if (kind !== 'staff' && kind !== 'operator') {
      return json({ error: 'kind должен быть staff или operator' }, 400)
    }
    if (!id) return json({ error: 'id обязателен' }, 400)
    if (reason.length < 5) {
      return json({ error: 'Причина увольнения обязательна (минимум 5 символов)' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const dismissedBy = access.staffMember?.id || null
    const dismissedAt = new Date().toISOString()
    const activeOrganizationId = access.activeOrganization?.id || null

    let employeeName = ''
    let companyName = ''

    if (kind === 'staff') {
      await ensureOrganizationStaffAccess({
        activeOrganizationId,
        isSuperAdmin: access.isSuperAdmin,
        staffId: id,
      })

      const { data: staffRow, error } = await supabase
        .from('staff')
        .update({
          is_active: false,
          dismissed_at: dismissedAt,
          dismissal_date: dismissalDate,
          dismissal_type: dismissalType,
          dismissal_reason: reason,
          dismissed_by: dismissedBy,
        })
        .eq('id', id)
        .select('id, full_name, short_name')
        .single()

      if (error) throw error
      employeeName = String(staffRow?.full_name || staffRow?.short_name || '')

      if (activeOrganizationId) {
        await supabase
          .from('organization_members')
          .update({ status: 'inactive' })
          .eq('organization_id', activeOrganizationId)
          .eq('staff_id', id)
      }
    } else {
      await ensureOrganizationOperatorAccess({
        activeOrganizationId,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: id,
      })

      const { data: opRow, error } = await supabase
        .from('operators')
        .update({
          is_active: false,
          dismissed_at: dismissedAt,
          dismissal_date: dismissalDate,
          dismissal_type: dismissalType,
          dismissal_reason: reason,
          dismissed_by: dismissedBy,
        })
        .eq('id', id)
        .select('id, name, operator_profiles(full_name)')
        .single()

      if (error) throw error
      const profile = Array.isArray((opRow as any)?.operator_profiles)
        ? (opRow as any).operator_profiles[0]
        : (opRow as any)?.operator_profiles
      employeeName = String(profile?.full_name?.trim() || (opRow as any)?.name || '')

      await supabase
        .from('operator_auth')
        .update({ is_active: false })
        .eq('operator_id', id)
    }

    if (activeOrganizationId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', activeOrganizationId)
        .maybeSingle()
      companyName = String((org as any)?.name || '')
    }

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: kind,
      entityId: id,
      action: 'dismiss',
      payload: {
        reason,
        dismissed_at: dismissedAt,
        dismissal_date: dismissalDate,
        dismissal_type: dismissalType,
      },
    })

    if (isTelegramConfigured()) {
      const actorName = String(
        (access.staffMember as any)?.full_name ||
          (access.staffMember as any)?.short_name ||
          access.user?.email ||
          'Владелец',
      )
      const html = [
        '🚫 <b>Увольнение сотрудника</b>',
        companyName ? `🏢 ${escHtml(companyName)}` : null,
        `👤 <b>${escHtml(employeeName || '—')}</b> · ${kind === 'operator' ? 'оператор' : 'админ'}`,
        `📅 Дата: ${escHtml(dismissalDate)}`,
        `📋 Тип: ${escHtml(DISMISSAL_TYPE_LABELS[dismissalType])}`,
        `💬 Причина: ${escHtml(reason)}`,
        `✍ Уволил: ${escHtml(actorName)}`,
      ].filter(Boolean).join('\n')
      await sendTelegram(html).catch(() => null)
    }

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/hr/dismiss',
      message: error?.message || 'dismiss failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
