import { NextResponse } from 'next/server'

import { getAllPageFeatures } from '@/lib/nav/sections'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Конструктор тарифов: CRUD пакетов/аддонов + назначение организации.
// Только super-admin (платформенный контур).

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'supabase-unavailable' }, 500)

    const supabase = createAdminSupabaseClient()
    const url = new URL(req.url)
    const orgId = url.searchParams.get('organization_id')

    // Текущее назначение конкретной организации (для экрана назначения).
    if (orgId) {
      const [{ data: pkg }, { data: addons }] = await Promise.all([
        supabase.from('organization_packages').select('package_code').eq('organization_id', orgId).maybeSingle(),
        supabase.from('organization_addons').select('addon_code').eq('organization_id', orgId).eq('enabled', true),
      ])
      return json({
        ok: true,
        organization_id: orgId,
        package_code: pkg?.package_code || null,
        addon_codes: (addons || []).map((a: any) => String(a.addon_code)),
      })
    }

    const [{ data: packages }, { data: addons }] = await Promise.all([
      supabase.from('packages').select('*').order('price_kzt', { ascending: true }),
      supabase.from('addons').select('*').order('price_kzt', { ascending: true }),
    ])

    return json({
      ok: true,
      packages: packages || [],
      addons: addons || [],
      pages: getAllPageFeatures(), // каталог «страница → фича» для пикера
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'supabase-unavailable' }, 500)

    const supabase = createAdminSupabaseClient()
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '')

    const clean = (s: unknown) => String(s ?? '').trim()
    const featureCodes = (v: unknown) => (Array.isArray(v) ? v.map((x) => clean(x)).filter(Boolean) : [])

    if (action === 'save_package') {
      const code = clean(body.code)
      if (!code) return json({ error: 'code обязателен' }, 400)
      const row = {
        code,
        name: clean(body.name) || code,
        vertical: clean(body.vertical) || 'custom',
        description: clean(body.description) || null,
        feature_codes: featureCodes(body.feature_codes),
        price_kzt: Math.max(0, Math.round(Number(body.price_kzt) || 0)),
        status: body.status === 'archived' ? 'archived' : 'active',
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('packages').upsert(row, { onConflict: 'code' })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'delete_package') {
      const code = clean(body.code)
      if (!code) return json({ error: 'code обязателен' }, 400)
      const { error } = await supabase.from('packages').delete().eq('code', code)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'save_addon') {
      const code = clean(body.code)
      if (!code) return json({ error: 'code обязателен' }, 400)
      const unit = ['organization', 'company', 'device'].includes(clean(body.billing_unit)) ? clean(body.billing_unit) : 'organization'
      const row = {
        code,
        name: clean(body.name) || code,
        description: clean(body.description) || null,
        feature_codes: featureCodes(body.feature_codes),
        price_kzt: Math.max(0, Math.round(Number(body.price_kzt) || 0)),
        billing_unit: unit,
        status: body.status === 'archived' ? 'archived' : 'active',
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('addons').upsert(row, { onConflict: 'code' })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'delete_addon') {
      const code = clean(body.code)
      if (!code) return json({ error: 'code обязателен' }, 400)
      const { error } = await supabase.from('addons').delete().eq('code', code)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // Назначить организации пакет + аддоны (полная замена набора аддонов).
    if (action === 'assign_org') {
      const organization_id = clean(body.organization_id)
      if (!organization_id) return json({ error: 'organization_id обязателен' }, 400)
      const packageCode = clean(body.package_code)
      const addonCodes = featureCodes(body.addon_codes)

      if (packageCode) {
        const { error } = await supabase
          .from('organization_packages')
          .upsert({ organization_id, package_code: packageCode, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
        if (error) return json({ error: error.message }, 500)
      } else {
        // Снять пакет → организация снова allAccess (fail-open).
        await supabase.from('organization_packages').delete().eq('organization_id', organization_id)
      }

      // Аддоны: удаляем все и вставляем выбранные (простая полная замена).
      await supabase.from('organization_addons').delete().eq('organization_id', organization_id)
      if (addonCodes.length > 0) {
        const rows = addonCodes.map((addon_code) => ({ organization_id, addon_code, enabled: true, updated_at: new Date().toISOString() }))
        const { error } = await supabase.from('organization_addons').insert(rows)
        if (error) return json({ error: error.message }, 500)
      }
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
