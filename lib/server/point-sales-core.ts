import 'server-only'

/**
 * Общее ядро логики продаж точки (POS).
 *
 * Единая правда для двух транспортов:
 *  - `/api/point/*`     — операторская Electron-программа по device-токену;
 *  - `/api/operator/*`  — веб-касса оператора по Supabase-сессии (`requireOperator`).
 *
 * Обе кассы пишут в одни таблицы (`point_sales`/`point_shifts`) и используют
 * эти же функции — деньги/остатки/лояльность считаются одинаково независимо от
 * того, откуда пришла продажа (десктоп или веб).
 */

// PostgREST молча режет ответ до 1000 строк — каталог, остатки витрины и строки
// смены забираем постранично, иначе касса не видит товары после 1000-го и
// сводка смены (деньги) считается по обрезанным данным.
export const PAGE = 1000

export async function fetchAllPages(
  buildQuery: (from: number, to: number) => any,
): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

export function canUseInventorySales(pointMode: string | null | undefined) {
  const normalized = String(pointMode || '').trim().toLowerCase()
  return new Set(['cash-desk', 'universal', 'debts']).has(normalized)
}

export function normalizeMoney(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

export function normalizeQty(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

export function normalizePoints(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.max(0, Math.floor(amount))
}

export function roundLineTotal(quantity: number, unitPrice: number) {
  return normalizeMoney(quantity * unitPrice)
}

export function buildAuthoritativeSaleLines(params: {
  requestedItems: Array<{
    item_id?: string | null
    universal_name?: string | null
    quantity: number
    unit_price?: number
    comment?: string | null
  }>
  dbItems: Array<{ id: string; name: string; sale_price: number; is_active: boolean; item_type?: string | null }>
  showcaseBalances: Map<string, number>
  paymentTotal: number
}) {
  const itemMap = new Map(params.dbItems.map((row) => [row.id, row]))

  const baseLines = params.requestedItems.map((item) => {
    // Универсальный товар: цена и название от оператора, без проверки остатков
    if (!item.item_id && item.universal_name) {
      const unitPrice = normalizeMoney(item.unit_price || 0)
      if (unitPrice <= 0) {
        throw new Error(`Универсальный товар «${item.universal_name}» — цена должна быть больше 0`)
      }
      return {
        item_id: null as string | null,
        universal_name: item.universal_name.trim(),
        quantity: item.quantity,
        base_unit_price: unitPrice,
        base_total: roundLineTotal(item.quantity, unitPrice),
        comment: item.comment?.trim() || null,
      }
    }

    if (!item.item_id) {
      throw new Error('Не указан ни item_id, ни universal_name')
    }

    const dbItem = itemMap.get(item.item_id)
    if (!dbItem || !dbItem.is_active) {
      throw new Error(`Товар недоступен для продажи: ${item.item_id}`)
    }
    if (String(dbItem.item_type || 'product') === 'consumable') {
      throw new Error(`Расходник нельзя продать через кассу: ${dbItem.name}`)
    }

    const available = Number(params.showcaseBalances.get(item.item_id) || 0)
    if (item.quantity > available + 0.0001) {
      throw new Error(`Недостаточно остатка на витрине для товара «${dbItem.name}» (доступно: ${available})`)
    }

    const unitPrice = normalizeMoney(dbItem.sale_price)
    return {
      item_id: item.item_id,
      universal_name: null as string | null,
      quantity: item.quantity,
      base_unit_price: unitPrice,
      base_total: roundLineTotal(item.quantity, unitPrice),
      comment: item.comment?.trim() || null,
    }
  })

  const subtotal = normalizeMoney(baseLines.reduce((sum, line) => sum + line.base_total, 0))
  if (subtotal <= 0) throw new Error('Сумма продажи должна быть больше нуля')
  if (params.paymentTotal - subtotal > 0.01) {
    throw new Error('Сумма оплаты не может быть больше суммы товаров')
  }

  if (Math.abs(subtotal - params.paymentTotal) <= 0.01) {
    return baseLines.map((line) => ({
      item_id: line.item_id,
      universal_name: line.universal_name,
      quantity: line.quantity,
      unit_price: line.base_unit_price,
      comment: line.comment,
    }))
  }

  const lines = baseLines.map((line) => ({
    item_id: line.item_id,
    universal_name: line.universal_name,
    quantity: line.quantity,
    unit_price: line.base_unit_price,
    comment: line.comment,
  }))

  const subtotalWithoutLast = normalizeMoney(
    baseLines.slice(0, -1).reduce((sum, line) => sum + line.base_total, 0),
  )

  let runningTotal = 0
  for (let index = 0; index < lines.length; index += 1) {
    const isLast = index === lines.length - 1
    const baseLine = baseLines[index]
    if (!baseLine) continue

    if (isLast) {
      const remainder = normalizeMoney(params.paymentTotal - runningTotal)
      lines[index].unit_price = normalizeMoney(remainder / baseLine.quantity)
    } else {
      const targetLineTotal =
        subtotalWithoutLast <= 0
          ? 0
          : normalizeMoney((baseLine.base_total / subtotal) * params.paymentTotal)
      lines[index].unit_price = normalizeMoney(targetLineTotal / baseLine.quantity)
      runningTotal = normalizeMoney(runningTotal + roundLineTotal(baseLine.quantity, lines[index].unit_price))
    }
  }

  let computedTotal = normalizeMoney(
    lines.reduce((sum, line) => sum + roundLineTotal(line.quantity, line.unit_price), 0),
  )

  if (Math.abs(computedTotal - params.paymentTotal) > 0.01) {
    const lastIndex = lines.length - 1
    const basePrice = lines[lastIndex].unit_price
    let matched = false
    for (let offset = -200; offset <= 200; offset += 1) {
      const candidatePrice = normalizeMoney(basePrice + offset / 100)
      if (candidatePrice < 0) continue
      const candidateLines = [...lines]
      candidateLines[lastIndex] = { ...candidateLines[lastIndex], unit_price: candidatePrice }
      const candidateTotal = normalizeMoney(
        candidateLines.reduce((sum, line) => sum + roundLineTotal(line.quantity, line.unit_price), 0),
      )
      if (Math.abs(candidateTotal - params.paymentTotal) <= 0.01) {
        lines[lastIndex] = { ...lines[lastIndex], unit_price: candidatePrice }
        computedTotal = candidateTotal
        matched = true
        break
      }
    }
    if (!matched) {
      throw new Error('Не удалось согласовать сумму продажи со скидкой')
    }
  }

  return lines
}

export async function resolvePointSaleLocation(supabase: any, companyId: string) {
  // Витрину ищем БЕЗ фильтра по активности — и вот почему.
  //
  // Уникальный индекс не разрешает второй `point_display` у точки, независимо
  // от того, включён он или выключен. А поиск шёл только по включённым: если
  // витрину когда-то отключили, она не находилась, код шёл создавать новую и
  // упирался в индекс. Экран продаж у оператора падал целиком — тридцать три
  // раза за две недели, и понять по ошибке «duplicate key» было невозможно.
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, name, code, location_type, is_active')
    .eq('company_id', companyId)
    .eq('location_type', 'point_display')
    .limit(1)
    .maybeSingle()

  if (error) throw error

  if (data?.id) {
    if (data.is_active !== false) return data

    // Выключенная витрина — единственная возможная у точки. Раз с неё просят
    // продавать, включаем: другой всё равно не будет, а отказ означал бы
    // «касса не работает» без объяснения.
    const { data: revived } = await supabase
      .from('inventory_locations')
      .update({ is_active: true })
      .eq('id', data.id)
      .select('id, name, code, location_type')
      .maybeSingle()
    return revived || { id: data.id, name: data.name, code: data.code, location_type: data.location_type }
  }

  // Авто-создание витрины если её нет (новая точка после v8 модели)
  const { data: company } = await supabase
    .from('companies')
    .select('id, name, code, organization_id')
    .eq('id', companyId)
    .maybeSingle()
  if (!company?.id) throw new Error('inventory-sale-location-not-found')

  const { data: created, error: createErr } = await supabase
    .from('inventory_locations')
    .insert({
      company_id: company.id,
      organization_id: (company as any).organization_id || null,
      name: `Витрина — ${(company as any).name || 'точка'}`,
      code: (company as any).code ? `PD-${(company as any).code}` : null,
      location_type: 'point_display',
      is_active: true,
    })
    .select('id, name, code, location_type')
    .single()
  if (createErr) {
    // Кто-то создал параллельно. Читаем снова — снова без фильтра по
    // активности, иначе вернёмся к той же ошибке.
    const { data: retry } = await supabase
      .from('inventory_locations')
      .select('id, name, code, location_type')
      .eq('company_id', companyId)
      .eq('location_type', 'point_display')
      .limit(1)
      .maybeSingle()
    if (retry?.id) return retry
    throw createErr
  }
  return created
}

export async function resolveStockLocations(supabase: any, companyId: string) {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, location_type')
    .eq('company_id', companyId)
    .in('location_type', ['warehouse', 'point_display'])
    .eq('is_active', true)

  if (error) throw error
  const warehouseId = (data || []).find((row: any) => row.location_type === 'warehouse')?.id || null
  let showcaseId = (data || []).find((row: any) => row.location_type === 'point_display')?.id || null

  // Если витрины нет — создаём (auto-bootstrap для новых точек после v8 модели)
  if (!showcaseId) {
    const loc = await resolvePointSaleLocation(supabase, companyId)
    showcaseId = loc.id
  }

  return { catalogId: null as string | null, warehouseId, showcaseId }
}

export async function fetchShowcaseBalances(params: {
  supabase: any
  catalogId: string | null
  warehouseId: string | null
  showcaseId: string | null
  itemIds?: string[] | null
}) {
  // v2: читаем напрямую из point_display, без формулы.
  if (params.showcaseId) {
    const data = await fetchAllPages((from, to) => {
      const q = params.supabase
        .from('inventory_balances')
        .select('item_id, quantity')
        .eq('location_id', params.showcaseId)
        .order('item_id')
        .range(from, to)
      if (params.itemIds?.length) q.in('item_id', params.itemIds)
      return q
    })
    const map = new Map<string, number>(
      (data || []).map((row: any) => [row.item_id, Number(row.quantity || 0)]),
    )
    return map
  }

  // v8: если point_display не настроен — пустая витрина.
  return new Map<string, number>()
}

export async function resolveCustomerSaleContext(params: {
  supabase: any
  companyId: string
  customerId: string | null
  loyaltyPointsSpent: number
}) {
  if (!params.customerId) {
    if (params.loyaltyPointsSpent > 0) {
      throw new Error('Для списания бонусов нужно выбрать клиента')
    }
    return { customer: null, loyaltyConfig: null }
  }

  const [{ data: customer, error: customerError }, { data: loyaltyConfig, error: configError }] = await Promise.all([
    params.supabase
      .from('customers')
      .select('id, name, loyalty_points, total_spent, visits_count')
      .eq('id', params.customerId)
      .eq('company_id', params.companyId)
      .maybeSingle(),
    params.supabase
      .from('loyalty_config')
      .select('*')
      .eq('company_id', params.companyId)
      .maybeSingle(),
  ])

  if (customerError) throw customerError
  if (configError) throw configError
  if (!customer) throw new Error('customer-not-found')
  if (params.loyaltyPointsSpent > 0 && !loyaltyConfig?.is_active) {
    throw new Error('loyalty-not-active')
  }
  if (params.loyaltyPointsSpent > Number(customer.loyalty_points || 0)) {
    throw new Error('Недостаточно бонусных баллов у клиента')
  }

  return { customer, loyaltyConfig }
}

export async function applyCustomerSaleEffects(params: {
  supabase: any
  saleId: string
  companyId: string
  customer: { id: string; loyalty_points: number; total_spent: number; visits_count: number } | null
  loyaltyConfig: any
  loyaltyPointsSpent: number
  totalAmount: number
  discountAmount: number
  loyaltyDiscountAmount: number
}) {
  if (!params.customer) return { pointsEarned: 0, pointsSpent: 0, customerId: null as string | null }

  const pointsPerHundred = params.loyaltyConfig?.is_active ? Number(params.loyaltyConfig?.points_per_100_tenge || 1) : 0
  const pointsSpent = normalizePoints(params.loyaltyPointsSpent)
  const pointsEarned = Math.max(0, Math.floor((params.totalAmount / 100) * pointsPerHundred))
  const newPoints = Math.max(0, Number(params.customer.loyalty_points || 0) + pointsEarned - pointsSpent)
  const newTotalSpent = normalizeMoney(Number(params.customer.total_spent || 0) + params.totalAmount)
  const newVisits = Number(params.customer.visits_count || 0) + 1

  const { error: updateCustomerError } = await params.supabase
    .from('customers')
    .update({
      loyalty_points: newPoints,
      total_spent: newTotalSpent,
      visits_count: newVisits,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.customer.id)
    .eq('company_id', params.companyId)

  if (updateCustomerError) throw updateCustomerError

  const { error: updateSaleError } = await params.supabase
    .from('point_sales')
    .update({
      customer_id: params.customer.id,
      discount_amount: params.discountAmount,
      loyalty_points_earned: pointsEarned,
      loyalty_points_spent: pointsSpent,
      loyalty_discount_amount: params.loyaltyDiscountAmount,
    })
    .eq('id', params.saleId)

  if (updateSaleError) throw updateSaleError

  return { pointsEarned, pointsSpent, customerId: params.customer.id }
}

export function validatePaymentBreakdown(params: {
  paymentMethod: string | undefined
  cashAmount: number
  kaspiAmount: number
  kaspiBeforeMidnightAmount: number
  kaspiAfterMidnightAmount: number
  totalAmount: number
}) {
  if (!['cash', 'kaspi', 'mixed'].includes(String(params.paymentMethod || ''))) {
    return { error: 'sale-payment-method-invalid', message: 'Выберите корректный способ оплаты.' }
  }
  if (
    params.cashAmount < 0 ||
    params.kaspiAmount < 0 ||
    params.kaspiBeforeMidnightAmount < 0 ||
    params.kaspiAfterMidnightAmount < 0
  ) {
    return { error: 'sale-payment-negative', message: 'Суммы оплаты не могут быть отрицательными.' }
  }
  if (Math.abs(params.cashAmount + params.kaspiAmount - params.totalAmount) > 0.01) {
    return {
      error: 'sale-payment-total-mismatch',
      message: 'Сумма оплаты должна совпадать с итогом продажи.',
    }
  }
  if (Math.abs(params.kaspiAmount - (params.kaspiBeforeMidnightAmount + params.kaspiAfterMidnightAmount)) > 0.01) {
    return {
      error: 'sale-kaspi-split-mismatch',
      message: 'Разделение Безналичный до/после полуночи не совпадает с общей суммой Безналичный.',
    }
  }
  if (params.paymentMethod === 'cash' && (Math.abs(params.cashAmount - params.totalAmount) > 0.01 || params.kaspiAmount > 0)) {
    return { error: 'sale-cash-payment-invalid', message: 'Для наличной оплаты вся сумма должна быть в наличных.' }
  }
  if (params.paymentMethod === 'kaspi' && (params.cashAmount > 0 || Math.abs(params.kaspiAmount - params.totalAmount) > 0.01)) {
    return { error: 'sale-kaspi-payment-invalid', message: 'Для Безналичный-оплаты вся сумма должна быть в Безналичный.' }
  }
  if (params.paymentMethod === 'mixed' && (params.cashAmount <= 0 || params.kaspiAmount <= 0)) {
    return { error: 'sale-mixed-payment-invalid', message: 'Для смешанной оплаты должны быть и наличные, и Безналичный.' }
  }
  return null
}
