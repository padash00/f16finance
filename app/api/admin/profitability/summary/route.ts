import { NextResponse } from 'next/server'

import { computeMonthlyPnl, type MonthlyPnl } from '@/lib/domain/profitability'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { buildDailyKaspiSeriesFromRows } from '@/lib/server/services/daily-kaspi'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Готовый ОПиУ по месяцам.
 *
 * Роут `/api/admin/profitability` отдаёт только ручные вводы владельца —
 * саму прибыль страница `/profitability` считает у себя, смешивая их с
 * журналами доходов и расходов. Мобильному приложению пришлось бы повторить
 * эту формулу на Swift, и две реализации одной EBITDA неизбежно разошлись бы.
 *
 * Здесь расчёт выполняется на сервере общей функцией `computeMonthlyPnl`,
 * и клиент получает готовые величины.
 *
 *   GET /api/admin/profitability/summary?from=2026-01&to=2026-08
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** `YYYY-MM`; всё остальное отбрасываем. */
function normalizeMonth(raw: string | null): string | null {
  const value = (raw || '').trim()
  return /^\d{4}-\d{2}$/.test(value) ? value : null
}

/** Сутки назад — ночная смена частью выручки уходит за полночь. */
function prevDayISO(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** Последний день месяца — границы запроса к журналам. */
function monthEnd(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  return `${month}-${String(days).padStart(2, '0')}`
}

/** Перечень месяцев от `from` до `to` включительно. */
function monthsBetween(from: string, to: string): string[] {
  const result: string[] = []
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)

  let year = fromYear
  let month = fromMonth
  // Ограничение на 120 месяцев — защита от опечатки в годе, которая иначе
  // раскрутила бы цикл на тысячи итераций.
  for (let guard = 0; guard < 120; guard += 1) {
    if (year > toYear || (year === toYear && month > toMonth)) break
    result.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return result
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'profitability.view')
    if (denied) return denied

    const url = new URL(req.url)
    const from = normalizeMonth(url.searchParams.get('from'))
    const to = normalizeMonth(url.searchParams.get('to'))
    if (!from || !to) {
      return json({ error: 'from и to в формате YYYY-MM' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const months = monthsBetween(from, to)
    if (months.length === 0) {
      return json({ ok: true, data: { months: [] } })
    }
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: { months: [] } })
    }

    const dateFrom = `${from}-01`
    const dateTo = monthEnd(to)
    const orgId = access.activeOrganization?.id || null

    // NEVER-pattern: ниже фильтры по организации навешивались условно (`if (orgId)`),
    // и у пользователя без активной организации они исчезали — маршрут читал бы
    // ручные вводы и справочники всех тенантов.
    if (!access.isSuperAdmin && !orgId) {
      return json({ ok: true, data: { months: [] } })
    }
    // Для .eq() у не-супер-админа подставляем нулевой uuid, чтобы фильтр
    // существовал всегда (fail-closed), даже если орг внезапно пуста.
    const orgFilterId = orgId || '00000000-0000-0000-0000-000000000000'

    // Сутки до начала периода: ночная смена начинается вечером и часть выручки
    // проводит уже после полуночи. Без предыдущего дня первый день периода
    // считался бы по обрубленной смене.
    const previousDate = prevDayISO(dateFrom)

    // PostgREST отдаёт максимум 1000 строк за запрос. Без постраничной
    // выборки период в несколько месяцев обрезался молча: сумма считалась по
    // первой тысяче записей, и месяцы с конца периода приходили заниженными
    // или пустыми. Сайт страницу за страницей догружает всё — оттого его
    // цифры и расходились с приложением.
    const PAGE = 1000

    const fetchAllPages = async (
      table: 'incomes' | 'expenses',
      columns: string,
    ): Promise<any[]> => {
      const out: any[] = []
      for (let offset = 0; ; offset += PAGE) {
        let query = supabase
          .from(table)
          .select(columns)
          .gte('date', table === 'incomes' ? previousDate : dateFrom)
          .lte('date', dateTo)
          .order('date', { ascending: true })
          .range(offset, offset + PAGE - 1)
        if (companyScope.allowedCompanyIds !== null) {
          query = query.in('company_id', companyScope.allowedCompanyIds)
        }
        const { data, error } = await query
        if (error) throw error
        const rows = (data || []) as any[]
        out.push(...rows)
        if (rows.length < PAGE) break
      }
      return out
    }

    // Ручные вводы принадлежат организации: без фильтра суперадмин увидел бы
    // смесь строк разных клиентов за один месяц.
    //
    // Границы — датами, а не `YYYY-MM`: колонка `month` типа `date`, и Postgres
    // на `month >= '2026-01'` отвечает `invalid input syntax for type date`.
    // Весь роут падал в 500, то есть ОПиУ в приложении не открывался вообще.
    let inputsQuery = supabase
      .from('monthly_profitability_inputs')
      .select('*')
      .gte('month', `${from}-01`)
      .lte('month', `${to}-01`)
    if (!access.isSuperAdmin) inputsQuery = inputsQuery.eq('organization_id', orgFilterId)
    else if (orgId) inputsQuery = inputsQuery.eq('organization_id', orgId)

    // Справочник категорий — только своей орг: чужая категория с таким же именем
    // перетирала accounting_group и искажала EBITDA / чистую прибыль.
    let categoriesQuery = supabase.from('expense_categories').select('name, accounting_group')
    if (!access.isSuperAdmin) categoriesQuery = categoriesQuery.eq('organization_id', orgFilterId)
    else if (orgId) categoriesQuery = categoriesQuery.eq('organization_id', orgId)

    // Устройства и проекты точек читались по всем тенантам, а их company_id
    // попадали в splitCompanyIds и влияли на расчёт дневного Kaspi.
    let devicesQuery = supabase.from('point_devices').select('company_id, feature_flags').eq('is_active', true)
    if (companyScope.allowedCompanyIds !== null) {
      devicesQuery = devicesQuery.in('company_id', companyScope.allowedCompanyIds)
    }

    const [incomeRows, expenseRows, inputsRes, categoriesRes, devicesRes, projectsRes] = await Promise.all([
      fetchAllPages(
        'incomes',
        'date, company_id, shift, cash_amount, kaspi_amount, kaspi_before_midnight, card_amount, online_amount',
      ),
      fetchAllPages('expenses', 'date, company_id, category, cash_amount, kaspi_amount'),
      inputsQuery,
      categoriesQuery,
      devicesQuery,
      supabase
        .from('point_projects')
        .select('point_project_companies(company_id, feature_flags)')
        .eq('is_active', true),
    ])

    if (inputsRes.error) throw inputsRes.error

    const categoryGroups: Record<string, string | null> = {}
    for (const row of (categoriesRes.data || []) as any[]) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }

    // Ключ — `YYYY-MM`: в базе `month` хранится датой `2026-01-01`, а месяцы
    // периода перечислены как `2026-01`. Без среза ручные вводы не находились
    // бы никогда, и ФОТ с налогами молча выпадали из ОПиУ.
    const inputsByMonth = new Map<string, any>()
    for (const row of (inputsRes.data || []) as any[]) {
      inputsByMonth.set(String(row.month).slice(0, 7), row)
    }

    // Дневной Kaspi. На точках с посменным разделением выручка ночной смены
    // приходит одной строкой на две календарные даты, и в журнале она лежит
    // на дате смены. Сайт раскладывает её по дням и берёт в ОПиУ уже
    // исправленную сумму — приложение считало по сырой, отсюда и расхождение
    // именно в отдельных месяцах.
    const splitCompanyIds = new Set<string>()
    for (const row of (devicesRes.data || []) as any[]) {
      if (row?.company_id && row?.feature_flags?.kaspi_daily_split === true) {
        splitCompanyIds.add(String(row.company_id))
      }
    }
    for (const project of (projectsRes.data || []) as any[]) {
      const links = Array.isArray(project?.point_project_companies) ? project.point_project_companies : []
      for (const link of links) {
        const flags = link?.feature_flags
        const on =
          flags && typeof flags === 'object' && !Array.isArray(flags) &&
          (flags as Record<string, unknown>).kaspi_daily_split === true
        if (on && link?.company_id) splitCompanyIds.add(String(link.company_id))
      }
    }

    // point_projects нельзя отфильтровать запросом (у проекта нет company_id),
    // поэтому отсекаем чужие точки постфильтром по скоупу.
    if (companyScope.allowedCompanyIds !== null) {
      const allowed = new Set(companyScope.allowedCompanyIds.map((id) => String(id)))
      for (const id of Array.from(splitCompanyIds)) {
        if (!allowed.has(id)) splitCompanyIds.delete(id)
      }
    }

    const correctedKaspiByMonth = new Map<string, number>()
    if (splitCompanyIds.size > 0) {
      const splitRows = incomeRows
        .filter((row) => splitCompanyIds.has(String(row.company_id || '')))
        .map((row) => ({
          id: `${row.company_id}:${row.date}:${row.shift}`,
          date: String(row.date),
          shift: (row.shift === 'night' ? 'night' : 'day') as 'day' | 'night',
          kaspi_amount: Number(row.kaspi_amount || 0),
          kaspi_before_midnight: row.kaspi_before_midnight == null ? null : Number(row.kaspi_before_midnight || 0),
        }))

      const daily = buildDailyKaspiSeriesFromRows({ dateFrom, dateTo, rows: splitRows })
      for (const day of daily) {
        const month = String(day.date || '').slice(0, 7)
        if (!month) continue
        correctedKaspiByMonth.set(month, Number(correctedKaspiByMonth.get(month) || 0) + Number(day.total || 0))
      }
    }

    // Доходы сворачиваем по месяцам заранее: иначе каждый месяц перебирал бы
    // весь массив, а за год это заметно.
    //
    // День до периода в свёртку не берём: он нужен только дневному Kaspi,
    // чтобы дотянуть ночную смену, а в выручку месяца не входит.
    const incomeByMonth = new Map<string, { cash: number; kaspi: number; card: number; online: number }>()
    const rawSplitKaspiByMonth = new Map<string, number>()
    for (const row of incomeRows) {
      const date = String(row.date || '')
      if (date < dateFrom) continue
      const month = date.slice(0, 7)
      if (!month) continue
      const current = incomeByMonth.get(month) || { cash: 0, kaspi: 0, card: 0, online: 0 }
      current.cash += Number(row.cash_amount || 0)
      current.kaspi += Number(row.kaspi_amount || 0)
      current.card += Number(row.card_amount || 0)
      current.online += Number(row.online_amount || 0)
      incomeByMonth.set(month, current)

      if (splitCompanyIds.has(String(row.company_id || ''))) {
        rawSplitKaspiByMonth.set(month, Number(rawSplitKaspiByMonth.get(month) || 0) + Number(row.kaspi_amount || 0))
      }
    }

    // Заменяем сырой Kaspi исправленным только у точек с разделением: у
    // остальных обе величины совпадают, и подмена ничего не изменила бы.
    for (const [month, corrected] of correctedKaspiByMonth) {
      const current = incomeByMonth.get(month)
      if (!current) continue
      current.kaspi = current.kaspi - Number(rawSplitKaspiByMonth.get(month) || 0) + corrected
    }

    const expenses = expenseRows

    const rows: MonthlyPnl[] = months.map((month) =>
      computeMonthlyPnl(
        month,
        incomeByMonth.get(month) || { cash: 0, kaspi: 0, card: 0, online: 0 },
        expenses,
        inputsByMonth.get(month) || null,
        categoryGroups,
      ),
    )

    return json({ ok: true, data: { months: rows } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/profitability/summary GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось посчитать ОПиУ' }, 500)
  }
}
