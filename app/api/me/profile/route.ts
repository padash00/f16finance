import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Свои контактные данные: посмотреть и поправить.
 *
 * Зачем отдельный роут. Поменять телефон сотрудника или оператора можно было
 * только через админские разделы — то есть человек шёл к владельцу с просьбой
 * исправить свой же номер. Владелец при этом не знает контакты лучше самого
 * человека: он их у него и спрашивал.
 *
 * Что можно менять о себе: телефон, почта, Telegram для уведомлений. Всё.
 *
 * Что нельзя и почему. Имя, должность, ставка, дата найма, назначения на точки
 * — это кадровые данные: на них считается зарплата и строится подчинение.
 * Человек, который правит их сам, ломает и учёт, и ответственность за него.
 * Имя тоже: по нему сверяют документы и подписывают ведомости.
 *
 *   GET   /api/me/profile   — свои данные
 *   PATCH /api/me/profile   — { phone?, email?, telegram_chat_id? }
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type PatchBody = {
  phone?: string | null
  email?: string | null
  telegram_chat_id?: string | null
}

/** Кто спрашивает: сотрудник или оператор. У них разные таблицы. */
type Identity =
  | { kind: 'staff'; id: string }
  | { kind: 'operator'; id: string }

function identify(access: any): Identity | null {
  if (access.staffMember?.id) return { kind: 'staff', id: String(access.staffMember.id) }
  const operatorId = access.operatorAuth?.operator_id
  if (operatorId) return { kind: 'operator', id: String(operatorId) }
  return null
}

/** Пустая строка — это «стереть», а не «оставить как было». */
function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

/** Проверка почты — та же, что у любой формы: наличие «собаки» и домена. */
function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const identity = identify(access)
    if (!identity) return json({ error: 'no-profile' }, 404)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    if (identity.kind === 'staff') {
      const { data, error } = await supabase
        .from('staff')
        .select('id, full_name, short_name, role, phone, email, photo_url')
        .eq('id', identity.id)
        .maybeSingle()
      if (error) throw error
      return json({
        data: {
          kind: 'staff',
          fullName: data?.full_name || null,
          position: data?.role || null,
          phone: data?.phone || null,
          email: data?.email || null,
          telegramChatId: null,
          photoUrl: data?.photo_url || null,
        },
      })
    }

    const [operatorRes, profileRes] = await Promise.all([
      supabase.from('operators').select('id, name, short_name, telegram_chat_id').eq('id', identity.id).maybeSingle(),
      supabase
        .from('operator_profiles')
        .select('full_name, position, phone, email, photo_url')
        .eq('operator_id', identity.id)
        .maybeSingle(),
    ])
    if (operatorRes.error) throw operatorRes.error

    return json({
      data: {
        kind: 'operator',
        fullName: profileRes.data?.full_name || operatorRes.data?.name || null,
        position: profileRes.data?.position || null,
        phone: profileRes.data?.phone || null,
        email: profileRes.data?.email || null,
        telegramChatId: operatorRes.data?.telegram_chat_id || null,
        photoUrl: profileRes.data?.photo_url || null,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/me/profile GET', message: error?.message || 'error' })
    return json({ error: 'profile-failed' }, 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const identity = identify(access)
    if (!identity) return json({ error: 'no-profile' }, 404)

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body) return json({ error: 'invalid-body' }, 400)

    const phone = clean(body.phone)
    const email = clean(body.email)
    const telegram = clean(body.telegram_chat_id)

    if (email && !isEmailValid(email)) return json({ error: 'Проверьте почту' }, 400)
    if (phone && phone.replace(/\D/g, '').length < 10) return json({ error: 'Проверьте телефон' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    if (identity.kind === 'staff') {
      const update: Record<string, unknown> = {}
      if (phone !== undefined) update.phone = phone
      if (email !== undefined) update.email = email
      if (Object.keys(update).length === 0) return json({ ok: true })

      const { error } = await supabase.from('staff').update(update).eq('id', identity.id)
      if (error) throw error
    } else {
      const profileUpdate: Record<string, unknown> = {}
      if (phone !== undefined) profileUpdate.phone = phone
      if (email !== undefined) profileUpdate.email = email

      if (Object.keys(profileUpdate).length > 0) {
        // Профиля может не быть вовсе: оператора заводят одной строкой в
        // `operators`, а карточка появляется позже.
        const { data: existing } = await supabase
          .from('operator_profiles')
          .select('id')
          .eq('operator_id', identity.id)
          .maybeSingle()

        const { error } = existing?.id
          ? await supabase.from('operator_profiles').update(profileUpdate).eq('operator_id', identity.id)
          : await supabase.from('operator_profiles').insert([{ operator_id: identity.id, ...profileUpdate }])
        if (error) throw error
      }

      if (telegram !== undefined) {
        const { error } = await supabase
          .from('operators')
          .update({ telegram_chat_id: telegram })
          .eq('id', identity.id)
        if (error) throw error
      }
    }

    // В журнал: смена контактов — не мелочь. По телефону ищут в смену, на
    // почту уходят документы, в Telegram — уведомления. Кто и когда поменял,
    // должно быть видно.
    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: identity.kind === 'staff' ? 'staff' : 'operator',
      entityId: identity.id,
      action: 'self-contacts-updated',
      payload: {
        phone: phone !== undefined,
        email: email !== undefined,
        telegram: telegram !== undefined,
      },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/me/profile PATCH', message: error?.message || 'error' })
    return json({ error: 'profile-update-failed' }, 500)
  }
}
