import { NextResponse } from 'next/server'
import { isIP } from 'node:net'
import { randomBytes } from 'node:crypto'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sanitizeOrFilterValue } from '@/lib/server/postgrest-filter'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { effectiveZoneExtensionHourly } from '@/lib/core/arena-zone-extension-hourly'
import { broadcastKioskCommand } from '@/lib/server/kiosk-broadcast'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeDeviceIp(value: unknown): string | null {
  if (value == null) return null
  const ip = String(value).trim()
  if (!ip) return null
  if (!isIP(ip)) throw new Error('invalid-device-ip')
  return ip
}

function normalizeDeviceMac(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const canonical = raw.replace(/-/g, ':').toUpperCase()
  const ok = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(canonical)
  if (!ok) throw new Error('invalid-device-mac')
  return canonical
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
  table: 'arena_zones' | 'arena_stations' | 'arena_tariffs' | 'arena_map_decorations' | 'arena_games_catalog' | 'arena_station_games',
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
  // Capability checks выше уже отсеивают; здесь — любой staff
  if (!access.isSuperAdmin && !access.staffRole) {
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

    // Get project name + branding
    await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)

    function withCompany<T>(q: T): T {
      if (!companyId) return q
      return (q as any).or(`company_id.eq.${companyId},company_id.is.null`) as T
    }

    const [
      { data: project },
      { data: zones, error: zonesError },
      { data: stations, error: stationsError },
      { data: tariffs, error: tariffsError },
      { data: decorations, error: decorationsError },
      { data: gamesCatalog, error: gamesCatalogError },
      { data: stationGames, error: stationGamesError },
    ] = await Promise.all([
      supabase
        .from('point_projects')
        .select('id, name, arena_logo_url, arena_cover_url, arena_accent, arena_description, arena_provisioning_key')
        .eq('id', projectId)
        .single(),
      withCompany(supabase.from('arena_zones').select('*').eq('point_project_id', projectId)).order('name'),
      withCompany(supabase.from('arena_stations').select('*').eq('point_project_id', projectId)).order('order_index').order('name'),
      withCompany(supabase.from('arena_tariffs').select('*').eq('point_project_id', projectId)).order('price'),
      withCompany(supabase.from('arena_map_decorations').select('*').eq('point_project_id', projectId)).order('created_at'),
      withCompany(supabase.from('arena_games_catalog').select('*').eq('point_project_id', projectId)).order('sort_order').order('title'),
      withCompany(supabase.from('arena_station_games').select('*').eq('point_project_id', projectId)).order('sort_order').order('created_at'),
    ])

    if (zonesError) throw zonesError
    if (stationsError) throw stationsError
    if (tariffsError) throw tariffsError
    if (decorationsError) throw decorationsError
    if (gamesCatalogError) throw gamesCatalogError
    if (stationGamesError) throw stationGamesError

    const allTariffs = tariffs || []
    const zonesOut = (zones || []).map((z: any) => {
      const eff = effectiveZoneExtensionHourly(z, z.id, allTariffs)
      return eff != null ? { ...z, extension_hourly_price: eff } : z
    })

    const stationRows = stations || []
    const stationIds = [...new Set(stationRows.map((s: any) => String(s.id || '')).filter(Boolean))]
    let activeByStation: Record<string, { id: string; ends_at: string | null }> = {}
    if (stationIds.length) {
      let q = supabase
        .from('arena_sessions')
        .select('id, station_id, ends_at, status')
        .eq('point_project_id', projectId)
        .eq('status', 'active')
        .in('station_id', stationIds)
      if (companyId) q = q.eq('company_id', companyId)
      const { data: activeRows, error: activeError } = await q
      if (activeError) throw activeError
      activeByStation = Object.fromEntries(
        (activeRows || []).map((r: any) => [
          String(r.station_id),
          { id: String(r.id), ends_at: r.ends_at != null ? String(r.ends_at) : null },
        ]),
      )
    }

    const stationsOut = stationRows.map((s: any) => {
      const sid = String(s.id || '')
      const active = activeByStation[sid]
      if (!active) return s
      return {
        ...s,
        active_session_id: active.id,
        active_session_ends_at: active.ends_at,
      }
    })

    return json({
      ok: true,
      data: {
        project,
        zones: zonesOut,
        stations: stationsOut,
        tariffs: allTariffs,
        decorations: decorations || [],
        gamesCatalog: gamesCatalog || [],
        stationGames: stationGames || [],
      },
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

    // Capability check на основе action — единый диспатчер
    const ACTION_TO_CAPABILITY: Record<string, string> = {
      createZone: 'stations.create_zone',
      updateZone: 'stations.edit_zone',
      deleteZone: 'stations.delete_zone',
      createStation: 'stations.create_station',
      updateStation: 'stations.edit_station',
      updateStationKioskTheme: 'stations.edit_kiosk_background',
      deleteStation: 'stations.delete_station',
      createTariff: 'stations.create_tariff',
      updateTariff: 'stations.edit_tariff',
      deleteTariff: 'stations.delete_tariff',
      updateMapLayout: 'stations.update_map_layout',
      createDecoration: 'stations.create_decoration',
      updateDecoration: 'stations.create_decoration',
      deleteDecoration: 'stations.delete_decoration',
      createGameCatalog: 'stations.create_game_catalog',
      updateGameCatalog: 'stations.edit_game_catalog',
      deleteGameCatalog: 'stations.delete_game_catalog',
      upsertStationGame: 'stations.edit_station_game',
      deleteStationGame: 'stations.delete_station_game',
      bulkUpsertZoneGames: 'stations.bulk_upsert_games',
      topUpClientBalance: 'stations.top_up_balance',
      searchClient: 'stations.top_up_balance',
      adminStartSession: 'stations.admin_start_session',
      adminEndSession: 'stations.admin_end_session',
      rotateProjectProvisioningKey: 'stations.rotate_provisioning_key',
      updateProjectBranding: 'stations.update_branding',
      getAnalytics: 'stations.get_analytics',
    }
    const requiredCap = ACTION_TO_CAPABILITY[String(body.action)]
    if (requiredCap) {
      const denied = await requireCapability(access, requiredCap)
      if (denied) return denied as any
    }

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
      const { projectId, zoneId, name, order_index, device_ip, device_mac } = body
      if (!projectId || !name?.trim()) return json({ error: 'projectId and name required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      const normalizedIp = normalizeDeviceIp(device_ip)
      const normalizedMac = normalizeDeviceMac(device_mac)
      const { data, error } = await supabase.from('arena_stations').insert({
        point_project_id: projectId,
        company_id: bodyCompanyId,
        zone_id: zoneId || null,
        name: name.trim(),
        order_index: order_index ?? 0,
        device_ip: normalizedIp,
        device_mac: normalizedMac,
      }).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'updateStation') {
      const { stationId, name, zone_id, order_index, is_active, device_ip, device_mac, station_code } = body
      if (!stationId) return json({ error: 'stationId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_stations', stationId, companyScope.allowedCompanyIds)
      const update: any = {}
      if (name !== undefined) update.name = name.trim()
      if (zone_id !== undefined) update.zone_id = zone_id
      if (order_index !== undefined) update.order_index = order_index
      if (is_active !== undefined) update.is_active = is_active
      if (device_ip !== undefined) update.device_ip = normalizeDeviceIp(device_ip)
      if (device_mac !== undefined) update.device_mac = normalizeDeviceMac(device_mac)
      if (station_code !== undefined) update.station_code = String(station_code || '').trim() || null
      const { data, error } = await supabase.from('arena_stations').update(update).eq('id', stationId).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'updateStationKioskTheme') {
      const { stationId, kiosk_bg_type, kiosk_bg_value, kiosk_accent, kiosk_logo_url, kiosk_announcement } = body
      if (!stationId) return json({ error: 'stationId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_stations', stationId, companyScope.allowedCompanyIds)
      const validBgTypes = ['color', 'gradient', 'image', 'video']
      const update: any = {}
      if (kiosk_bg_type !== undefined && validBgTypes.includes(kiosk_bg_type)) update.kiosk_bg_type = kiosk_bg_type
      if (kiosk_bg_value !== undefined) update.kiosk_bg_value = String(kiosk_bg_value || '').trim()
      if (kiosk_accent !== undefined) update.kiosk_accent = String(kiosk_accent || '').trim()
      if (kiosk_logo_url !== undefined) update.kiosk_logo_url = String(kiosk_logo_url || '').trim() || null
      if (kiosk_announcement !== undefined) update.kiosk_announcement = String(kiosk_announcement || '').trim() || null
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

    // ─── GAMES CATALOG ────────────────────────────────────────────────
    if (body.action === 'createGameCatalog') {
      const { projectId, title, logo_url, sort_order, is_active, category } = body
      if (!projectId || !title?.trim()) return json({ error: 'projectId and title required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      const validCategories = ['game', 'browser', 'app']
      const { data, error } = await supabase.from('arena_games_catalog').insert({
        point_project_id: projectId,
        company_id: bodyCompanyId,
        title: String(title).trim(),
        logo_url: String(logo_url || '').trim() || null,
        sort_order: Number(sort_order || 0),
        is_active: is_active !== false,
        category: validCategories.includes(category) ? category : 'game',
      }).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'updateGameCatalog') {
      const { gameCatalogId, title, logo_url, sort_order, is_active, category } = body
      if (!gameCatalogId) return json({ error: 'gameCatalogId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_games_catalog', gameCatalogId, companyScope.allowedCompanyIds)
      const validCategories = ['game', 'browser', 'app']
      const update: any = {}
      if (title !== undefined) update.title = String(title || '').trim()
      if (logo_url !== undefined) update.logo_url = String(logo_url || '').trim() || null
      if (sort_order !== undefined) update.sort_order = Number(sort_order || 0)
      if (is_active !== undefined) update.is_active = Boolean(is_active)
      if (category !== undefined && validCategories.includes(category)) update.category = category
      const { data, error } = await supabase.from('arena_games_catalog').update(update).eq('id', gameCatalogId).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'deleteGameCatalog') {
      const { gameCatalogId } = body
      if (!gameCatalogId) return json({ error: 'gameCatalogId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_games_catalog', gameCatalogId, companyScope.allowedCompanyIds)
      const { error } = await supabase.from('arena_games_catalog').delete().eq('id', gameCatalogId)
      if (error) throw error
      return json({ ok: true })
    }

    // ─── STATION GAME BINDINGS ───────────────────────────────────────
    if (body.action === 'upsertStationGame') {
      const { stationId, gameId, exe_path, launch_args, sort_order, is_active } = body
      if (!stationId || !gameId || !exe_path?.trim()) return json({ error: 'stationId, gameId and exe_path required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_stations', stationId, companyScope.allowedCompanyIds)
      await ensureArenaEntityAccess(supabase, 'arena_games_catalog', gameId, companyScope.allowedCompanyIds)
      const { data: stationRow, error: stationError } = await supabase
        .from('arena_stations')
        .select('point_project_id, company_id')
        .eq('id', stationId)
        .single()
      if (stationError) throw stationError
      const { data, error } = await supabase.from('arena_station_games').upsert({
        point_project_id: stationRow.point_project_id,
        company_id: stationRow.company_id || bodyCompanyId,
        station_id: stationId,
        game_id: gameId,
        exe_path: String(exe_path).trim(),
        launch_args: String(launch_args || '').trim() || null,
        sort_order: Number(sort_order || 0),
        is_active: is_active !== false,
      }, { onConflict: 'station_id,game_id' }).select().single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (body.action === 'deleteStationGame') {
      const { stationGameId } = body
      if (!stationGameId) return json({ error: 'stationGameId required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_station_games', stationGameId, companyScope.allowedCompanyIds)
      const { error } = await supabase.from('arena_station_games').delete().eq('id', stationGameId)
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

    // ─── BULK UPSERT ZONE GAMES ──────────────────────────────────────
    if (body.action === 'bulkUpsertZoneGames') {
      const { zoneId, games } = body
      if (!zoneId || !Array.isArray(games)) return json({ error: 'zoneId and games[] required' }, 400)
      await ensureArenaEntityAccess(supabase, 'arena_zones', zoneId, companyScope.allowedCompanyIds)

      // Получаем все станции зоны
      const { data: stationsInZone, error: stErr } = await supabase
        .from('arena_stations')
        .select('id, point_project_id, company_id')
        .eq('zone_id', zoneId)
        .eq('is_active', true)
      if (stErr) throw stErr

      if (!stationsInZone?.length) return json({ ok: true, count: 0 })

      // Для каждой станции upsert каждой игры
      const rows = stationsInZone.flatMap((st: any) =>
        games.map((g: any) => ({
          point_project_id: st.point_project_id,
          company_id: st.company_id || bodyCompanyId,
          station_id: st.id,
          game_id: String(g.gameId),
          exe_path: String(g.exePath || '').trim(),
          launch_args: String(g.launchArgs || '').trim() || null,
          sort_order: Number(g.sortOrder || 0),
          is_active: true,
        })),
      )

      const { error: upsertErr } = await supabase
        .from('arena_station_games')
        .upsert(rows, { onConflict: 'station_id,game_id' })
      if (upsertErr) throw upsertErr

      return json({ ok: true, count: rows.length })
    }

    // ─── CLIENT BALANCE TOP-UP ───────────────────────────────────────
    if (body.action === 'topUpClientBalance') {
      const { phone, amount } = body
      if (!phone?.trim()) return json({ error: 'phone required' }, 400)
      const amt = Number(amount || 0)
      if (!Number.isFinite(amt) || amt <= 0) return json({ error: 'amount must be positive' }, 400)

      const q = phone.trim()
      // Изоляция: ищем/пополняем баланс только клиентов своих компаний.
      let findQuery = supabase
        .from('customers')
        .select('id, name, phone, card_number, kiosk_balance')
        .or(`phone.eq.${sanitizeOrFilterValue(q)},card_number.eq.${sanitizeOrFilterValue(q)}`)
      if (companyScope.allowedCompanyIds) findQuery = findQuery.in('company_id', companyScope.allowedCompanyIds)
      const { data: customer, error: findErr } = await findQuery.maybeSingle()

      if (findErr) throw findErr
      if (!customer) return json({ error: 'client-not-found' }, 404)

      const newBalance = Number(customer.kiosk_balance || 0) + amt
      const { error: updErr } = await supabase
        .from('customers')
        .update({ kiosk_balance: newBalance })
        .eq('id', customer.id)
      if (updErr) throw updErr

      return json({ ok: true, customerId: customer.id, name: customer.name, newBalance })
    }

    // ─── CLIENT SEARCH ───────────────────────────────────────────────
    if (body.action === 'searchClient') {
      const { query: q } = body
      if (!q?.trim()) return json({ error: 'query required' }, 400)
      // Изоляция: поиск клиентов только в своих компаниях.
      let searchQuery = supabase
        .from('customers')
        .select('id, name, phone, card_number, kiosk_balance')
        .or(`phone.ilike.%${sanitizeOrFilterValue(q)}%,card_number.ilike.%${sanitizeOrFilterValue(q)}%,name.ilike.%${sanitizeOrFilterValue(q)}%`)
      if (companyScope.allowedCompanyIds) searchQuery = searchQuery.in('company_id', companyScope.allowedCompanyIds)
      const { data, error } = await searchQuery.limit(10)
      if (error) throw error
      return json({ ok: true, data: data || [] })
    }

    // ── Admin quick session start ──────────────────────────────────────────────
    if (body.action === 'adminStartSession') {
      const { stationId, tariffId, projectId: bProjectId, companyId: bCompanyId } = body as {
        stationId: string; tariffId: string; projectId: string; companyId?: string
      }
      if (!stationId || !tariffId || !bProjectId) return json({ error: 'stationId, tariffId and projectId required' }, 400)

      const { data: tariff } = await supabase
        .from('arena_tariffs')
        .select('id, name, duration_minutes, price')
        .eq('id', tariffId)
        .eq('is_active', true)
        .single()
      if (!tariff) return json({ error: 'tariff-not-found' }, 404)

      const { data: existing } = await supabase
        .from('arena_sessions')
        .select('id')
        .eq('station_id', stationId)
        .eq('status', 'active')
        .maybeSingle()
      if (existing) return json({ error: 'station-already-occupied' }, 409)

      const now = new Date()
      const durationMin = Number(tariff.duration_minutes)
      const endsAt = new Date(now.getTime() + durationMin * 60 * 1000)

      const { data: sess, error: sessErr } = await supabase
        .from('arena_sessions')
        .insert({
          station_id: stationId,
          point_project_id: bProjectId,
          company_id: bCompanyId || null,
          tariff_id: tariffId,
          started_at: now.toISOString(),
          ends_at: endsAt.toISOString(),
          amount: Number(tariff.price),
          status: 'active',
          payment_method: 'cash',
          cash_amount: Number(tariff.price),
          kaspi_amount: 0,
          discount_percent: 0,
        })
        .select('id')
        .single()
      if (sessErr) throw sessErr

      void broadcastKioskCommand(stationId, {
        type: 'start_session',
        durationSec: durationMin * 60,
        tariffName: String(tariff.name || 'Тариф'),
      })

      return json({ ok: true, sessionId: sess.id, endsAt: endsAt.toISOString() })
    }

    // ── Admin quick session end ────────────────────────────────────────────────
    if (body.action === 'adminEndSession') {
      const { stationId } = body as { stationId: string }
      if (!stationId) return json({ error: 'stationId required' }, 400)

      const now = new Date().toISOString()
      const { data: sess } = await supabase
        .from('arena_sessions')
        .select('id')
        .eq('station_id', stationId)
        .eq('status', 'active')
        .maybeSingle()
      if (!sess) return json({ error: 'no-active-session' }, 404)

      await supabase
        .from('arena_sessions')
        .update({ status: 'completed', ended_at: now })
        .eq('id', sess.id)

      void broadcastKioskCommand(stationId, { type: 'end_session' })

      return json({ ok: true })
    }

    // ─── PROJECT PROVISIONING KEY ────────────────────────────────────
    if (body.action === 'rotateProjectProvisioningKey') {
      const { projectId } = body
      if (!projectId) return json({ error: 'projectId required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      const newKey = randomBytes(12).toString('hex').toUpperCase()
      const { error } = await supabase
        .from('point_projects')
        .update({ arena_provisioning_key: newKey })
        .eq('id', projectId)
      if (error) throw error
      return json({ ok: true, provisioningKey: newKey })
    }

    // ─── PROJECT BRANDING ────────────────────────────────────────────
    if (body.action === 'updateProjectBranding') {
      const { projectId, arena_logo_url, arena_cover_url, arena_accent, arena_description } = body
      if (!projectId) return json({ error: 'projectId required' }, 400)
      await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)
      const update: Record<string, string | null> = {}
      if (arena_logo_url !== undefined) update.arena_logo_url = arena_logo_url ? String(arena_logo_url).trim() : null
      if (arena_cover_url !== undefined) update.arena_cover_url = arena_cover_url ? String(arena_cover_url).trim() : null
      if (arena_accent !== undefined) update.arena_accent = arena_accent ? String(arena_accent).trim() : null
      if (arena_description !== undefined) update.arena_description = arena_description ? String(arena_description).trim() : null
      const { error } = await supabase.from('point_projects').update(update).eq('id', projectId)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/arena:post', message: error?.message || 'Arena POST error' })
    if (error?.message === 'invalid-device-ip') {
      return json({ error: 'invalid-device-ip' }, 400)
    }
    if (error?.message === 'invalid-device-mac') {
      return json({ error: 'invalid-device-mac' }, 400)
    }
    if (error?.code === '23505') {
      const details = String(error?.details || '')
      if (details.includes('device_mac')) return json({ error: 'device-mac-already-bound' }, 409)
      if (details.includes('device_ip')) return json({ error: 'device-ip-already-bound' }, 409)
      return json({ error: 'station-device-binding-conflict' }, 409)
    }
    return json({ error: error?.message || 'Ошибка операции' }, 500)
  }
}
