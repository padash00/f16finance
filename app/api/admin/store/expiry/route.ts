import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

// Партии с указанным сроком годности — для вкладки «Срок годности».
// Источник — строки приёмки/оприходования (inventory_receipt_items.expiry_date).
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store.view')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowed = companyScope.allowedCompanyIds === null ? null : new Set(companyScope.allowedCompanyIds.map(String))

    // Лимит 1000 применяется ДО фильтра по арендатору: без серверного скоупа партии
    // чужих (крупных) организаций вытесняют строки текущей — свои сроки молча
    // пропадают. Для скоупнутого пользователя фильтруем по company_id в самом
    // запросе через !inner-join (пустой список компаний → 0 строк, NEVER-pattern).
    const itemCols = 'id, quantity, production_date, expiry_date, item:item_id(id, name, barcode, unit)'
    const receiptEmbed = (inner: boolean) =>
      `receipt:receipt_id${inner ? '!inner' : ''}(id, received_at, status, kind, location:location_id${inner ? '!inner' : ''}(id, name, location_type, company_id, organization_id, company:company_id(name)))`
    let expiryQuery = supabase
      .from('inventory_receipt_items')
      .select(`${itemCols}, ${receiptEmbed(allowed !== null)}`)
      .not('expiry_date', 'is', null)
    if (allowed !== null) {
      expiryQuery = expiryQuery.in('receipt.location.company_id', companyScope.allowedCompanyIds || [])
    }
    const { data, error } = await expiryQuery.order('expiry_date', { ascending: true }).limit(1000)
    if (error) throw error

    // Almaty (UTC+5) — дата без времени
    const todayStr = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
    const today = new Date(todayStr + 'T00:00:00Z').getTime()

    const rows = ((data as any[]) || [])
      .map((r) => {
        const receipt = Array.isArray(r.receipt) ? r.receipt[0] : r.receipt
        const loc = receipt ? (Array.isArray(receipt.location) ? receipt.location[0] : receipt.location) : null
        const item = Array.isArray(r.item) ? r.item[0] : r.item
        const company = loc ? (Array.isArray(loc.company) ? loc.company[0] : loc.company) : null
        return { r, receipt, loc, item, company }
      })
      .filter(({ receipt, loc }) => {
        if (!receipt || receipt.status === 'cancelled') return false
        if (allowed === null) return true
        return loc?.company_id ? allowed.has(String(loc.company_id)) : false
      })
      .map(({ r, receipt, loc, item, company }) => {
        const exp = new Date(String(r.expiry_date) + 'T00:00:00Z').getTime()
        const daysLeft = Math.round((exp - today) / 86400000)
        const status = daysLeft < 0 ? 'expired' : daysLeft <= 14 ? 'soon' : 'ok'
        return {
          id: String(r.id),
          item_name: item?.name || 'Товар',
          barcode: item?.barcode || null,
          unit: item?.unit || null,
          quantity: Number(r.quantity || 0),
          production_date: r.production_date || null,
          expiry_date: r.expiry_date,
          days_left: daysLeft,
          status,
          received_at: receipt?.received_at || null,
          kind: receipt?.kind || 'supplier',
          location_name: loc ? `${company?.name ? company.name + ' · ' : ''}${loc.location_type === 'point_display' ? 'Витрина' : loc.location_type === 'warehouse' ? 'Склад' : loc.name}` : '—',
        }
      })

    const summary = {
      expired: rows.filter((r) => r.status === 'expired').length,
      soon: rows.filter((r) => r.status === 'soon').length,
      total: rows.length,
    }

    return json({ ok: true, data: { rows, summary } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить сроки годности' }, 500)
  }
}
