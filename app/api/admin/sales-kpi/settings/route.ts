/**
 * Настройки модуля «Эффективность продавцов».
 *
 * Две вещи, которые нельзя вывести из данных и которые обязан задать владелец:
 *   1. точка-клуб — её выручка служит прокси потока (SENET посетителей не
 *      отдаёт, а магазин и клуб — разные company_id, автоматически их не
 *      связать);
 *   2. правила допродаж «категория → категория» — ассортимент у каждой точки
 *      свой, зашивать «рамен → напиток» в код нельзя.
 *
 * Настройки прямо влияют на оценку людей, поэтому право отдельное
 * (`sales-kpi.manage`, severity high) и каждое изменение уходит в журнал.
 */
import { NextResponse } from 'next/server'

import { requireStaffCapability } from '@/lib/server/capabilities'
import { requireAddon } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { normalizeStoreKpiSettings } from '@/lib/domain/store-kpi'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Общая часть: авторизация, скоуп и проверка, что точка своя. */
async function resolveContext(request: Request, capability: string) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return { response: access.response }

  const denied = await requireStaffCapability(access, capability)
  if (denied) return { response: denied }

  const noAddon = await requireAddon(access, 'addon.sales_kpi')
  if (noAddon) return { response: noAddon }

  if (!hasAdminSupabaseCredentials()) return { response: json({ error: 'service_role_missing' }, 500) }

  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  return { access, scope, supabase: createAdminSupabaseClient() }
}

function inScope(scope: { allowedCompanyIds: string[] | null }, companyId: string): boolean {
  return !scope.allowedCompanyIds || scope.allowedCompanyIds.includes(companyId)
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveContext(request, 'sales-kpi.view')
    if ('response' in ctx) return ctx.response
    const { supabase, scope } = ctx

    const companyId = new URL(request.url).searchParams.get('company_id')
    if (!companyId) return json({ error: 'company-required' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    let companiesQuery = supabase.from('companies').select('id, name, store_enabled').order('name')
    if (scope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)
    const { data: companies, error: companiesErr } = await companiesQuery
    if (companiesErr) throw companiesErr

    const { data: settingsRow, error: settingsErr } = await supabase
      .from('store_kpi_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle()
    if (settingsErr) throw settingsErr

    // Каталог точки: категории нужны для правил допродаж.
    const { data: categories, error: catErr } = await supabase
      .from('inventory_categories')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name')
    if (catErr) throw catErr

    const { data: rules, error: rulesErr } = await supabase
      .from('store_kpi_cross_sell_rules')
      .select('id, source_category_id, target_category_id, weight, active')
      .eq('company_id', companyId)
      .order('created_at')
    if (rulesErr) throw rulesErr

    const settings = normalizeStoreKpiSettings(settingsRow)

    return json({
      data: {
        configured: Boolean(settingsRow),
        settings: {
          club_company_id: settings.club_company_id,
          min_sample_size: settings.min_sample_size,
          min_qualifying_shifts: settings.min_qualifying_shifts,
          min_receipts_for_full_score: settings.min_receipts_for_full_score,
          latitude: settings.latitude,
          longitude: settings.longitude,
          weather_adjusts_bonus_threshold: settings.weather_adjusts_bonus_threshold,
          require_product_test_for_top_bonus: settings.require_product_test_for_top_bonus,
        },
        companies: companies || [],
        categories: categories || [],
        rules: rules || [],
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/settings GET',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveContext(request, 'sales-kpi.manage')
    if ('response' in ctx) return ctx.response
    const { supabase, scope, access } = ctx

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const companyId = String(body.company_id || '')
    if (!companyId) return json({ error: 'company-required' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id, organization_id')
      .eq('id', companyId)
      .maybeSingle()
    if (companyErr) throw companyErr
    if (!company?.organization_id) return json({ error: 'company-without-organization' }, 400)

    const action = String(body.action || 'save_settings')

    // ── Точка-клуб и пороги ───────────────────────────────────────────────
    if (action === 'save_settings') {
      const clubRaw = body.club_company_id
      const clubId = typeof clubRaw === 'string' && clubRaw ? clubRaw : null
      // Прокси потока обязан быть своей точкой: иначе через настройку можно
      // было бы подтянуть выручку чужой организации.
      if (clubId && !inScope(scope, clubId)) {
        return json({ error: 'forbidden', code: 'club-out-of-scope' }, 403)
      }
      if (clubId && clubId === companyId) return json({ error: 'club-cannot-be-self' }, 400)

      const { data: before } = await supabase
        .from('store_kpi_settings')
        .select('club_company_id')
        .eq('company_id', companyId)
        .maybeSingle()

      // Координаты нужны только для погоды. Мусор в них не пишем: без
      // координат погода просто не собирается, а неверные дали бы погоду
      // чужого города и молча испортили бы прогноз.
      const lat = Number(body.latitude)
      const lon = Number(body.longitude)
      const latitude = Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null
      const longitude = Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : null

      const { error } = await supabase.from('store_kpi_settings').upsert(
        {
          organization_id: company.organization_id,
          company_id: companyId,
          club_company_id: clubId,
          latitude,
          longitude,
          weather_adjusts_bonus_threshold: body.weather_adjusts_bonus_threshold === true,
          require_product_test_for_top_bonus: body.require_product_test_for_top_bonus === true,
          updated_by: access.user?.id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id' },
      )
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: 'store_kpi_settings',
        entityId: companyId,
        action: 'update',
        organizationId: company.organization_id,
        payload: {
          company_id: companyId,
          club_company_id_before: before?.club_company_id ?? null,
          club_company_id_after: clubId,
        },
      })

      return json({ ok: true })
    }

    // ── Правило допродажи ─────────────────────────────────────────────────
    if (action === 'add_rule') {
      const source = String(body.source_category_id || '')
      const target = String(body.target_category_id || '')
      if (!source || !target) return json({ error: 'categories-required' }, 400)
      if (source === target) return json({ error: 'categories-must-differ' }, 400)

      // Категории обязаны принадлежать этой же точке: иначе правило считало бы
      // допродажи по чужому каталогу.
      const { data: cats, error: catErr } = await supabase
        .from('inventory_categories')
        .select('id')
        .eq('company_id', companyId)
        .in('id', [source, target])
      if (catErr) throw catErr
      if ((cats || []).length !== 2) return json({ error: 'category-out-of-scope' }, 400)

      const { error } = await supabase.from('store_kpi_cross_sell_rules').upsert(
        {
          organization_id: company.organization_id,
          company_id: companyId,
          source_category_id: source,
          target_category_id: target,
          weight: Number(body.weight) > 0 ? Number(body.weight) : 1,
          active: true,
          created_by: access.user?.id || null,
        },
        { onConflict: 'company_id,source_category_id,target_category_id' },
      )
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: 'store_kpi_cross_sell_rules',
        entityId: companyId,
        action: 'create',
        organizationId: company.organization_id,
        payload: { company_id: companyId, source, target },
      })

      return json({ ok: true })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/settings POST',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await resolveContext(request, 'sales-kpi.manage')
    if ('response' in ctx) return ctx.response
    const { supabase, scope, access } = ctx

    const ruleId = new URL(request.url).searchParams.get('rule_id')
    if (!ruleId) return json({ error: 'rule-required' }, 400)

    const { data: rule, error: ruleErr } = await supabase
      .from('store_kpi_cross_sell_rules')
      .select('id, company_id, organization_id')
      .eq('id', ruleId)
      .maybeSingle()
    if (ruleErr) throw ruleErr
    if (!rule) return json({ error: 'not-found' }, 404)
    // Правило ищется по id, поэтому принадлежность точке проверяется явно —
    // иначе чужое правило удалялось бы по прямому вызову API.
    if (!inScope(scope, String(rule.company_id))) {
      return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)
    }

    const { error } = await supabase.from('store_kpi_cross_sell_rules').delete().eq('id', ruleId)
    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'store_kpi_cross_sell_rules',
      entityId: String(rule.company_id),
      action: 'delete',
      organizationId: rule.organization_id ? String(rule.organization_id) : undefined,
      payload: { rule_id: ruleId },
    })

    return json({ ok: true })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/settings DELETE',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
