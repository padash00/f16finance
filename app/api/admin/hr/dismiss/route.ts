import { NextResponse } from 'next/server'

import { findPairedRecord } from '@/lib/server/hr-paired'
import { ensureOrganizationOperatorAccess, ensureOrganizationStaffAccess } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
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
  cascade_paired?: boolean
}

function escHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

type DismissContext = {
  supabase: any
  activeOrganizationId: string | null
  isSuperAdmin: boolean
  dismissedBy: string | null
  dismissedAt: string
  dismissalDate: string
  dismissalType: DismissalType
  reason: string
}

async function dismissStaff(ctx: DismissContext, id: string): Promise<string> {
  const { supabase } = ctx
  await ensureOrganizationStaffAccess({
    activeOrganizationId: ctx.activeOrganizationId,
    isSuperAdmin: ctx.isSuperAdmin,
    staffId: id,
  })

  const { data: staffRow, error } = await supabase
    .from('staff')
    .update({
      is_active: false,
      dismissed_at: ctx.dismissedAt,
      dismissal_date: ctx.dismissalDate,
      dismissal_type: ctx.dismissalType,
      dismissal_reason: ctx.reason,
      dismissed_by: ctx.dismissedBy,
    })
    .eq('id', id)
    .select('id, full_name, short_name, user_id')
    .single()

  if (error) throw error
  const employeeName = String(staffRow?.full_name || staffRow?.short_name || '')

  if (ctx.activeOrganizationId) {
    await supabase
      .from('organization_members')
      .update({ status: 'inactive' })
      .eq('organization_id', ctx.activeOrganizationId)
      .eq('staff_id', id)
  }

  // Каскад на operator_staff_links и демот гибридов.
  const { data: linkedOperatorRows } = await supabase
    .from('operator_staff_links')
    .select('operator_id')
    .eq('staff_id', id)
  const linkedOperatorIds = (linkedOperatorRows || [])
    .map((row: any) => String(row?.operator_id || ''))
    .filter(Boolean)

  await supabase.from('operator_staff_links').delete().eq('staff_id', id)

  if (linkedOperatorIds.length > 0) {
    await supabase
      .from('operators')
      .update({ is_admin_staff: false })
      .in('id', linkedOperatorIds)
  }

  // Полная блокировка: ban + signOut.
  const staffUserId = (staffRow as any)?.user_id
  if (staffUserId) {
    try {
      await (supabase as any).auth.admin.updateUserById(staffUserId, { ban_duration: '876000h' })
    } catch {}
    try {
      await (supabase as any).auth.admin.signOut(staffUserId, 'global')
    } catch {}
  }

  return employeeName
}

async function dismissOperator(ctx: DismissContext, id: string): Promise<string> {
  const { supabase } = ctx
  await ensureOrganizationOperatorAccess({
    activeOrganizationId: ctx.activeOrganizationId,
    isSuperAdmin: ctx.isSuperAdmin,
    operatorId: id,
  })

  const { data: opRow, error } = await supabase
    .from('operators')
    .update({
      is_active: false,
      dismissed_at: ctx.dismissedAt,
      dismissal_date: ctx.dismissalDate,
      dismissal_type: ctx.dismissalType,
      dismissal_reason: ctx.reason,
      dismissed_by: ctx.dismissedBy,
    })
    .eq('id', id)
    .select('id, name, operator_profiles(full_name)')
    .single()

  if (error) throw error
  const profile = Array.isArray((opRow as any)?.operator_profiles)
    ? (opRow as any).operator_profiles[0]
    : (opRow as any)?.operator_profiles
  const employeeName = String(profile?.full_name?.trim() || (opRow as any)?.name || '')

  const { data: opAuthRow } = await supabase
    .from('operator_auth')
    .update({ is_active: false })
    .eq('operator_id', id)
    .select('user_id')
    .maybeSingle()

  await supabase
    .from('operator_company_assignments')
    .update({ is_active: false })
    .eq('operator_id', id)

  await supabase.from('operator_staff_links').delete().eq('operator_id', id)
  await supabase
    .from('operators')
    .update({ is_admin_staff: false })
    .eq('id', id)

  const opUserId = (opAuthRow as any)?.user_id
  if (opUserId) {
    try {
      await (supabase as any).auth.admin.updateUserById(opUserId, { ban_duration: '876000h' })
    } catch {}
    try {
      await (supabase as any).auth.admin.signOut(opUserId, 'global')
    } catch {}
  }

  return employeeName
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'staff.toggle_status')
    if (denied) return denied as any

    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as Body | null
    const kind = body?.kind
    const id = String(body?.id || '').trim()
    const reason = String(body?.reason || '').trim()
    const cascadePaired = body?.cascade_paired === true
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

    const ctx: DismissContext = {
      supabase,
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      dismissedBy: access.staffMember?.id || null,
      dismissedAt: new Date().toISOString(),
      dismissalDate,
      dismissalType,
      reason,
    }

    // Каскад: ищем парную запись ДО увольнения, потому что dismiss удаляет
    // operator_staff_links — после первого вызова парную не найти по линку.
    let pairedTarget: { kind: 'staff' | 'operator'; id: string; name: string } | null = null
    if (cascadePaired) {
      const paired = await findPairedRecord(supabase, { kind, id })
      if (paired && paired.is_active) {
        pairedTarget = { kind: paired.kind, id: paired.id, name: paired.name }
      }
    }

    const primaryName = kind === 'staff' ? await dismissStaff(ctx, id) : await dismissOperator(ctx, id)

    let pairedName: string | null = null
    if (pairedTarget) {
      pairedName =
        pairedTarget.kind === 'staff'
          ? await dismissStaff(ctx, pairedTarget.id)
          : await dismissOperator(ctx, pairedTarget.id)
    }

    let companyName = ''
    if (ctx.activeOrganizationId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', ctx.activeOrganizationId)
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
        dismissed_at: ctx.dismissedAt,
        dismissal_date: dismissalDate,
        dismissal_type: dismissalType,
        cascade_paired: !!pairedTarget,
        paired_kind: pairedTarget?.kind || null,
        paired_id: pairedTarget?.id || null,
      },
    })

    if (pairedTarget) {
      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: pairedTarget.kind,
        entityId: pairedTarget.id,
        action: 'dismiss',
        payload: {
          reason,
          dismissed_at: ctx.dismissedAt,
          dismissal_date: dismissalDate,
          dismissal_type: dismissalType,
          cascade_from_kind: kind,
          cascade_from_id: id,
        },
      })
    }

    if (isTelegramConfigured()) {
      const actorName = String(
        (access.staffMember as any)?.full_name ||
          (access.staffMember as any)?.short_name ||
          access.user?.email ||
          'Владелец',
      )
      const pairedLine = pairedTarget
        ? `🔗 Также уволена парная запись: ${escHtml(pairedName || pairedTarget.name)} · ${
            pairedTarget.kind === 'operator' ? 'оператор' : 'админ'
          }`
        : null
      const html = [
        '🚫 <b>Увольнение сотрудника</b>',
        companyName ? `🏢 ${escHtml(companyName)}` : null,
        `👤 <b>${escHtml(primaryName || '—')}</b> · ${kind === 'operator' ? 'оператор' : 'админ'}`,
        pairedLine,
        `📅 Дата: ${escHtml(dismissalDate)}`,
        `📋 Тип: ${escHtml(DISMISSAL_TYPE_LABELS[dismissalType])}`,
        `💬 Причина: ${escHtml(reason)}`,
        `✍ Уволил: ${escHtml(actorName)}`,
      ]
        .filter(Boolean)
        .join('\n')
      await sendTelegram(html).catch(() => null)
    }

    return json({
      ok: true,
      paired_dismissed: pairedTarget
        ? { kind: pairedTarget.kind, id: pairedTarget.id, name: pairedName || pairedTarget.name }
        : null,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/hr/dismiss',
      message: error?.message || 'dismiss failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
