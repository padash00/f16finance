import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { listOrganizationCompanyIds, listOrganizationOperatorIds, resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { hasCapability } from '@/lib/server/capabilities'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function chunk<T>(items: T[], size = 50): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

type NotificationItem = {
  id: string
  title: string
  subtitle?: string | null
  href?: string | null
  date?: string | null
}

type NotificationGroup = {
  id: string
  label: string
  icon: 'clipboard' | 'cake' | 'receipt' | 'alert'
  href: string
  count: number
  items: NotificationItem[]
}

function getDaysUntilBirthday(birthDate: string, now: Date): number | null {
  const [, month, day] = birthDate.split('-').map(Number)
  if (!month || !day) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(now.getFullYear(), month - 1, day)
  if (next < today) next = new Date(now.getFullYear() + 1, month - 1, day)
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedOperatorIds = await listOrganizationOperatorIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const groups: NotificationGroup[] = []

    // Фильтр групп по capabilities. Если у юзера нет доступа к странице —
    // не показываем уведомления связанные с ней (маркетолог не должен
    // видеть "Заявки на склад" — у него нет к ним доступа).
    const [canSeeRequests, canSeeBirthdays, canSeeDebts, canSeeShowcase] = await Promise.all([
      hasCapability(access, 'store-requests.view'),
      hasCapability(access, 'birthdays.view'),
      hasCapability(access, 'point-debts.view'),
      hasCapability(access, 'store-showcase.view'),
    ])

    // ── Pending inventory requests ──────────────────────────────────────────
    if (canSeeRequests) try {
      let requestsQuery = supabase
        .from('inventory_requests')
        .select('id, status, created_at, requesting_company_id, company:companies!requesting_company_id(name)')
        .in('status', ['new', 'disputed'])
        .order('created_at', { ascending: false })
        .limit(10)

      if (companyScope.allowedCompanyIds) {
        requestsQuery = requestsQuery.in('requesting_company_id', companyScope.allowedCompanyIds)
      }

      const { data: requestRows } = await requestsQuery
      if (requestRows && requestRows.length > 0) {
        const items: NotificationItem[] = requestRows.slice(0, 5).map((row: any) => {
          const company = Array.isArray(row.company) ? row.company[0] : row.company
          return {
            id: String(row.id),
            title: company?.name || 'Точка',
            subtitle: row.status === 'disputed' ? 'Спорная' : 'Новая заявка',
            href: '/store/requests',
            date: row.created_at || null,
          }
        })
        groups.push({
          id: 'requests',
          label: 'Заявки ждут решения',
          icon: 'clipboard',
          href: '/store/requests',
          count: requestRows.length,
          items,
        })
      }
    } catch (e) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/notifications.requests',
        message: (e as any)?.message || 'requests-section-failed',
      })
    }

    // ── Upcoming birthdays (7 days) ─────────────────────────────────────────
    if (canSeeBirthdays) try {
      let operatorsQuery = supabase
        .from('operators')
        .select('id, name, short_name, operator_profiles(full_name, birth_date)')
        .eq('is_active', true)

      if (allowedOperatorIds) operatorsQuery = operatorsQuery.in('id', allowedOperatorIds)

      const { data: operators } = await operatorsQuery

      const now = new Date()
      const birthdayItems: NotificationItem[] = []
      for (const row of operators || []) {
        const profile = Array.isArray((row as any).operator_profiles)
          ? (row as any).operator_profiles[0]
          : (row as any).operator_profiles
        const birthDate = profile?.birth_date
        if (!birthDate) continue
        const daysUntil = getDaysUntilBirthday(birthDate, now)
        if (daysUntil == null || daysUntil > 7) continue
        birthdayItems.push({
          id: String((row as any).id),
          title: profile?.full_name || (row as any).name,
          subtitle: daysUntil === 0 ? 'Сегодня!' : `Через ${daysUntil} дн.`,
          href: '/birthdays',
          date: birthDate,
        })
      }
      birthdayItems.sort((a, b) => {
        const da = getDaysUntilBirthday(a.date || '', now) ?? 999
        const db = getDaysUntilBirthday(b.date || '', now) ?? 999
        return da - db
      })
      if (birthdayItems.length > 0) {
        groups.push({
          id: 'birthdays',
          label: 'Дни рождения',
          icon: 'cake',
          href: '/birthdays',
          count: birthdayItems.length,
          items: birthdayItems.slice(0, 5),
        })
      }
    } catch (e) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/notifications.birthdays',
        message: (e as any)?.message || 'birthdays-section-failed',
      })
    }

    // ── Unpaid point debts ──────────────────────────────────────────────────
    if (canSeeDebts) try {
      let debtsQuery = supabase
        .from('debts')
        .select('id, amount, client_name, created_at, company_id, company:companies!company_id(name)')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(50)

      if (allowedCompanyIds) debtsQuery = debtsQuery.in('company_id', allowedCompanyIds)

      const { data: debts, error: debtsError } = await debtsQuery
      if (debtsError) throw debtsError
      if (debts && debts.length > 0) {
        const items: NotificationItem[] = debts.slice(0, 5).map((row: any) => {
          const company = Array.isArray(row.company) ? row.company[0] : row.company
          const debtor = (row.client_name || '').trim() || 'Должник'
          return {
            id: String(row.id),
            title: company?.name || 'Точка',
            subtitle: `${debtor} · ${Number(row.amount || 0).toLocaleString('ru-RU')} ₸`,
            href: '/point-debts',
            date: row.created_at || null,
          }
        })
        groups.push({
          id: 'debts',
          label: 'Долги с точки',
          icon: 'receipt',
          href: '/point-debts',
          count: debts.length,
          items,
        })
      }
    } catch (e) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/notifications.debts',
        message: (e as any)?.message || 'debts-section-failed',
      })
    }

    // ── Low stock alerts (showcase = catalog - warehouse; flag items at/below threshold) ──
    let lowStockStage = 'start'
    if (canSeeShowcase) try {
      const allowedCompanySet = allowedCompanyIds?.length ? new Set(allowedCompanyIds) : null

      // Showcase activated only for points that have an active point_display location.
      lowStockStage = 'enabled-point-display-locations'
      const { data: enabledPoints, error: enabledErr } = await supabase
        .from('inventory_locations')
        .select('company_id')
        .eq('location_type', 'point_display')
        .eq('is_active', true)
        .not('company_id', 'is', null)
      if (enabledErr) throw enabledErr
      const enabledCompanyIds = Array.from(
        new Set(
          (enabledPoints || [])
            .map((r: any) => String(r.company_id || ''))
            .filter((companyId) => companyId && (!allowedCompanySet || allowedCompanySet.has(companyId))),
        ),
      )

      if (enabledCompanyIds.length > 0) {
        const enabledCompanySet = new Set(enabledCompanyIds)

        lowStockStage = 'catalog-and-warehouse-locations'
        const { data: allLocations, error: locationsError } = await supabase
          .from('inventory_locations')
          .select('id, company_id, location_type')
          .in('location_type', ['warehouse', 'point_display'])
        if (locationsError) throw locationsError

        const locations = (allLocations || []).filter((row: any) =>
          enabledCompanySet.has(String(row.company_id || '')),
        )
        const locationIds = locations.map((row: any) => String(row.id)).filter(Boolean)
        const locationCompanyIds = Array.from(
          new Set(locations.map((row: any) => String(row.company_id || '')).filter(Boolean)),
        )

        const companyNameById = new Map<string, string>()
        if (locationCompanyIds.length > 0) {
          lowStockStage = 'company-names'
          const { data: companies, error: companiesError } = await supabase
            .from('companies')
            .select('id, name')
          if (companiesError) throw companiesError
          const locationCompanySet = new Set(locationCompanyIds)
          for (const company of companies || []) {
            const companyId = String((company as any).id || '')
            if (locationCompanySet.has(companyId)) {
              companyNameById.set(companyId, String((company as any).name || 'Точка'))
            }
          }
        }

        if (locationIds.length > 0) {
          lowStockStage = 'inventory-balances'
          const balanceRows: any[] = []
          for (const locationChunk of chunk(locationIds)) {
            const { data, error: balancesError } = await supabase
              .from('inventory_balances')
              .select('item_id, location_id, quantity')
              .in('location_id', locationChunk)
            if (balancesError) throw balancesError
            balanceRows.push(...(data || []))
          }

          const itemIds = Array.from(
            new Set(balanceRows.map((row: any) => String(row.item_id || '')).filter(Boolean)),
          )
          if (itemIds.length > 0) {
            lowStockStage = 'inventory-items'
            const { data: allItems, error: itemsError } = await supabase
              .from('inventory_items')
              .select('id, name, low_stock_threshold')
            if (itemsError) throw itemsError
            const itemIdSet = new Set(itemIds)
            const items = (allItems || []).filter((row: any) => itemIdSet.has(String(row.id || '')))

            const locationMap = new Map<string, any>(locations.map((row: any) => [String(row.id), row]))
            const itemMap = new Map<string, any>(items.map((row: any) => [String(row.id), row]))
            const grouped = new Map<
              string,
              {
                companyId: string
                companyName: string
                itemId: string
                itemName: string
                threshold: number
                catalogQty: number
                warehouseQty: number
                showcaseQty: number
              }
            >()

            for (const row of balanceRows || []) {
              const item = itemMap.get(String((row as any).item_id || ''))
              const location = locationMap.get(String((row as any).location_id || ''))
              if (!item?.name || !location?.company_id) continue

              const key = `${location.company_id}:${row.item_id}`
              const prev = grouped.get(key) || {
                companyId: String(location.company_id),
                companyName: companyNameById.get(String(location.company_id)) || 'Точка',
                itemId: String(row.item_id || ''),
                itemName: String(item.name),
                threshold: Number(item.low_stock_threshold || 0),
                catalogQty: 0,
                warehouseQty: 0,
                showcaseQty: 0,
              }

              const qty = Number((row as any).quantity || 0)
              if (location.location_type === 'warehouse') prev.warehouseQty += qty
              if (location.location_type === 'point_display') prev.showcaseQty += qty
              grouped.set(key, prev)
            }

            // v8: catalog = warehouse + showcase. Низкий остаток = витрина пустеет,
            // но товар где-то ещё есть (на складе) — иначе он просто отсутствует.
            const lowStock = Array.from(grouped.values())
              .map((entry) => ({ ...entry, catalogQty: entry.warehouseQty + entry.showcaseQty }))
              .filter((entry) => {
                // Считаем только товары, которые есть на точке (склад + витрина > 0)
                if (entry.catalogQty <= 0) return false
                // Если задан порог — флаг при showcase ≤ порог
                // Без порога — флаг только при showcase = 0 и при наличии товара на складе
                return entry.threshold > 0 ? entry.showcaseQty <= entry.threshold : entry.showcaseQty <= 0
              })

            if (lowStock.length > 0) {
              const items: NotificationItem[] = lowStock.slice(0, 5).map((entry) => ({
                id: `${entry.companyId}:${entry.itemId}`,
                title: entry.itemName,
                subtitle:
                  entry.threshold > 0
                    ? `${entry.companyName} · витрина ${entry.showcaseQty.toLocaleString('ru-RU')} ≤ мин ${entry.threshold.toLocaleString('ru-RU')}`
                    : `${entry.companyName} · витрина 0`,
                href: `/store/showcase?company_id=${entry.companyId}`,
                date: null,
              }))

              groups.push({
                id: 'low-stock',
                label: 'Низкие остатки',
                icon: 'alert',
                href: '/store/showcase',
                count: lowStock.length,
                items,
              })
            }
          }
        }
      }
    } catch (e) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/notifications.low-stock',
        message: (e as any)?.message || 'low-stock-section-failed',
        payload: {
          stage: lowStockStage,
          code: (e as any)?.code || null,
          details: (e as any)?.details || null,
          hint: (e as any)?.hint || null,
        },
      })
    }

    const total = groups.reduce((sum, g) => sum + g.count, 0)
    return json({ ok: true, data: { total, groups } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/notifications.GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось загрузить уведомления' }, 500)
  }
}
