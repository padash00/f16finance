import { NextResponse } from 'next/server'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { effectiveZoneExtensionHourly } from '@/lib/core/arena-zone-extension-hourly'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function filterProjectsByCompanyScope(projects: any[], allowedCompanyIds: string[] | null) {
  if (!allowedCompanyIds) return projects
  return projects
    .map((project) => {
      const companies = Array.isArray(project.point_project_companies) ? project.point_project_companies : []
      return {
        ...project,
        point_project_companies: companies.filter((item: any) => allowedCompanyIds.includes(String(item.company_id || ''))),
      }
    })
    .filter((project) => project.point_project_companies.length > 0)
}

async function ensureProjectAccess(supabase: any, projectId: string, allowedCompanyIds: string[] | null) {
  if (!allowedCompanyIds) return
  const { data, error } = await supabase
    .from('point_project_companies')
    .select('company_id')
    .eq('project_id', projectId)

  if (error) throw error
  const hasAccess = (data || []).some((row: any) => allowedCompanyIds.includes(String(row.company_id || '')))
  if (!hasAccess) throw new Error('forbidden-project')
}

async function ensureArenaEntityAccess(
  supabase: any,
  table: 'arena_zones' | 'arena_stations' | 'arena_tariffs' | 'arena_map_decorations',
  id: string,
  allowedCompanyIds: string[] | null,
) {
  if (!allowedCompanyIds) return
  const { data, error } = await supabase
    .from(table)
    .select('id, point_project_id, company_id')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('not-found')
  if (data.company_id && allowedCompanyIds.includes(String(data.company_id))) return
  await ensureProjectAccess(supabase, String(data.point_project_id || ''), allowedCompanyIds)
}

async function getContext(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access
  if (!access.isSuperAdmin && access.staffRole !== 'owner') {
    return { response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return access
}

// GET /api/admin/arena?projectId=xxx - get all data for a project
export async function GET(request: Request) {
  try {
    const access = await getContext(request)
    if ('response' in access) return access.response
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const companyId = searchParams.get('companyId') || null
    if (companyId) {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId: companyId,
      })
    }

    // List mode — return arena-enabled point projects with their arena-enabled companies
    if (!projectId) {
      const { data: allProjects } = await supabase
        .from('point_projects')
        .select('id, name, feature_flags, point_project_companies(company_id, feature_flags, company:company_id(id, name))')
        .order('name')

      const arenaProjects = filterProjectsByCompanyScope((allProjects || []) as any[], companyScope.allowedCompanyIds)
        .filter((p: any) => {
          const projEnabled = p.feature_flags?.arena_enabled === true
          const compEnabled = Array.isArray(p.point_project_companies) &&
            p.point_project_companies.some((c: any) => c.feature_flags?.arena_enabled === true)
          return projEnabled || compEnabled
        })
        .map((p: any) => {
          const enabledCompanies = (Array.isArray(p.point_project_companies) ? p.point_project_companies : [])
            .filter((c: any) => c.feature_flags?.arena_enabled === true || p.feature_flags?.arena_enabled === true)
            .map((c: any) => {
              const co = Array.isArray(c.company) ? c.company[0] : c.company
              return { id: c.company_id, name: co?.name || c.company_id }
            })
          return { id: p.id, name: p.name, companies: enabledCompanies }
        })

      return json({ ok: true, data: { projects: arenaProjects } })
    }

    // Get project name
    await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
    const { data: project } = await supabase
      .from('point_projects')
      .select('id, name')
      .eq('id', projectId)
      .single()

    function withCompany<T>(q: T): T {
      if (!companyId) return q
      return (q as any).or(`company_id.eq.${companyId},company_id.is.null`) as T
    }

    const [
      { data: zones, error: zonesError },
      { data: stations, error: stationsError },
      { data: tariffs, error: tariffsError },
      { data: decorations, error: decorationsError },
    ] = await Promise.all([
      withCompany(supabase.from('arena_zones').select('*').eq('point_project_id', projectId)).order('name'),
      withCompany(supabase.from('arena_stations').select('*').eq('point_project_id', projectId)).order('order_index').order('name'),
      withCompany(supabase.from('arena_tariffs').select('*').eq('point_project_id', projectId)).order('price'),
      withCompany(supabase.from('arena_map_decorations').select('*').eq('point_project_id', projectId)).order('created_at'),
    ])

    if (zonesError) throw zonesError
    if (stationsError) throw stationsError
    if (tariffsError) throw tariffsError
    if (decorationsError) throw decorationsError

    const allTariffs = tariffs || []
    const zonesOut = (zones || []).map((z: any) => {
      const eff = effectiveZoneExtensionHourly(z, z.id, allTariffs)
      return eff != null ? { ...z, extension_hourly_price: eff } : z
    })

    return json({
      ok: true,
      data: { project, zones: zonesOut, stations: stations || [], tariffs: allTariffs, decorations: decorations || [] },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/arena:get', message: error?.message || 'Arena GET error' })
    return json({ error: error?.message || 'Ошибка загрузки' }, 500)
  }
}

// POST /api/admin/arena - CRUD operations
export async function POST(request: Request) {
  try {
    const access = await getContext(request)
    if ('response' in access) return access.response
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'action required' }, 400)

    const bodyCompanyId: string | null = body.companyId || null
    if (bodyCompanyId) {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId: bodyCompanyId,
      })
    }

    // ─── ZONES ───────────────────────────────────────────────────────
    if (body.action === 'createZone') {
      const { projectId, name } = body
      if (!projectId || !name?.trim()) return json({ error: 'projectId and name required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      const { data, error } = await supabase.from('arena_zones').insert({ point_project_id: projectId, company_id: bodyCompanyId, name: name.trim() }).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'updateZone') {
      const { zoneId, name, is_active, extension_hourly_price } = body
      if (!zoneId) return json({ error: 'zoneId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_zones', zoneId, companyScope.allowedCompanyIds)
      const update: any = {}
      if (name !== undefined) update.name = name.trim()
      if (is_active !== undefined) update.is_active = is_active
      if (extension_hourly_price !== undefined) {
        const extH =
          extension_hourly_price !== null && extension_hourly_price !== ''
            ? Number(extension_hourly_price)
            : null
        update.extension_hourly_price =
          extH != null && Number.isFinite(extH) && extH > 0 ? extH : null
      }
      const { data, error } = await supabase.from('arena_zones').update(update).eq('id', zoneId).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'deleteZone') {
      const { zoneId } = body
      if (!zoneId) return json({ error: 'zoneId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_zones', zoneId, companyScope.allowedCompanyIds)
      const { error } = await supabase.from('arena_zones').delete().eq('id', zoneId)
      if (error) throw error
      return json({ ok: true })
    }

    // ─── STATIONS ────────────────────────────────────────────────────
    if (body.action === 'createStation') {
      const { projectId, zoneId, name, order_index } = body
      if (!projectId || !name?.trim()) return json({ error: 'projectId and name required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      const { data, error } = await supabase.from('arena_stations').insert({
        point_project_id: projectId,
        company_id: bodyCompanyId,
        zone_id: zoneId || null,
        name: name.trim(),
        order_index: order_index ?? 0,
      }).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'updateStation') {
      const { stationId, name, zone_id, order_index, is_active } = body
      if (!stationId) return json({ error: 'stationId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_stations', stationId, companyScope.allowedCompanyIds)
      const update: any = {}
      if (name !== undefined) update.name = name.trim()
      if (zone_id !== undefined) update.zone_id = zone_id
      if (order_index !== undefined) update.order_index = order_index
      if (is_active !== undefined) update.is_active = is_active
      const { data, error } = await supabase.from('arena_stations').update(update).eq('id', stationId).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'deleteStation') {
      const { stationId } = body
      if (!stationId) return json({ error: 'stationId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_stations', stationId, companyScope.allowedCompanyIds)
      const { error } = await supabase.from('arena_stations').delete().eq('id', stationId)
      if (error) throw error
      return json({ ok: true })
    }

    // ─── TARIFFS ─────────────────────────────────────────────────────
    if (body.action === 'createTariff') {
      const { projectId, zoneId, name, duration_minutes, price, tariff_type, window_end_time, window_start_time } = body
      if (!projectId || !zoneId || !name?.trim()) return json({ error: 'projectId, zoneId and name required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      const { data, error } = await supabase.from('arena_tariffs').insert({
        point_project_id: projectId,
        company_id: bodyCompanyId,
        zone_id: zoneId,
        name: name.trim(),
        duration_minutes: Number(duration_minutes) || 60,
        price: Number(price) || 0,
        tariff_type: tariff_type || 'fixed',
        window_start_time: window_start_time || null,
        window_end_time: window_end_time || null,
      }).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'updateTariff') {
      const { tariffId, name, duration_minutes, price, is_active, tariff_type, window_end_time, window_start_time } = body
      if (!tariffId) return json({ error: 'tariffId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_tariffs', tariffId, companyScope.allowedCompanyIds)
      const update: any = {}
      if (name !== undefined) update.name = name.trim()
      if (duration_minutes !== undefined) update.duration_minutes = Number(duration_minutes)
      if (price !== undefined) update.price = Number(price)
      if (is_active !== undefined) update.is_active = is_active
      if (tariff_type !== undefined) update.tariff_type = tariff_type
      if (window_start_time !== undefined) update.window_start_time = window_start_time || null
      if (window_end_time !== undefined) update.window_end_time = window_end_time || null
      const { data, error } = await supabase.from('arena_tariffs').update(update).eq('id', tariffId).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'deleteTariff') {
      const { tariffId } = body
      if (!tariffId) return json({ error: 'tariffId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_tariffs', tariffId, companyScope.allowedCompanyIds)
      const { error } = await supabase.from('arena_tariffs').delete().eq('id', tariffId)
      if (error) throw error
      return json({ ok: true })
    }

    // ─── MAP LAYOUT ──────────────────────────────────────────────────
    if (body.action === 'updateMapLayout') {
      const { stations: stationUpdates, zones: zoneUpdates, decorations: decorationUpdates } = body
      if (Array.isArray(stationUpdates)) {
        for (const u of stationUpdates) {
          if (!u.id) continue
          await ensureArenaEntityAccess(supabase, 'arena_stations', u.id, companyScope.allowedCompanyIds)
          await supabase.from('arena_stations').update({ grid_x: u.grid_x, grid_y: u.grid_y }).eq('id', u.id)
        }
      }
      if (Array.isArray(zoneUpdates)) {
        for (const u of zoneUpdates) {
          if (!u.id) continue
          await ensureArenaEntityAccess(supabase, 'arena_zones', u.id, companyScope.allowedCompanyIds)
          const upd: any = {}
          if (u.grid_x !== undefined) upd.grid_x = u.grid_x
          if (u.grid_y !== undefined) upd.grid_y = u.grid_y
          if (u.grid_w !== undefined) upd.grid_w = u.grid_w
          if (u.grid_h !== undefined) upd.grid_h = u.grid_h
          if (u.color !== undefined) upd.color = u.color
          if (Object.keys(upd).length > 0) await supabase.from('arena_zones').update(upd).eq('id', u.id)
        }
      }
      if (Array.isArray(decorationUpdates)) {
        for (const u of decorationUpdates) {
          if (!u.id) continue
          await ensureArenaEntityAccess(supabase, 'arena_map_decorations', u.id, companyScope.allowedCompanyIds)
          await supabase.from('arena_map_decorations').update({ grid_x: u.grid_x, grid_y: u.grid_y }).eq('id', u.id)
        }
      }
      return json({ ok: true })
    }

    if (body.action === 'createDecoration') {
      const { projectId, type, grid_x, grid_y, grid_w, grid_h, label, rotation } = body
      if (!projectId) return json({ error: 'projectId required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      const { data, error } = await supabase.from('arena_map_decorations').insert({
        point_project_id: projectId,
        company_id: bodyCompanyId,
        type: type || 'label',
        grid_x: grid_x ?? 0,
        grid_y: grid_y ?? 0,
        grid_w: grid_w ?? 1,
        grid_h: grid_h ?? 1,
        label: label || null,
        rotation: rotation ?? 0,
      }).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'updateDecoration') {
      const { decorationId, grid_x, grid_y, grid_w, grid_h, label, rotation, type } = body
      if (!decorationId) return json({ error: 'decorationId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_map_decorations', decorationId, companyScope.allowedCompanyIds)
      const upd: any = {}
      if (grid_x !== undefined) upd.grid_x = grid_x
      if (grid_y !== undefined) upd.grid_y = grid_y
      if (grid_w !== undefined) upd.grid_w = grid_w
      if (grid_h !== undefined) upd.grid_h = grid_h
      if (label !== undefined) upd.label = label
      if (rotation !== undefined) upd.rotation = rotation
      if (type !== undefined) upd.type = type
      const { data, error } = await supabase.from('arena_map_decorations').update(upd).eq('id', decorationId).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'deleteDecoration') {
      const { decorationId } = body
      if (!decorationId) return json({ error: 'decorationId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_map_decorations', decorationId, companyScope.allowedCompanyIds)
      const { error } = await supabase.from('arena_map_decorations').delete().eq('id', decorationId)
      if (error) throw error
      return json({ ok: true })
    }

    // ─── ANALYTICS ───────────────────────────────────────────────────
    if (body.action === 'getAnalytics') {
      const { projectId, from, to, companyId: analyticsCompanyId } = body
      if (!projectId) return json({ error: 'projectId required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      if (analyticsCompanyId) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: analyticsCompanyId,
        })
      }

      let query = supabase
        .from('arena_sessions')
        .select('id, station_id, tariff_id, started_at, ends_at, ended_at, amount, status, payment_method, cash_amount, kaspi_amount, discount_percent, station:station_id(name, zone_id), tariff:tariff_id(name, duration_minutes, price)')
        .eq('point_project_id', projectId)
        .in('status', ['completed', 'active'])
        .order('started_at', { ascending: false })
        .limit(1000)

      if (analyticsCompanyId) query = query.eq('company_id', analyticsCompanyId)
      if (from) query = query.gte('started_at', from)
      if (to) query = query.lte('started_at', to)

      const { data: sessions, error } = await query
      if (error) throw error

      return json({ ok: true, data: { sessions: sessions || [] } })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/arena:post', message: error?.message || 'Arena POST error' })
    return json({ error: error?.message || 'Ошибка операции' }, 500)
  }
}
