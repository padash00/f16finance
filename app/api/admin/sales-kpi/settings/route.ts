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
import { earliestSaleDate, todayISO } from '@/lib/server/store-kpi'
import { fetchOpenMeteoArchive } from '@/lib/server/weather-open-meteo'

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

    // Товары нужны для правил уровня «конкретная позиция». Берём активные:
    // предлагать допродажу снятого с продажи товара смысла нет.
    const { data: items, error: itemsErr } = await supabase
      .from('inventory_items')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name')
      .limit(500)
    if (itemsErr) throw itemsErr

    // Правила допродаж могут ссылаться и на категорию, и на конкретный товар.
    const { data: rules, error: rulesErr } = await supabase
      .from('store_kpi_cross_sell_rules')
      .select('id, source_kind, source_ref, target_kind, target_ref, weight, active')
      .eq('company_id', companyId)
      .order('created_at')
    if (rulesErr) throw rulesErr

    const settings = normalizeStoreKpiSettings(settingsRow)

    return json({
      data: {
        configured: Boolean(settingsRow),
        settings: {
          min_sample_size: settings.min_sample_size,
          min_qualifying_shifts: settings.min_qualifying_shifts,
          min_receipts_for_full_score: settings.min_receipts_for_full_score,
          latitude: settings.latitude,
          longitude: settings.longitude,
          weather_adjusts_bonus_threshold: settings.weather_adjusts_bonus_threshold,
          require_product_test_for_top_bonus: settings.require_product_test_for_top_bonus,
          monthly_bonus_strong: settings.monthly_bonus_strong,
          monthly_bonus_top: settings.monthly_bonus_top,
        },
        companies: companies || [],
        categories: categories || [],
        items: items || [],
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

    // ── Координаты и ворота ───────────────────────────────────────────────
    if (action === 'save_settings') {
      const { data: before } = await supabase
        .from('store_kpi_settings')
        .select('latitude, longitude, require_product_test_for_top_bonus, weather_adjusts_bonus_threshold')
        .eq('company_id', companyId)
        .maybeSingle()

      // Координаты нужны только для погоды. Мусор в них не пишем: без
      // координат погода просто не собирается, а неверные дали бы погоду
      // чужого города и молча испортили бы прогноз.
      // Запятую как десятичный разделитель принимаем и на сервере: форму
      // могут звать не только из нашего интерфейса.
      const coord = (raw: unknown): number =>
        typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw)
      const lat = coord(body.latitude)
      const lon = coord(body.longitude)
      const latitude = Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null
      const longitude = Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : null

      // Пишем только то, что реально пришло в запросе. Раньше форма без поля
      // «погода двигает пороги» молча выключала его при каждом сохранении
      // координат — настройка сбрасывалась, а причину найти было негде.
      const patch: Record<string, unknown> = {
        organization_id: company.organization_id,
        company_id: companyId,
        latitude,
        longitude,
        updated_by: access.user?.id || null,
        updated_at: new Date().toISOString(),
      }
      if ('require_product_test_for_top_bonus' in body) {
        patch.require_product_test_for_top_bonus = body.require_product_test_for_top_bonus === true
      }
      if ('weather_adjusts_bonus_threshold' in body) {
        patch.weather_adjusts_bonus_threshold = body.weather_adjusts_bonus_threshold === true
      }

      // Суммы доплаты. Это правило, а не разовое решение: продавец должен
      // знать заранее, к чему идёт. Разово поправить сумму можно при самом
      // начислении — там для этого нужна причина.
      const money = (raw: unknown): number | null => {
        const n = typeof raw === 'string' ? Number(raw.replace(/[^\d]/g, '')) : Number(raw)
        return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? Math.round(n) : null
      }
      if ('monthly_bonus_strong' in body) {
        const value = money(body.monthly_bonus_strong)
        if (value == null) return json({ error: 'bonus-invalid' }, 400)
        patch.monthly_bonus_strong = value
      }
      if ('monthly_bonus_top' in body) {
        const value = money(body.monthly_bonus_top)
        if (value == null) return json({ error: 'bonus-invalid' }, 400)
        patch.monthly_bonus_top = value
      }

      const { error } = await supabase
        .from('store_kpi_settings')
        .upsert(patch, { onConflict: 'company_id' })
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: 'store_kpi_settings',
        entityId: companyId,
        action: 'update',
        organizationId: company.organization_id,
        payload: {
          company_id: companyId,
          before: before ?? null,
          after: {
            latitude,
            longitude,
            require_product_test_for_top_bonus: body.require_product_test_for_top_bonus === true,
          },
        },
      })

      return json({ ok: true })
    }

    // ── Догрузка погоды за прошлое ────────────────────────────────────────
    if (action === 'backfill_weather') {
      const { data: settingsRow } = await supabase
        .from('store_kpi_settings')
        .select('latitude, longitude')
        .eq('company_id', companyId)
        .maybeSingle()

      const latitude = Number(settingsRow?.latitude)
      const longitude = Number(settingsRow?.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return json({ error: 'coordinates-required' }, 400)
      }

      // Грузим ровно тот отрезок, где есть продажи: погода без продаж модулю
      // не нужна, а лишние годы архива — это лишние строки в базе.
      const firstSale = await earliestSaleDate(supabase, companyId)
      if (!firstSale) return json({ error: 'no-sales' }, 400)

      const from = String(body.from || firstSale).slice(0, 10)
      const to = String(body.to || todayISO()).slice(0, 10)
      if (to < from) return json({ error: 'range-invalid' }, 400)

      const days = await fetchOpenMeteoArchive({ latitude, longitude, from, to })
      if (days.length === 0) return json({ ok: true, loaded: 0, from, to })

      const rows = days.map((d) => ({
        organization_id: company.organization_id,
        company_id: companyId,
        day: d.day,
        // Только факт. Архив — это то, что случилось, а не то, что знали заранее.
        kind: 'actual' as const,
        captured_on: d.day,
        temperature_max: d.temperature_max,
        temperature_min: d.temperature_min,
        temperature_mean: d.temperature_mean,
        apparent_temperature_max: d.apparent_temperature_max,
        precipitation_mm: d.precipitation_mm,
        precipitation_probability: d.precipitation_probability,
        rain: d.rain,
        snow: d.snow,
        wind_speed: d.wind_speed,
        weather_code: d.weather_code,
        payload: d.payload,
        hourly: d.hourly,
      }))

      // Пишем частями: 227 дней в одном запросе PostgREST переживёт, а три
      // года — уже нет.
      const CHUNK = 200
      let loaded = 0
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase
          .from('store_kpi_weather')
          .upsert(rows.slice(i, i + CHUNK), { onConflict: 'company_id,day,kind,captured_on' })
        if (error) throw error
        loaded += Math.min(CHUNK, rows.length - i)
      }

      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: 'store_kpi_weather',
        entityId: companyId,
        action: 'create',
        organizationId: company.organization_id,
        payload: { company_id: companyId, from, to, loaded, source: 'open-meteo-archive' },
      })

      return json({ ok: true, loaded, from, to })
    }

    // ── Правило допродажи ─────────────────────────────────────────────────
    if (action === 'add_rule') {
      const sourceKind = body.source_kind === 'item' ? 'item' : 'category'
      const targetKind = body.target_kind === 'item' ? 'item' : 'category'
      const source = String(body.source_ref || '')
      const target = String(body.target_ref || '')
      if (!source || !target) return json({ error: 'refs-required' }, 400)
      // Правило «сам на себя» выполнялось бы автоматически и завышало бы
      // допродажи всем подряд.
      if (sourceKind === targetKind && source === target) return json({ error: 'refs-must-differ' }, 400)

      // Обе стороны обязаны принадлежать каталогу ЭТОЙ точки: иначе правило
      // считало бы допродажи по чужому ассортименту.
      const belongs = async (kind: 'category' | 'item', id: string) => {
        const table = kind === 'category' ? 'inventory_categories' : 'inventory_items'
        const { data, error } = await supabase
          .from(table)
          .select('id')
          .eq('company_id', companyId)
          .eq('id', id)
          .maybeSingle()
        if (error) throw error
        return Boolean(data)
      }
      if (!(await belongs(sourceKind, source)) || !(await belongs(targetKind, target))) {
        return json({ error: 'ref-out-of-scope' }, 400)
      }

      const { error } = await supabase.from('store_kpi_cross_sell_rules').upsert(
        {
          organization_id: company.organization_id,
          company_id: companyId,
          source_kind: sourceKind,
          source_ref: source,
          target_kind: targetKind,
          target_ref: target,
          weight: Number(body.weight) > 0 ? Number(body.weight) : 1,
          active: true,
          created_by: access.user?.id || null,
        },
        { onConflict: 'company_id,source_kind,source_ref,target_kind,target_ref' },
      )
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: 'store_kpi_cross_sell_rules',
        entityId: companyId,
        action: 'create',
        organizationId: company.organization_id,
        payload: { company_id: companyId, sourceKind, source, targetKind, target },
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
