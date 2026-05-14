import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const FACT_WINDOW_DAYS = 90

type ZoneInput = {
  id?: string
  name: string
  device_type?: string
  device_count: number
  assumed_occupancy_hours: number
  tariff_mix?: Array<{ tariff_id: string; share_pct: number }>
  sort_order?: number
}
type TariffInput = {
  id: string
  name: string
  paid_hours: number
  bonus_hours: number
  price: number
  sort_order?: number
}

function num(v: unknown, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(String(v ?? 0).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, max)
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Список точек, доступных пользователю.
    let cq = supabase.from('companies').select('id, name, code, organization_id').order('name')
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ ok: true, data: { companies: [], company_id: null, zones: [], tariffs: [], fact: null } })
      }
      cq = cq.in('id', companyScope.allowedCompanyIds)
    }
    const { data: companies, error: cErr } = await cq
    if (cErr) throw cErr

    const url = new URL(req.url)
    const requestedCompanyId = String(url.searchParams.get('company_id') || '').trim()
    const companyId =
      requestedCompanyId && (companies || []).some((c: any) => c.id === requestedCompanyId)
        ? requestedCompanyId
        : (companies || [])[0]?.id || null

    if (!companyId) {
      return json({ ok: true, data: { companies: companies || [], company_id: null, zones: [], tariffs: [], fact: null } })
    }

    // Конфиг зон и тарифов для выбранной точки.
    const [zonesRes, tariffsRes] = await Promise.all([
      supabase
        .from('simulation_zones')
        .select('id, name, device_type, device_count, assumed_occupancy_hours, tariff_mix, sort_order')
        .eq('company_id', companyId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('simulation_tariffs')
        .select('id, name, paid_hours, bonus_hours, price, sort_order')
        .eq('company_id', companyId)
        .order('sort_order', { ascending: true }),
    ])
    if (zonesRes.error) throw zonesRes.error
    if (tariffsRes.error) throw tariffsRes.error

    // Факт: средняя выручка точки за последние 90 дней.
    const today = new Date()
    const fromDate = new Date(today.getTime() - FACT_WINDOW_DAYS * 86_400_000)
    const fromIso = fromDate.toISOString().slice(0, 10)
    const toIso = today.toISOString().slice(0, 10)

    const CHUNK = 1000
    let cursor = 0
    let totalRevenue = 0
    while (true) {
      const { data, error } = await supabase
        .from('incomes')
        .select('cash_amount, kaspi_amount, card_amount, online_amount')
        .eq('company_id', companyId)
        .gte('date', fromIso)
        .lte('date', toIso)
        .range(cursor, cursor + CHUNK - 1)
      if (error) throw error
      const batch = data || []
      for (const r of batch as any[]) {
        totalRevenue +=
          Number(r.cash_amount || 0) +
          Number(r.kaspi_amount || 0) +
          Number(r.card_amount || 0) +
          Number(r.online_amount || 0)
      }
      if (batch.length < CHUNK) break
      cursor += CHUNK
    }

    const fact = {
      window_days: FACT_WINDOW_DAYS,
      total_revenue: Math.round(totalRevenue),
      revenue_per_day: Math.round(totalRevenue / FACT_WINDOW_DAYS),
      revenue_per_month: Math.round((totalRevenue / FACT_WINDOW_DAYS) * 30),
    }

    return json({
      ok: true,
      data: {
        companies: companies || [],
        company_id: companyId,
        zones: zonesRes.data || [],
        tariffs: tariffsRes.data || [],
        fact,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/simulation.GET',
      message: error?.message || 'error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось загрузить симуляцию') }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const body = (await req.json().catch(() => null)) as {
      company_id?: string
      zones?: ZoneInput[]
      tariffs?: TariffInput[]
    } | null
    if (!body) return json({ error: 'invalid-body' }, 400)

    const companyId = String(body.company_id || '').trim()
    if (!companyId) return json({ error: 'Выберите точку' }, 400)

    // Проверяем доступ к точке и достаём organization_id.
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds !== null && !companyScope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'forbidden' }, 403)
    }
    const { data: companyRow, error: companyErr } = await supabase
      .from('companies')
      .select('id, organization_id')
      .eq('id', companyId)
      .maybeSingle()
    if (companyErr) throw companyErr
    if (!companyRow) return json({ error: 'Точка не найдена' }, 404)
    const organizationId = companyRow.organization_id || access.activeOrganization?.id || null

    const tariffs = (body.tariffs || [])
      .map((t, idx) => ({
        id: String(t.id || '').trim(),
        organization_id: organizationId,
        company_id: companyId,
        name: String(t.name || '').trim() || 'Тариф',
        paid_hours: num(t.paid_hours, 999),
        bonus_hours: num(t.bonus_hours, 999),
        price: num(t.price, 99_999_999),
        sort_order: t.sort_order ?? idx,
      }))
      .filter((t) => t.id && t.paid_hours + t.bonus_hours > 0)

    const tariffIds = new Set(tariffs.map((t) => t.id))
    const zones = (body.zones || [])
      .map((z, idx) => ({
        organization_id: organizationId,
        company_id: companyId,
        name: String(z.name || '').trim() || 'Зона',
        device_type: String(z.device_type || 'pc').trim() || 'pc',
        device_count: Math.round(num(z.device_count, 100_000)),
        assumed_occupancy_hours: num(z.assumed_occupancy_hours, 24),
        // оставляем в миксе только существующие тарифы
        tariff_mix: (z.tariff_mix || [])
          .filter((m) => m && tariffIds.has(String(m.tariff_id)))
          .map((m) => ({ tariff_id: String(m.tariff_id), share_pct: num(m.share_pct, 100) })),
        sort_order: z.sort_order ?? idx,
      }))

    // Полная замена конфига точки: удаляем старое, вставляем новое.
    const { error: delZonesErr } = await supabase.from('simulation_zones').delete().eq('company_id', companyId)
    if (delZonesErr) throw delZonesErr
    const { error: delTariffsErr } = await supabase.from('simulation_tariffs').delete().eq('company_id', companyId)
    if (delTariffsErr) throw delTariffsErr

    if (tariffs.length > 0) {
      const { error: insTariffsErr } = await supabase.from('simulation_tariffs').insert(tariffs)
      if (insTariffsErr) throw insTariffsErr
    }
    if (zones.length > 0) {
      const { error: insZonesErr } = await supabase.from('simulation_zones').insert(zones)
      if (insZonesErr) throw insZonesErr
    }

    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      entityType: 'simulation-config',
      entityId: companyId,
      action: 'save',
      payload: { company_id: companyId, zones: zones.length, tariffs: tariffs.length },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/simulation.POST',
      message: error?.message || 'error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось сохранить конфигурацию') }, 500)
  }
}
