import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const TEXT_FIELDS = [
  'tax_payer_name',
  'tax_payer_bin',
  'point_address',
  'kkm_factory_number',
  'kkm_registration_number',
  'ofd_name',
  'ofd_check_url',
  'receipt_footer_text',
] as const

const BOOL_FIELDS = ['is_vat_payer', 'require_buyer_iin', 'marking_enabled', 'nkt_enabled'] as const

type Settings = {
  id?: string
  company_id: string
  organization_id?: string | null
  tax_payer_name: string
  tax_payer_bin: string
  point_address: string
  kkm_factory_number: string
  kkm_registration_number: string
  is_vat_payer: boolean
  vat_rate: number
  ofd_name: string
  ofd_check_url: string
  receipt_language: 'ru' | 'kk' | 'both'
  receipt_footer_text: string
  require_buyer_iin: boolean
  marking_enabled: boolean
  nkt_enabled: boolean
}

function defaultSettings(companyId: string, organizationId: string | null): Settings {
  return {
    company_id: companyId,
    organization_id: organizationId,
    tax_payer_name: '',
    tax_payer_bin: '',
    point_address: '',
    kkm_factory_number: '',
    kkm_registration_number: '',
    is_vat_payer: false,
    vat_rate: 12,
    ofd_name: '',
    ofd_check_url: '',
    receipt_language: 'ru',
    receipt_footer_text: '',
    require_buyer_iin: false,
    marking_enabled: false,
    nkt_enabled: false,
  }
}

function sanitizeText(value: unknown, max = 256) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.slice(0, max)
}

function normalizePayload(input: any, companyId: string, organizationId: string | null): Settings {
  const base = defaultSettings(companyId, organizationId)
  const out: Settings = { ...base }
  for (const key of TEXT_FIELDS) {
    out[key] = sanitizeText(input?.[key], 512) || ''
  }
  for (const key of BOOL_FIELDS) {
    out[key] = Boolean(input?.[key])
  }
  const vatRate = Number(input?.vat_rate)
  out.vat_rate = Number.isFinite(vatRate) && vatRate >= 0 ? Math.min(100, vatRate) : 12
  const lang = String(input?.receipt_language || 'ru')
  out.receipt_language = (['ru', 'kk', 'both'] as const).includes(lang as any)
    ? (lang as 'ru' | 'kk' | 'both')
    : 'ru'
  return out
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-receipt-settings.view')
    if (denied) return denied as any

    const url = new URL(request.url)
    const requestedCompanyId = (url.searchParams.get('company_id') || '').trim() || null

    // Для списка точек в дропдауне нужны ВСЕ доступные компании, поэтому
    // resolveCompanyScope вызываем БЕЗ requestedCompanyId. Конкретную точку
    // проверим отдельно ниже.
    const allCompaniesScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    if (requestedCompanyId && allCompaniesScope.allowedCompanyIds !== null && !allCompaniesScope.allowedCompanyIds.includes(requestedCompanyId)) {
      return json({ error: 'Точка вне доступа' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    let companiesQuery = supabase
      .from('companies')
      .select('id, name, code, organization_id')
      .order('name', { ascending: true })

    if (allCompaniesScope.allowedCompanyIds !== null) {
      companiesQuery = companiesQuery.in('id', allCompaniesScope.allowedCompanyIds)
    }

    const { data: companies, error: companiesError } = await companiesQuery
    if (companiesError) throw companiesError

    const targetCompanyId =
      requestedCompanyId ||
      (companies && companies.length > 0 ? String((companies[0] as any).id) : null)

    if (!targetCompanyId) {
      return json({
        ok: true,
        data: {
          companies: companies || [],
          settings: null,
        },
      })
    }

    const company = (companies || []).find((c) => String((c as any).id) === targetCompanyId)
    const organizationId = company ? (company as any).organization_id || null : null

    const { data: row, error } = await supabase
      .from('point_receipt_settings')
      .select('*')
      .eq('company_id', targetCompanyId)
      .maybeSingle()

    if (error) throw error

    const settings: Settings =
      row != null
        ? {
            ...defaultSettings(targetCompanyId, organizationId),
            ...(row as any),
            vat_rate: Number((row as any).vat_rate) || 12,
          }
        : defaultSettings(targetCompanyId, organizationId)

    return json({
      ok: true,
      data: {
        companies: companies || [],
        settings,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/receipt-settings.GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось загрузить настройки чека' }, 500)
  }
}

export async function PUT(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-receipt-settings.edit')
    if (denied) return denied as any

    const body = await request.json().catch(() => null)
    const companyId = String(body?.company_id || '').trim()
    if (!companyId) return json({ error: 'company_id обязателен' }, 400)

    await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      requestedCompanyId: companyId,
    })

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id, organization_id')
      .eq('id', companyId)
      .maybeSingle()

    if (companyErr) throw companyErr
    if (!company) return json({ error: 'Точка не найдена' }, 404)

    const payload = normalizePayload(body?.settings ?? body, companyId, (company as any).organization_id || null)

    const { data: existing, error: existErr } = await supabase
      .from('point_receipt_settings')
      .select('id')
      .eq('company_id', companyId)
      .maybeSingle()

    if (existErr) throw existErr

    if (existing) {
      const { data, error } = await supabase
        .from('point_receipt_settings')
        .update(payload)
        .eq('id', (existing as any).id)
        .select('*')
        .maybeSingle()
      if (error) throw error

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        entityType: 'point-receipt-settings',
        entityId: String((existing as any).id),
        action: 'update',
        payload: { company_id: companyId },
      })

      return json({ ok: true, data })
    } else {
      const { data, error } = await supabase
        .from('point_receipt_settings')
        .insert([payload])
        .select('*')
        .single()
      if (error) throw error

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        entityType: 'point-receipt-settings',
        entityId: String((data as any).id),
        action: 'create',
        payload: { company_id: companyId },
      })

      return json({ ok: true, data })
    }
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/receipt-settings.PUT',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось сохранить настройки чека' }, 500)
  }
}
