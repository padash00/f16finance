/**
 * Единый календарь — агрегатор событий за период:
 * - Смены (scheduled_shifts / point_shifts)
 * - Дни рождения операторов (operator_profiles.birth_date)
 * - Праздники РК (kz_holidays)
 * - Объявления / закрепления (team_chat_messages)
 *
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&operatorId=X (опционально)
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { listOrganizationOperatorIds } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

type CalendarEvent = {
  date: string
  type: 'shift' | 'birthday' | 'holiday' | 'announcement'
  title: string
  subtitle?: string | null
  color?: string | null
  meta?: Record<string, any>
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const url = new URL(request.url)
  const from = url.searchParams.get('from') || new Date().toISOString().slice(0, 10)
  const to = url.searchParams.get('to') || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const operatorId = url.searchParams.get('operatorId')

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Изоляция: календарь показывает PII/расписания/объявления ТОЛЬКО своей орг.
  const orgId = access.activeOrganization?.id || null
  const allowedOperatorIds = await listOrganizationOperatorIds({
    activeOrganizationId: orgId,
    isSuperAdmin: access.isSuperAdmin,
  })

  const events: CalendarEvent[] = []

  // 1. Праздники РК
  const { data: holidays } = await supabase
    .from('kz_holidays')
    .select('date, name, description')
    .gte('date', from)
    .lte('date', to)
  for (const h of holidays || []) {
    events.push({
      date: String((h as any).date).slice(0, 10),
      type: 'holiday',
      title: (h as any).name,
      subtitle: (h as any).description || null,
      color: '#F97316',
    })
  }

  // 2. Дни рождения операторов
  // Берём всех активных операторов, фильтруем по месяцу/дню в диапазоне
  let profilesQuery = supabase
    .from('operator_profiles')
    .select('operator_id, full_name, birth_date')
    .not('birth_date', 'is', null)
  if (allowedOperatorIds) profilesQuery = profilesQuery.in('operator_id', allowedOperatorIds)
  const { data: profiles } = await profilesQuery
  const fromDate = new Date(from + 'T00:00:00Z')
  const toDate = new Date(to + 'T23:59:59Z')
  for (const p of profiles || []) {
    const bd = (p as any).birth_date as string | null
    if (!bd) continue
    // Match same month-day in any year inside range
    const cursor = new Date(fromDate)
    while (cursor <= toDate) {
      const month = cursor.getUTCMonth() + 1
      const day = cursor.getUTCDate()
      const bdMonth = parseInt(bd.slice(5, 7))
      const bdDay = parseInt(bd.slice(8, 10))
      if (month === bdMonth && day === bdDay) {
        const iso = cursor.toISOString().slice(0, 10)
        events.push({
          date: iso,
          type: 'birthday',
          title: `🎂 День рождения`,
          subtitle: (p as any).full_name || null,
          color: '#EC4899',
          meta: { operatorId: (p as any).operator_id },
        })
        break
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }

  // 3. Смены — берём из shift_responses (расписание) если оно есть, или из point_shifts
  let shiftsQuery = supabase
    .from('shift_responses')
    .select('id, shift_date, shift_type, operator_id, status, operator_name')
    .gte('shift_date', from)
    .lte('shift_date', to)
  if (operatorId) shiftsQuery = shiftsQuery.eq('operator_id', operatorId)
  if (allowedOperatorIds) shiftsQuery = shiftsQuery.in('operator_id', allowedOperatorIds)
  const { data: shifts } = await shiftsQuery
  for (const s of shifts || []) {
    const isNight = (s as any).shift_type === 'night'
    events.push({
      date: String((s as any).shift_date).slice(0, 10),
      type: 'shift',
      title: isNight ? '🌙 Ночь' : '☀️ День',
      subtitle: (s as any).operator_name || null,
      color: isNight ? '#5F8CFF' : '#FFB36B',
      meta: { shiftId: (s as any).id, status: (s as any).status, operatorId: (s as any).operator_id },
    })
  }

  // 4. Объявления — последние 10
  let annQuery = supabase
    .from('team_chat_messages')
    .select('id, sender_name, message, created_at')
    .eq('is_announcement', true)
    .is('deleted_at', null)
    .gte('created_at', from + 'T00:00:00Z')
    .lte('created_at', to + 'T23:59:59Z')
    .order('created_at', { ascending: false })
    .limit(10)
  if (!access.isSuperAdmin && orgId) annQuery = annQuery.eq('organization_id', orgId)
  const { data: announcements } = await annQuery
  for (const a of announcements || []) {
    events.push({
      date: String((a as any).created_at).slice(0, 10),
      type: 'announcement',
      title: '📢 Объявление',
      subtitle: (a as any).message?.slice(0, 80) + ((a as any).message?.length > 80 ? '…' : ''),
      color: '#FFB36B',
      meta: { messageId: (a as any).id, author: (a as any).sender_name },
    })
  }

  events.sort((a, b) => a.date.localeCompare(b.date))
  return json({ events, from, to })
}
