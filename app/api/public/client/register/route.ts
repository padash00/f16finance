import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getRequestUser } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

const registerSchema = z.object({
  companyCode: z.string().trim().min(2).max(80),
  pointProjectId: z.string().trim().uuid(),
  phone: z.string().trim().min(5).max(40),
  /** Короткое/пустое имя игнорируем — подставится из профиля или email (как на основном сайте). */
  name: z
    .unknown()
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return undefined
      const s = String(v).trim()
      if (s.length < 2) return undefined
      return s.slice(0, 140)
    }),
})

function normalizePhone(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const rate = checkRateLimit(`public-client-register:${ip}`, 10, 60 * 60 * 1000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Слишком много попыток. Попробуйте позже.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    )
  }

  if (!hasAdminSupabaseCredentials()) {
    return json({ error: 'registration-service-unavailable' }, 503)
  }

  const user = await getRequestUser(request)
  if (!user?.id) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (!user.email_confirmed_at) {
    return json(
      {
        error: 'email-not-confirmed',
        message: 'Подтвердите email через письмо, затем завершите регистрацию.',
      },
      403,
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return json({ error: 'Проверьте данные регистрации.' }, 400)
  }

  try {
    const adminSupabase = createAdminSupabaseClient()
    const companyCode = parsed.data.companyCode.toLowerCase()
    const pointProjectId = parsed.data.pointProjectId
    const phone = normalizePhone(parsed.data.phone)
    const displayName = parsed.data.name?.trim() || user.user_metadata?.name || user.email || 'Клиент'
    const email = user.email?.trim().toLowerCase() || null

    const { data: company, error: companyError } = await adminSupabase
      .from('companies')
      .select('id, name, code')
      .ilike('code', companyCode)
      .maybeSingle()
    if (companyError) throw companyError
    if (!company?.id) return json({ error: 'company-not-found' }, 404)

    const { data: pointProject, error: pointProjectError } = await adminSupabase
      .from('point_projects')
      .select('id, is_active, point_project_companies(company_id)')
      .eq('id', pointProjectId)
      .maybeSingle()
    if (pointProjectError) throw pointProjectError
    if (!pointProject?.id || pointProject.is_active === false) return json({ error: 'point-project-not-found' }, 404)

    const pointCompanyIds = (Array.isArray((pointProject as any).point_project_companies)
      ? (pointProject as any).point_project_companies
      : []
    )
      .map((item: any) => String(item.company_id || ''))
      .filter(Boolean)
    if (!pointCompanyIds.includes(String(company.id))) {
      return json({ error: 'point-project-company-mismatch' }, 400)
    }

    const { data: station, error: stationError } = await adminSupabase
      .from('arena_stations')
      .select('id')
      .eq('point_project_id', pointProjectId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (stationError) throw stationError
    if (!station?.id) return json({ error: 'point-project-without-stations' }, 400)

    const { data: alreadyLinked, error: linkedError } = await adminSupabase
      .from('customers')
      .select('id, company_id, auth_user_id, name, phone, email, preferred_point_project_id')
      .eq('company_id', company.id)
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (linkedError) throw linkedError

    if (alreadyLinked?.id) {
      if (alreadyLinked.preferred_point_project_id !== pointProjectId) {
        const { data: moved, error: moveError } = await adminSupabase
          .from('customers')
          .update({
            preferred_point_project_id: pointProjectId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', alreadyLinked.id)
          .select('id, company_id, auth_user_id, name, phone, email, loyalty_points, total_spent, visits_count, preferred_point_project_id')
          .single()
        if (moveError) throw moveError
        return json({ ok: true, linked: true, customer: moved })
      }

      return json({
        ok: true,
        linked: true,
        customer: alreadyLinked,
      })
    }

    const { data: created, error: createError } = await adminSupabase
      .from('customers')
      .insert({
        company_id: company.id,
        name: displayName,
        phone,
        email,
        auth_user_id: user.id,
        preferred_point_project_id: pointProjectId,
        is_active: true,
      })
      .select('id, company_id, auth_user_id, name, phone, email, loyalty_points, total_spent, visits_count, preferred_point_project_id')
      .single()
    if (createError) {
      if (createError.code === '23505') return json({ error: 'customer-already-exists' }, 409)
      throw createError
    }

    return json({ ok: true, linked: false, customer: created }, 201)
  } catch (error: any) {
    return json({ error: error?.message || 'registration-failed' }, 500)
  }
}
