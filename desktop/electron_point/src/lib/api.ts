import type {
  AppConfig,
  BootstrapData,
  CompanyOption,
  OperatorBasic,
  OperatorSession,
  OperatorInfo,
  OperatorTask,
  OperatorTaskComment,
  Product,
  DebtItem,
  ShiftForm,
  DailyKaspiReport,
  ShiftRecord,
  PointInventoryRequestContext,
  PointInventorySaleContext,
  PointInventorySaleShiftSummary,
  PointInventoryReturnContext,
  Customer,
  LoyaltyConfig,
  ArenaZone,
  ArenaStation,
  ArenaTariff,
  ArenaSession,
  ArenaMapDecoration,
} from '@/types'
import { parseMoney } from '@/lib/utils'

// ─── Client ───────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000

async function request<T>(
  config: AppConfig,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const url = `${config.apiUrl.replace(/\/$/, '')}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-point-device-token': config.deviceToken,
    ...extraHeaders,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Превышено время ожидания (30 с). Проверьте соединение.')
    }
    throw err
  }
  clearTimeout(timeoutId)

  const json = await res.json().catch(() => ({ error: 'Ошибка ответа сервера' }))

  if (res.status === 401) {
    // Session expired — notify app to re-show login
    try { window.dispatchEvent(new CustomEvent('orda:unauthorized')) } catch {}
  }

  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`)
  }

  return json as T
}

function operatorHeaders(session: OperatorSession) {
  return {
    'x-point-operator-id': session.operator.operator_id,
    'x-point-operator-auth-id': session.operator.auth_id,
    'x-point-company-id': session.company.id,
  }
}

function companyHeader(companyId: string | null | undefined): Record<string, string> {
  return companyId ? { 'x-point-company-id': companyId } : {}
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function bootstrap(config: AppConfig, companyId?: string | null): Promise<BootstrapData> {
  const data = await request<{ ok: boolean } & BootstrapData>(
    config, 'GET', '/api/point/bootstrap', undefined, companyHeader(companyId),
  )
  return data
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function loginOperator(
  config: AppConfig,
  username: string,
  password: string,
): Promise<{ operator: OperatorInfo; company: { id: string; name: string; code: string | null }; allCompanies: CompanyOption[]; must_change_password: boolean }> {
  const data = await request<{
    ok: boolean
    must_change_password?: boolean
    operator: OperatorInfo
    company: { id: string; name: string; code: string | null }
    allCompanies: CompanyOption[]
  }>(config, 'POST', '/api/point/login', { username, password })
  return { ...data, allCompanies: data.allCompanies ?? [], must_change_password: data.must_change_password === true }
}

export type PointQrStartResult = {
  ok: boolean
  nonce: string
  expires_at: string
  confirm_url: string
}

export async function startPointQrLogin(config: AppConfig): Promise<PointQrStartResult> {
  return request<PointQrStartResult>(config, 'POST', '/api/point/qr-login/start')
}

export type PointQrPollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'consumed' }
  | {
      status: 'ready'
      ok: true
      must_change_password?: boolean
      operator: OperatorInfo
      company: { id: string; name: string; code: string | null }
      allCompanies: CompanyOption[]
    }

export async function pollPointQrLogin(config: AppConfig, nonce: string): Promise<PointQrPollResult> {
  const url = `${config.apiUrl.replace(/\/$/, '')}/api/point/qr-login/poll?nonce=${encodeURIComponent(nonce)}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-point-device-token': config.deviceToken,
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { method: 'GET', headers, signal: controller.signal })
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Превышено время ожидания (30 с). Проверьте соединение.')
    }
    throw err
  }
  clearTimeout(timeoutId)

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>

  if (res.status === 401) {
    try {
      window.dispatchEvent(new CustomEvent('orda:unauthorized'))
    } catch {
      /* ignore */
    }
  }

  if (!res.ok) {
    throw new Error((json.error as string) || `HTTP ${res.status}`)
  }

  const status = String(json.status || '')
  if (status === 'ready' && json.operator && json.company) {
    return {
      status: 'ready',
      ok: true,
      must_change_password: json.must_change_password === true,
      operator: json.operator as OperatorInfo,
      company: json.company as { id: string; name: string; code: string | null },
      allCompanies: (json.allCompanies as CompanyOption[]) ?? [],
    }
  }
  if (status === 'pending' || status === 'expired' || status === 'consumed') {
    return { status } as PointQrPollResult
  }
  throw new Error('Неизвестный ответ сервера при проверке QR-входа.')
}

export async function changeOperatorPassword(
  config: AppConfig,
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request(config, 'POST', '/api/point/change-password', {
    username,
    current_password: currentPassword,
    new_password: newPassword,
  })
}

export async function getAllOperators(config: AppConfig, companyId?: string | null): Promise<OperatorBasic[]> {
  const data = await request<{ ok: boolean; operators: OperatorBasic[] }>(
    config, 'GET', '/api/point/all-operators', undefined, companyHeader(companyId),
  )
  return data.operators ?? []
}

export async function loginAdmin(
  config: AppConfig,
  email: string,
  password: string,
): Promise<{ ok: boolean; token: string; admin: { email: string } }> {
  return request(config, 'POST', '/api/point/admin-login', { email, password })
}

export async function logoutAdmin(config: AppConfig, token: string): Promise<void> {
  await request(config, 'POST', '/api/point/admin-logout', { token }).catch(() => null)
}

// ─── Shift report ─────────────────────────────────────────────────────────────

export async function sendShiftReport(
  config: AppConfig,
  form: ShiftForm,
  localRef: string,
  companyId?: string | null,
): Promise<{ ok: boolean; data: { id: string } }> {
  const cash = parseMoney(form.cash)
  const coins = parseMoney(form.coins)
  const kaspiBeforeMidnight = parseMoney(form.kaspi_before_midnight)
  const kaspiAfterMidnight = parseMoney(form.kaspi_pos)
  const kaspiPos =
    form.shift === 'night' && form.kaspi_before_midnight.trim().length > 0
      ? kaspiBeforeMidnight + kaspiAfterMidnight
      : kaspiAfterMidnight
  const kaspiOnline = parseMoney(form.kaspi_online)
  const debts = parseMoney(form.debts)
  const start = parseMoney(form.start)
  const wipon = parseMoney(form.wipon)
  const fact = cash + coins + kaspiPos + debts - start
  const itog = fact - wipon

  return request(config, 'POST', '/api/point/shift-report', {
    action: 'createShiftReport',
    payload: {
      date: form.date,
      operator_id: form.operator_id,
      shift: form.shift,
      cash_amount: cash,
      kaspi_amount: kaspiPos,
      kaspi_before_midnight:
        form.shift === 'night' && form.kaspi_before_midnight.trim().length > 0
          ? kaspiBeforeMidnight
          : null,
      online_amount: kaspiOnline,
      card_amount: 0,
      comment: form.comment || null,
      source: 'electron-point-client',
      local_ref: localRef,
      meta: {
        coins,
        debts,
        start_cash: start,
        wipon,
        diff: itog,
        split_mode: form.shift === 'night' && form.kaspi_before_midnight.trim().length > 0,
      },
    },
  }, companyHeader(companyId))
}

export async function getPointDailyKaspiReport(
  config: AppConfig,
  date: string,
  companyId?: string | null,
): Promise<DailyKaspiReport> {
  const data = await request<{ ok: boolean; data: DailyKaspiReport }>(
    config,
    'GET',
    `/api/point/shift-report?date=${encodeURIComponent(date)}&view=daily-kaspi`,
    undefined,
    companyHeader(companyId),
  )
  return data.data
}

// ─── Products ─────────────────────────────────────────────────────────────────
// @deprecated Products management is now handled through the web inventory catalog.
// These functions are kept for backward compatibility but are no longer used in the app UI.

export async function getProducts(config: AppConfig, companyId?: string | null): Promise<Product[]> {
  const data = await request<{ ok: boolean; data: { products: Product[] } }>(
    config, 'GET', '/api/point/products', undefined, companyHeader(companyId),
  )
  return data.data.products
}

export async function createProduct(
  config: AppConfig,
  token: string,
  payload: { name: string; barcode: string; price: number },
): Promise<Product> {
  const data = await request<{ ok: boolean; data: Product }>(config, 'POST', '/api/point/products', {
    action: 'createProduct',
    token,
    payload,
  })
  return data.data
}

export async function importProducts(
  config: AppConfig,
  token: string,
  products: { name: string; barcode: string; price: number }[],
): Promise<{ imported: number; skipped: number; failed: number }> {
  const data = await request<{ ok: boolean; data: { imported: number; skipped: number; failed: number } }>(
    config, 'POST', '/api/point/products',
    { action: 'importProducts', token, products },
  )
  return data.data
}

export async function updateProduct(
  config: AppConfig,
  token: string,
  productId: string,
  payload: { name: string; barcode: string; price: number; is_active: boolean },
): Promise<Product> {
  const data = await request<{ ok: boolean; data: Product }>(config, 'POST', '/api/point/products', {
    action: 'updateProduct',
    token,
    productId,
    payload,
  })
  return data.data
}

export async function deleteProduct(
  config: AppConfig,
  token: string,
  productId: string,
): Promise<void> {
  await request(config, 'POST', '/api/point/products', {
    action: 'deleteProduct',
    token,
    productId,
  })
}

// ─── Debts ────────────────────────────────────────────────────────────────────

export async function getDebts(config: AppConfig, companyId?: string | null): Promise<DebtItem[]> {
  const data = await request<{ ok: boolean; data: { items: DebtItem[] } }>(
    config, 'GET', '/api/point/debts', undefined, companyHeader(companyId),
  )
  return data.data.items
}

export async function createDebt(
  config: AppConfig,
  payload: {
    operator_id?: string | null
    client_name?: string | null
    item_name: string
    barcode?: string | null
    quantity: number
    unit_price: number
    total_amount: number
    comment?: string | null
    local_ref?: string | null
    created_by_operator_id?: string | null
  },
  companyId?: string | null,
): Promise<DebtItem> {
  const data = await request<{ ok: boolean; data: { item: DebtItem } }>(
    config, 'POST', '/api/point/debts',
    { action: 'createDebt', payload },
    companyHeader(companyId),
  )
  return data.data.item
}

export async function deleteDebt(
  config: AppConfig,
  itemId: string,
  companyId?: string | null,
  operatorId?: string | null,
  adminToken?: string | null,
): Promise<void> {
  await request(config, 'POST', '/api/point/debts', {
    action: 'deleteDebt',
    itemId,
    operatorId: operatorId || null,
    adminToken: adminToken || null,
  }, companyHeader(companyId))
}

export async function adminPayDebt(
  config: AppConfig,
  itemId: string,
  adminToken: string,
  companyId?: string | null,
): Promise<void> {
  await request(config, 'POST', '/api/point/debts', {
    action: 'adminPayDebt',
    itemId,
    adminToken,
  }, companyHeader(companyId))
}

// ─── Reports ─────────────────────────────────────────────────────────────────
// API возвращает все данные устройства без фильтрации — фильтруем на клиенте

export async function getReports(config: AppConfig, adminToken?: string) {
  const extraHeaders: Record<string, string> = {}
  if (adminToken) {
    extraHeaders['x-admin-token'] = adminToken
  }
  return request<{
    ok: boolean
    data: {
      shifts: unknown[]
      debt_history: unknown[]
      warehouse: unknown[]
      worker_totals: unknown[]
      client_totals: unknown[]
    }
  }>(config, 'GET', '/api/point/reports', undefined, extraHeaders)
}

// ─── Admin devices ────────────────────────────────────────────────────────────
// Требует POST с email + password (super admin credentials)

export async function getAdminDevices(config: AppConfig, token: string) {
  return request<{ ok: boolean; data: { devices: unknown[] } }>(
    config, 'POST', '/api/point/admin-devices', { token },
  )
}

export async function updateAdminDeviceShiftReportChat(
  config: AppConfig,
  token: string,
  deviceId: string,
  shiftReportChatId: string | null,
  featureFlags?: { kaspi_daily_split?: boolean; debt_report?: boolean; start_cash_prompt?: boolean },
) {
  return request<{ ok: boolean; data: { device: unknown } }>(
    config,
    'POST',
    '/api/point/admin-devices',
    {
      token,
      action: 'updateDeviceSettings',
      deviceId,
      shift_report_chat_id: shiftReportChatId,
      feature_flags: featureFlags,
    },
  )
}

export async function getPointOperatorTasks(
  config: AppConfig,
  session: OperatorSession,
): Promise<{ tasks: OperatorTask[]; comments: OperatorTaskComment[] }> {
  const data = await request<{ ok: boolean; tasks: OperatorTask[]; comments: OperatorTaskComment[] }>(
    config,
    'GET',
    '/api/point/operator-tasks',
    undefined,
    operatorHeaders(session),
  )
  return {
    tasks: data.tasks || [],
    comments: data.comments || [],
  }
}

export async function getPointOperatorCabinet(
  config: AppConfig,
  session: OperatorSession,
): Promise<{
  shifts: (ShiftRecord & { company_name?: string | null })[]
  debts: DebtItem[]
}> {
  const data = await request<{
    ok: boolean
    shifts: (ShiftRecord & { company_name?: string | null })[]
    debts: DebtItem[]
  }>(
    config,
    'GET',
    '/api/point/operator-cabinet',
    undefined,
    operatorHeaders(session),
  )

  return {
    shifts: data.shifts || [],
    debts: data.debts || [],
  }
}

export async function markPointDebtPaid(
  config: AppConfig,
  session: OperatorSession,
  debtId: string,
  adminToken: string,
): Promise<{ ok: boolean }> {
  return request(
    config,
    'POST',
    '/api/point/operator-cabinet',
    { action: 'markDebtPaid', debtId, token: adminToken },
    operatorHeaders(session),
  )
}

export async function getPointInventoryRequests(
  config: AppConfig,
  session: OperatorSession,
): Promise<PointInventoryRequestContext> {
  const data = await request<{ ok: boolean; data: PointInventoryRequestContext }>(
    config,
    'GET',
    '/api/point/inventory-requests',
    undefined,
    operatorHeaders(session),
  )
  return data.data
}

export async function createPointInventoryRequest(
  config: AppConfig,
  session: OperatorSession,
  payload: {
    comment?: string | null
    items: Array<{ item_id: string; requested_qty: number; comment?: string | null }>
  },
): Promise<{ request_id: string }> {
  const data = await request<{ ok: boolean; data: { request_id: string } }>(
    config,
    'POST',
    '/api/point/inventory-requests',
    {
      action: 'createRequest',
      payload,
    },
    operatorHeaders(session),
  )
  return data.data
}

export async function getPointInventorySales(
  config: AppConfig,
  session: OperatorSession,
): Promise<PointInventorySaleContext> {
  const data = await request<{ ok: boolean; data: PointInventorySaleContext }>(
    config,
    'GET',
    '/api/point/inventory-sales',
    undefined,
    operatorHeaders(session),
  )
  return data.data
}

export async function getPointInventorySaleShiftSummary(
  config: AppConfig,
  date: string,
  shift: 'day' | 'night',
  companyId?: string | null,
): Promise<PointInventorySaleShiftSummary> {
  const data = await request<{ ok: boolean; data: PointInventorySaleShiftSummary }>(
    config,
    'GET',
    `/api/point/inventory-sales?view=shift-summary&date=${encodeURIComponent(date)}&shift=${encodeURIComponent(shift)}`,
    undefined,
    companyHeader(companyId),
  )
  return data.data
}

export async function createPointInventorySale(
  config: AppConfig,
  session: OperatorSession,
  payload: {
    sale_date: string
    shift: 'day' | 'night'
    payment_method: 'cash' | 'kaspi' | 'mixed'
    cash_amount?: number | null
    kaspi_amount?: number | null
    kaspi_before_midnight_amount?: number | null
    kaspi_after_midnight_amount?: number | null
    customer_id?: string | null
    loyalty_points_spent?: number | null
    discount_amount?: number | null
    loyalty_discount_amount?: number | null
    comment?: string | null
    local_ref?: string | null
    items: Array<{
      item_id: string
      quantity: number
      unit_price: number
      comment?: string | null
    }>
  },
): Promise<{
  sale_id: string | null
  total_amount: number
  sold_at: string | null
  customer_id: string | null
  loyalty_points_earned: number
  loyalty_points_spent: number
}> {
  const data = await request<{
    ok: boolean
    data: {
      sale_id: string | null
      total_amount: number
      sold_at: string | null
      customer_id: string | null
      loyalty_points_earned: number
      loyalty_points_spent: number
    }
  }>(
    config,
    'POST',
    '/api/point/inventory-sales',
    {
      action: 'createSale',
      payload,
    },
    operatorHeaders(session),
  )
  return data.data
}

export async function getPointInventoryReturns(
  config: AppConfig,
  session: OperatorSession,
): Promise<PointInventoryReturnContext> {
  const data = await request<{ ok: boolean; data: PointInventoryReturnContext }>(
    config,
    'GET',
    '/api/point/inventory-returns',
    undefined,
    operatorHeaders(session),
  )
  return data.data
}

// ─── Customers & Loyalty ──────────────────────────────────────────────────────

export async function searchCustomers(config: AppConfig, q: string): Promise<{ customers: Customer[]; loyalty_config: LoyaltyConfig | null }> {
  const data = await request<{ ok: boolean; data: Customer[]; loyalty_config: LoyaltyConfig | null }>(
    config,
    'GET',
    `/api/point/customers?q=${encodeURIComponent(q)}`,
  )
  return {
    customers: data.data || [],
    loyalty_config: data.loyalty_config || null,
  }
}

export async function getLoyaltyConfig(config: AppConfig, companyId: string): Promise<LoyaltyConfig | null> {
  const data = await request<{ ok: boolean; data: Customer[]; loyalty_config: LoyaltyConfig | null }>(
    config,
    'GET',
    `/api/point/customers?q=&company_id=${encodeURIComponent(companyId)}`,
  )
  return data.loyalty_config || null
}

export async function recordSaleWithCustomer(
  config: AppConfig,
  payload: {
    customer_id: string
    sale_total_amount: number
    loyalty_points_spent: number
  },
): Promise<{ customer: Customer; points_earned: number; points_spent: number }> {
  const data = await request<{ ok: boolean; data: { customer: Customer; points_earned: number; points_spent: number } }>(
    config,
    'POST',
    '/api/point/customers',
    {
      action: 'recordSaleWithCustomer',
      ...payload,
    },
  )
  return data.data
}

export async function validatePromoCode(
  config: AppConfig,
  promoCode: string,
  orderAmount: number,
): Promise<{ type: 'percent' | 'fixed'; value: number }> {
  const data = await request<{ ok: boolean; data: { type: 'percent' | 'fixed'; value: number } }>(
    config,
    'POST',
    '/api/admin/discounts',
    {
      action: 'validatePromoCode',
      promo_code: promoCode,
      order_amount: orderAmount,
    },
  )
  return data.data
}

// ─── Arena ────────────────────────────────────────────────────────────────────

export type ArenaTechLog = { id: string; station_name: string | null; reason: string; amount: number; created_at: string }

export async function getArena(
  config: AppConfig,
  session: OperatorSession,
): Promise<{ zones: ArenaZone[]; stations: ArenaStation[]; tariffs: ArenaTariff[]; sessions: ArenaSession[]; decorations: ArenaMapDecoration[]; today_income: { cash: number; kaspi: number; rows: { cash_amount: number; kaspi_amount: number; comment: string | null }[] }; today_tech_logs: ArenaTechLog[] }> {
  const data = await request<{
    ok: boolean
    data: { zones: ArenaZone[]; stations: ArenaStation[]; tariffs: ArenaTariff[]; sessions: ArenaSession[]; decorations: ArenaMapDecoration[]; today_income: { cash: number; kaspi: number; rows: { cash_amount: number; kaspi_amount: number; comment: string | null }[] }; today_tech_logs: ArenaTechLog[] }
  }>(config, 'GET', '/api/point/arena', undefined, operatorHeaders(session))
  return data.data
}

export async function logArenaTech(
  config: AppConfig,
  session: OperatorSession,
  payload: { stationId?: string | null; stationName?: string | null; reason: string; amount: number },
): Promise<void> {
  await request(
    config,
    'POST',
    '/api/point/arena',
    { action: 'techLog', operatorId: session.operator.operator_id, ...payload },
    operatorHeaders(session),
  )
}

export async function startArenaSession(
  config: AppConfig,
  session: OperatorSession,
  payload: {
    stationId: string
    tariffId: string
    operatorId?: string | null
    payment_method: 'cash' | 'kaspi' | 'mixed'
    cash_amount?: number
    kaspi_amount?: number
    discount_percent?: number
  },
): Promise<ArenaSession> {
  const data = await request<{ ok: boolean; data: ArenaSession }>(
    config,
    'POST',
    '/api/point/arena',
    { action: 'startSession', ...payload },
    operatorHeaders(session),
  )
  return data.data
}

export async function endArenaSession(
  config: AppConfig,
  session: OperatorSession,
  sessionId: string,
): Promise<ArenaSession> {
  const data = await request<{ ok: boolean; data: ArenaSession }>(
    config,
    'POST',
    '/api/point/arena',
    { action: 'endSession', sessionId },
    operatorHeaders(session),
  )
  return data.data
}

export async function extendArenaSession(
  config: AppConfig,
  session: OperatorSession,
  sessionId: string,
  payload:
    | {
        amount_extension: true
        payment_method: 'cash' | 'kaspi' | 'mixed'
        cash_amount?: number
        kaspi_amount?: number
      }
    | {
        tariffId: string
        payment_method: 'cash' | 'kaspi' | 'mixed'
        cash_amount?: number
        kaspi_amount?: number
      },
): Promise<ArenaSession> {
  const body =
    'amount_extension' in payload && payload.amount_extension === true
      ? {
          action: 'extendSession' as const,
          sessionId,
          amount_extension: true,
          payment_method: payload.payment_method,
          cash_amount: payload.cash_amount,
          kaspi_amount: payload.kaspi_amount,
        }
      : {
          action: 'extendSession' as const,
          sessionId,
          tariffId: (payload as { tariffId: string }).tariffId,
          payment_method: payload.payment_method,
          cash_amount: payload.cash_amount,
          kaspi_amount: payload.kaspi_amount,
        }
  const data = await request<{ ok: boolean; data: ArenaSession }>(
    config,
    'POST',
    '/api/point/arena',
    body,
    operatorHeaders(session),
  )
  return data.data
}

export async function notifyArena5min(
  config: AppConfig,
  session: OperatorSession,
  sessionId: string,
): Promise<void> {
  await request(
    config,
    'POST',
    '/api/point/arena',
    { action: 'notify5min', sessionId, operatorId: session.operator.operator_id },
    operatorHeaders(session),
  ).catch(() => null)
}

export async function createPointInventoryReturn(
  config: AppConfig,
  session: OperatorSession,
  payload: {
    sale_id: string
    return_date: string
    shift: 'day' | 'night'
    payment_method: 'cash' | 'kaspi' | 'mixed'
    cash_amount?: number | null
    kaspi_amount?: number | null
    kaspi_before_midnight_amount?: number | null
    kaspi_after_midnight_amount?: number | null
    comment?: string | null
    local_ref?: string | null
    items: Array<{
      item_id: string
      quantity: number
      unit_price: number
      comment?: string | null
    }>
  },
): Promise<{ return_id: string | null; total_amount: number }> {
  const data = await request<{ ok: boolean; data: { return_id: string | null; total_amount: number } }>(
    config,
    'POST',
    '/api/point/inventory-returns',
    {
      action: 'createReturn',
      payload,
    },
    operatorHeaders(session),
  )
  return data.data
}
