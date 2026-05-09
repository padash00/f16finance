/**
 * Performance Ranking API.
 *
 * Возвращает рейтинг операторов с метрикой PI (Performance Index):
 *   PI = actual_revenue_per_shift / expected_revenue_for_slot
 *
 * Slot = (company_id, weekday, shift_type). Expected — медиана выручки по
 * этому слоту за прошлые 90 дней (до начала запрошенного периода).
 *
 * Подход опирается на Schedule Performance Index из проектного менеджмента и
 * адаптацию SPLH (Sales Per Labor Hour) к контексту слота. Подробнее —
 * lib/achievements.ts (общий каталог) и docs/performance.md.
 */
import { NextResponse } from 'next/server'

import { listOrganizationOperatorIds } from '@/lib/server/organizations'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

type IncomeRow = {
  date: string
  operator_id: string | null
  company_id: string | null
  shift: 'day' | 'night' | null
  cash_amount: number
  kaspi_amount: number
  card_amount: number
  online_amount: number
}

type Operator = {
  id: string
  name: string
  short_name: string | null
}

const MIN_BASELINE_OBSERVATIONS = 3 // если в слоте < 3 наблюдений — берём fallback
const MIN_QUALIFYING_SHIFTS = 3      // меньше — оператор в "Cold start"
const PI_CLIP_MIN = 0.5
const PI_CLIP_MAX = 2.0

function getRevenue(row: IncomeRow): number {
  return (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.card_amount || 0) + (row.online_amount || 0)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).getDay() // 0 = Sun, 6 = Sat
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'service_role_missing' }, 500)
    }
    const supabase = createAdminSupabaseClient()

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const companyId = url.searchParams.get('company_id')

    if (!from || !to) return json({ error: 'from and to are required' }, 400)

    // Baseline period — вся доступная история.
    // Верхняя граница: день перед началом target.
    // Нижняя граница: дата самого первого дохода в системе (с учётом фильтра по точке).
    // 180-дневное окно убрано: чтобы оценка по «понедельникам / пятницам / ночам» была
    // точной, нужно учитывать ВСЕ исторические смены, а не последнее «скользящее» окно.
    const baselineTo = addDaysISO(from, -1)

    let earliestIncomeDate: string | null = null
    {
      let earliestQuery = supabase
        .from('incomes')
        .select('date')
        .order('date', { ascending: true })
        .limit(1)
      if (companyId) earliestQuery = earliestQuery.eq('company_id', companyId)
      const { data: earliestRows, error: earliestErr } = await earliestQuery
      if (earliestErr) throw earliestErr
      earliestIncomeDate = earliestRows?.[0]?.date ?? null
    }

    // Если истории нет вообще — берём день перед target как формальную границу
    // (запрос всё равно вернёт пусто, fallback'и в getExpected отработают).
    const baselineFrom = earliestIncomeDate ?? baselineTo

    // ── 1. Operators (фильтрация по организации) ──────────────────────────
    const allowedOperatorIds = await listOrganizationOperatorIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let opsQuery = supabase
      .from('operators')
      .select('id, name, short_name')
      .order('name')
    if (allowedOperatorIds) {
      if (allowedOperatorIds.length === 0) return json({ data: { ranking: [], baseline: {}, period: { from, to } } })
      opsQuery = opsQuery.in('id', allowedOperatorIds)
    }
    const { data: operatorsData, error: opsErr } = await opsQuery
    if (opsErr) throw opsErr
    const operators = (operatorsData || []) as Operator[]
    const operatorMap = new Map(operators.map((o) => [o.id, o]))

    // ── 2. Загружаем incomes за объединённый период (baseline + period) ───
    let incomesQuery = supabase
      .from('incomes')
      .select('date, operator_id, company_id, shift, cash_amount, kaspi_amount, card_amount, online_amount')
      .gte('date', baselineFrom)
      .lte('date', to)
      .range(0, 49999)
    if (companyId) incomesQuery = incomesQuery.eq('company_id', companyId)

    const { data: incomesData, error: incomesErr } = await incomesQuery
    if (incomesErr) throw incomesErr
    const allIncomes = (incomesData || []) as IncomeRow[]

    // ── 3. Делим на baseline и target периоды ─────────────────────────────
    const baseline = allIncomes.filter((r) => r.date >= baselineFrom && r.date <= baselineTo)
    const target = allIncomes.filter((r) => r.date >= from && r.date <= to)

    // ── 4. Агрегируем по сменам (1 оператор = 1 смена) ───────────────────
    // Каждая запись baselineShifts: одна смена с указанием оператора.
    // operator_id нужен чтобы потом делать leave-one-out (исключать
    // собственные смены оператора при подсчёте его ожидания).
    const baselineByKey = new Map<string, { operator_id: string; revenue: number }>()
    for (const row of baseline) {
      if (!row.operator_id || !row.company_id) continue
      const key = `${row.operator_id}|${row.company_id}|${row.date}|${row.shift || 'day'}`
      const cur = baselineByKey.get(key) || { operator_id: row.operator_id, revenue: 0 }
      cur.revenue += getRevenue(row)
      baselineByKey.set(key, cur)
    }
    type BaseShift = { company: string; date: string; shift: string; operatorId: string; revenue: number }
    const baselineShifts: BaseShift[] = []
    for (const [key, cur] of baselineByKey) {
      if (cur.revenue <= 0) continue
      const parts = key.split('|') // operator|company|date|shift
      baselineShifts.push({
        operatorId: parts[0],
        company: parts[1],
        date: parts[2],
        shift: parts[3],
        revenue: cur.revenue,
      })
    }

    // Группируем по (company, weekday, shift) — но храним массив объектов с operator_id
    const baselineSlots = new Map<string, BaseShift[]>()
    for (const sh of baselineShifts) {
      const slotKey = `${sh.company}|${weekday(sh.date)}|${sh.shift}`
      const arr = baselineSlots.get(slotKey) || []
      arr.push(sh)
      baselineSlots.set(slotKey, arr)
    }

    // Fallback'и: company-shift / company / global. Тоже хранят BaseShift для leave-one-out.
    const companyShiftMap = new Map<string, BaseShift[]>()
    const companyMap = new Map<string, BaseShift[]>()
    const globalArr: BaseShift[] = []
    for (const sh of baselineShifts) {
      const ck = `${sh.company}|${sh.shift}`
      const cs = companyShiftMap.get(ck) || []
      cs.push(sh)
      companyShiftMap.set(ck, cs)
      const cm = companyMap.get(sh.company) || []
      cm.push(sh)
      companyMap.set(sh.company, cm)
      globalArr.push(sh)
    }
    const globalMedian = median(globalArr.map((s) => s.revenue))

    /**
     * Считаем ожидание для смены конкретного оператора с применением
     * leave-one-out: его собственные смены НЕ участвуют в медиане.
     * Это убирает self-influence (звезда сравнивает себя с собой).
     */
    function getExpected(
      company: string,
      date: string,
      shift: string,
      operatorId: string,
    ): { value: number; source: string } {
      const slotKey = `${company}|${weekday(date)}|${shift}`
      const slotShifts = baselineSlots.get(slotKey) || []
      const otherInSlot = slotShifts.filter((s) => s.operatorId !== operatorId)
      if (otherInSlot.length >= MIN_BASELINE_OBSERVATIONS) {
        return { value: median(otherInSlot.map((s) => s.revenue)), source: 'slot (LOO)' }
      }

      const csKey = `${company}|${shift}`
      const csShifts = (companyShiftMap.get(csKey) || []).filter((s) => s.operatorId !== operatorId)
      if (csShifts.length >= MIN_BASELINE_OBSERVATIONS) {
        return { value: median(csShifts.map((s) => s.revenue)), source: 'company-shift (LOO)' }
      }

      const cShifts = (companyMap.get(company) || []).filter((s) => s.operatorId !== operatorId)
      if (cShifts.length >= MIN_BASELINE_OBSERVATIONS) {
        return { value: median(cShifts.map((s) => s.revenue)), source: 'company (LOO)' }
      }

      // В крайнем случае — глобальная медиана без leave-one-out
      // (если у нас всего 1 оператор и у него все смены — fallback на глобальную)
      const globalLOO = globalArr.filter((s) => s.operatorId !== operatorId)
      if (globalLOO.length >= MIN_BASELINE_OBSERVATIONS) {
        return { value: median(globalLOO.map((s) => s.revenue)), source: 'global (LOO)' }
      }
      return { value: globalMedian, source: 'global' }
    }

    // ── 5. Агрегируем target по сменам и считаем PI ───────────────────────
    const targetByOpShift = new Map<string, IncomeRow[]>()
    for (const row of target) {
      if (!row.operator_id || !row.company_id) continue
      const key = `${row.operator_id}|${row.company_id}|${row.date}|${row.shift || 'day'}`
      const arr = targetByOpShift.get(key) || []
      arr.push(row)
      targetByOpShift.set(key, arr)
    }

    // Сводим в смены и считаем PI каждой
    type OperatorAgg = {
      operatorId: string
      shifts: number
      totalRevenue: number
      piSum: number
      piCount: number
      shiftDetails: Array<{ date: string; shift: string; company: string; actual: number; expected: number; pi: number; source: string }>
    }
    const byOp = new Map<string, OperatorAgg>()
    for (const [key, rows] of targetByOpShift) {
      const [operatorId, company, date, shift] = key.split('|')
      const actual = rows.reduce((s, r) => s + getRevenue(r), 0)
      if (actual <= 0) continue

      const exp = getExpected(company, date, shift, operatorId)
      const piRaw = exp.value > 0 ? actual / exp.value : 1.0
      const pi = Math.max(PI_CLIP_MIN, Math.min(PI_CLIP_MAX, piRaw))

      const op = byOp.get(operatorId) || {
        operatorId,
        shifts: 0,
        totalRevenue: 0,
        piSum: 0,
        piCount: 0,
        shiftDetails: [],
      }
      op.shifts += 1
      op.totalRevenue += actual
      op.piSum += pi
      op.piCount += 1
      op.shiftDetails.push({ date, shift, company, actual, expected: exp.value, pi, source: exp.source })
      byOp.set(operatorId, op)
    }

    // ── 6. Финальный рейтинг ───────────────────────────────────────────────
    type RankingItem = {
      operator_id: string
      operator_name: string
      operator_short_name: string | null
      shifts: number
      total_revenue: number
      avg_revenue_per_shift: number
      pi: number
      qualifying: boolean
      shift_details: Array<{ date: string; shift: string; company_id: string; actual: number; expected: number; pi: number; source: string }>
    }
    const ranking: RankingItem[] = []
    for (const op of byOp.values()) {
      const operator = operatorMap.get(op.operatorId)
      const pi = op.piCount > 0 ? op.piSum / op.piCount : 1.0
      ranking.push({
        operator_id: op.operatorId,
        operator_name: operator?.name || 'Неизвестный',
        operator_short_name: operator?.short_name || null,
        shifts: op.shifts,
        total_revenue: op.totalRevenue,
        avg_revenue_per_shift: op.shifts > 0 ? op.totalRevenue / op.shifts : 0,
        pi: Number(pi.toFixed(3)),
        qualifying: op.shifts >= MIN_QUALIFYING_SHIFTS,
        shift_details: op.shiftDetails.map((d) => ({
          date: d.date,
          shift: d.shift,
          company_id: d.company,
          actual: d.actual,
          expected: d.expected,
          pi: Number(d.pi.toFixed(3)),
          source: d.source,
        })),
      })
    }

    // Сортировка: сначала qualifying (по PI desc), потом cold-start (по выручке desc)
    ranking.sort((a, b) => {
      if (a.qualifying !== b.qualifying) return a.qualifying ? -1 : 1
      if (a.qualifying) return b.pi - a.pi
      return b.total_revenue - a.total_revenue
    })

    return json({
      data: {
        ranking,
        baseline: {
          from: baselineFrom,
          to: baselineTo,
          shifts_count: baselineShifts.length,
          slots_count: baselineSlots.size,
          global_median: Math.round(globalMedian),
        },
        period: { from, to },
        config: {
          baseline_days_actual: Math.max(0, Math.round((Date.parse(baselineTo) - Date.parse(baselineFrom)) / 86400000) + 1),
          baseline_earliest_income_date: earliestIncomeDate,
          min_baseline_observations: MIN_BASELINE_OBSERVATIONS,
          min_qualifying_shifts: MIN_QUALIFYING_SHIFTS,
          pi_clip: [PI_CLIP_MIN, PI_CLIP_MAX],
        },
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/performance/ranking GET',
      message: error?.message || 'ranking failed',
    })
    console.error('[performance/ranking]', error)
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
