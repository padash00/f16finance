import { NextResponse } from 'next/server'
import { z } from 'zod'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestUser } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Вариант A: один `auth_user_id` — несколько строк `customers` (по одной на каждую компанию в той же `organizations`).
 * Вызывается после успешной привязки к якорной компании; ошибки не рвут регистрацию.
 */
async function cloneCustomerRowsAcrossOrganization(
  adminSupabase: SupabaseClient,
  params: {
    authUserId: string
    anchorCompanyId: string
    phone: string
    email: string | null
    displayName: string
  },
) {
  try {
    const { data: anchor, error: anchorError } = await adminSupabase
      .from('companies')
      .select('id, organization_id')
      .eq('id', params.anchorCompanyId)
      .maybeSingle()
    if (anchorError) throw anchorError
    const orgId = anchor?.organization_id ? String(anchor.organization_id) : ''
    if (!orgId) return

    const { data: siblings, error: siblingsError } = await adminSupabase
      .from('companies')
      .select('id')
      .eq('organization_id', orgId)

    if (siblingsError) throw siblingsError

    const otherCompanyIds = (siblings || [])
      .map((row: { id?: string }) => String(row.id || '').trim())
      .filter((id) => id && id !== params.anchorCompanyId)

    for (const companyId of otherCompanyIds) {
      const { data: existing, error: exErr } = await adminSupabase
        .from('customers')
        .select('id')
        .eq('company_id', companyId)
        .eq('auth_user_id', params.authUserId)
        .maybeSingle()
      if (exErr) throw exErr
      if (existing?.id) continue

      const { error: insertError } = await adminSupabase.from('customers').insert({
        company_id: companyId,
        name: params.displayName,
        phone: params.phone,
        email: params.email,
        auth_user_id: params.authUserId,
        preferred_point_project_id: null,
        is_active: true,
      })
      if (insertError && insertError.code !== '23505') {
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'public-client-register:org-clone',
          message: insertError.message || 'customer clone insert failed',
        })
      }
    }
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'public-client-register:org-clone',
      message: error?.message || 'cloneCustomerRowsAcrossOrganization failed',
    })
  }
}

const registerSchema = z.object({
  companyCode: z.string().trim().min(2).max(80),
  /** Необязательно: клиент сети без «домашней» точки; брони/жалобы привязываются к выбранной станции в сценариях. */
  pointProjectId: z.preprocess((val) => {
    if (val === undefined || val === null) return undefined
    const s = String(val).trim()
    return s.length ? s : undefined
  }, z.string().uuid().optional()),
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
      .select('id, name, code, organization_id')
      .ilike('code', companyCode)
      .maybeSingle()
    if (companyError) throw companyError
    if (!company?.id) return json({ error: 'company-not-found' }, 404)

    if (pointProjectId) {
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
    }

    const { data: alreadyLinked, error: linkedError } = await adminSupabase
      .from('customers')
      .select('id, company_id, auth_user_id, name, phone, email, preferred_point_project_id')
      .eq('company_id', company.id)
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (linkedError) throw linkedError

    if (alreadyLinked?.id) {
      if (!pointProjectId) {
        await cloneCustomerRowsAcrossOrganization(adminSupabase, {
          authUserId: user.id,
          anchorCompanyId: String(company.id),
          phone,
          email,
          displayName,
        })
        return json({
          ok: true,
          linked: true,
          customer: alreadyLinked,
        })
      }
      if (alreadyLinked.preferred_point_project_id === pointProjectId) {
        await cloneCustomerRowsAcrossOrganization(adminSupabase, {
          authUserId: user.id,
          anchorCompanyId: String(company.id),
          phone,
          email,
          displayName,
        })
        return json({
          ok: true,
          linked: true,
          customer: alreadyLinked,
        })
      }
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
      await cloneCustomerRowsAcrossOrganization(adminSupabase, {
        authUserId: user.id,
        anchorCompanyId: String(company.id),
        phone,
        email,
        displayName,
      })
      return json({ ok: true, linked: true, customer: moved })
    }

    const { data: created, error: createError } = await adminSupabase
      .from('customers')
      .insert({
        company_id: company.id,
        name: displayName,
        phone,
        email,
        auth_user_id: user.id,
        preferred_point_project_id: pointProjectId ?? null,
        is_active: true,
      })
      .select('id, company_id, auth_user_id, name, phone, email, loyalty_points, total_spent, visits_count, preferred_point_project_id')
      .single()
    if (createError) {
      if (createError.code === '23505') return json({ error: 'customer-already-exists' }, 409)
      throw createError
    }

    await cloneCustomerRowsAcrossOrganization(adminSupabase, {
      authUserId: user.id,
      anchorCompanyId: String(company.id),
      phone,
      email,
      displayName,
    })

    return json({ ok: true, linked: false, customer: created }, 201)
  } catch (error: any) {
    return json({ error: error?.message || 'registration-failed' }, 500)
  }
}
