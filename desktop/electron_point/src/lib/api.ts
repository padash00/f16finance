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
} from '@/types'
import { parseMoney } from '@/lib/utils'

// ─── Client ───────────────────────────────────────────────────────────────────

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

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const json = await res.json().catch(() => ({ error: 'Ошибка ответа сервера' }))

  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`)
  }

  return json as T
}

function operatorHeaders(session: OperatorSession) {
  return {
    'x-point-operator-id': session.operator.operator_id,
    'x-point-operator-auth-id': session.operator.auth_id,
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function bootstrap(config: AppConfig): Promise<BootstrapData> {
  const data = await request<{ ok: boolean } & BootstrapData>(config, 'GET', '/api/point/bootstrap')
  return data
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function loginOperator(
  config: AppConfig,
  username: string,
  password: string,
): Promise<{ operator: OperatorInfo; company: { id: string; name: string; code: string | null }; allCompanies: CompanyOption[] }> {
  const data = await request<{
    ok: boolean
    operator: OperatorInfo
    company: { id: string; name: string; code: string | null }
    allCompanies: CompanyOption[]
  }>(config, 'POST', '/api/point/login', { username, password })
  return { ...data, allCompanies: data.allCompanies ?? [] }
}

export async function getAllOperators(config: AppConfig): Promise<OperatorBasic[]> {
  const data = await request<{ ok: boolean; operators: OperatorBasic[] }>(
    config, 'GET', '/api/point/all-operators',
  )
  return data.operators ?? []
}

export async function loginAdmin(
  config: AppConfig,
  email: string,
  password: string,
): Promise<{ ok: boolean; admin: { email: string } }> {
  return request(config, 'POST', '/api/point/admin-login', { email, password })
}

// ─── Shift report ─────────────────────────────────────────────────────────────

export async function sendShiftReport(
  config: AppConfig,
  form: ShiftForm,
  localRef: string,
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
  })
}

export async function getPointDailyKaspiReport(
  config: AppConfig,
  date: string,
): Promise<DailyKaspiReport> {
  const data = await request<{ ok: boolean; data: DailyKaspiReport }>(
    config,
    'GET',
    `/api/point/shift-report?date=${encodeURIComponent(date)}&view=daily-kaspi`,
  )
  return data.data
}

// ─── Products ─────────────────────────────────────────────────────────────────
// @deprecated Products management is now handled through the web inventory catalog.
// These functions are kept for backward compatibility but are no longer used in the app UI.

export async function getProducts(config: AppConfig): Promise<Product[]> {
  const data = await request<{ ok: boolean; data: { products: Product[] } }>(
    config, 'GET', '/api/point/products',
  )
  return data.data.products
}

export async function createProduct(
  config: AppConfig,
  email: string,
  password: string,
  payload: { name: string; barcode: string; price: number },
): Promise<Product> {
  const data = await request<{ ok: boolean; data: Product }>(config, 'POST', '/api/point/products', {
    action: 'createProduct',
    email,
    password,
    payload,
  })
  return data.data
}

export async function importProducts(
  config: AppConfig,
  email: string,
  password: string,
  products: { name: string; barcode: string; price: number }[],
): Promise<{ imported: number; skipped: number; failed: number }> {
  const data = await request<{ ok: boolean; data: { imported: number; skipped: number; failed: number } }>(
    config, 'POST', '/api/point/products',
    { action: 'importProducts', email, password, products },
  )
  return data.data
}

export async function updateProduct(
  config: AppConfig,
  email: string,
  password: string,
  productId: string,
  payload: { name: string; barcode: string; price: number; is_active: boolean },
): Promise<Product> {
  const data = await request<{ ok: boolean; data: Product }>(config, 'POST', '/api/point/products', {
    action: 'updateProduct',
    email,
    password,
    productId,
    payload,
  })
  return data.data
}

export async function deleteProduct(
  config: AppConfig,
  email: string,
  password: string,
  productId: string,
): Promise<void> {
  await request(config, 'POST', '/api/point/products', {
    action: 'deleteProduct',
    email,
    password,
    productId,
  })
}

// ─── Debts ────────────────────────────────────────────────────────────────────

export async function getDebts(config: AppConfig): Promise<DebtItem[]> {
  const data = await request<{ ok: boolean; data: { items: DebtItem[] } }>(
    config, 'GET', '/api/point/debts',
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
  },
): Promise<DebtItem> {
  const data = await request<{ ok: boolean; data: { item: DebtItem } }>(
    config, 'POST', '/api/point/debts',
    { action: 'createDebt', payload },
  )
  return data.data.item
}

export async function deleteDebt(
  config: AppConfig,
  itemId: string,
): Promise<void> {
  await request(config, 'POST', '/api/point/debts', {
    action: 'deleteDebt',
    itemId,
  })
}

// ─── Reports ─────────────────────────────────────────────────────────────────
// API возвращает все данные устройства без фильтрации — фильтруем на клиенте

export async function getReports(config: AppConfig, adminCredentials?: { email: string; password: string }) {
  const extraHeaders: Record<string, string> = {}
  if (adminCredentials) {
    extraHeaders['x-admin-email'] = adminCredentials.email
    extraHeaders['x-admin-password'] = adminCredentials.password
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

export async function getAdminDevices(config: AppConfig, email: string, password: string) {
  return request<{ ok: boolean; data: { devices: unknown[] } }>(
    config, 'POST', '/api/point/admin-devices', { email, password },
  )
}

export async function updateAdminDeviceShiftReportChat(
  config: AppConfig,
  email: string,
  password: string,
  deviceId: string,
  shiftReportChatId: string | null,
  featureFlags?: { kaspi_daily_split?: boolean; debt_report?: boolean },
) {
  return request<{ ok: boolean; data: { device: unknown } }>(
    config,
    'POST',
    '/api/point/admin-devices',
    {
      email,
      password,
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
): Promise<PointInventorySaleShiftSummary> {
  const data = await request<{ ok: boolean; data: PointInventorySaleShiftSummary }>(
    config,
    'GET',
    `/api/point/inventory-sales?view=shift-summary&date=${encodeURIComponent(date)}&shift=${encodeURIComponent(shift)}`,
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
    comment?: string | null
    local_ref?: string | null
    items: Array<{
      item_id: string
      quantity: number
      unit_price: number
      comment?: string | null
    }>
  },
): Promise<{ sale_id: string | null; total_amount: number }> {
  const data = await request<{ ok: boolean; data: { sale_id: string | null; total_amount: number } }>(
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

export async function createPointInventoryReturn(
  config: AppConfig,
  session: OperatorSession,
  payload: {
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
