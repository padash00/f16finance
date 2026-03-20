import type {
  AppConfig,
  BootstrapData,
  CompanyOption,
  OperatorInfo,
  Product,
  DebtItem,
  ShiftForm,
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
  const kaspiPos = parseMoney(form.kaspi_pos)
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
        split_mode: false,
      },
    },
  })
}

// ─── Products ─────────────────────────────────────────────────────────────────

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

export async function getReports(config: AppConfig) {
  return request<{
    ok: boolean
    data: {
      shifts: unknown[]
      debt_history: unknown[]
      warehouse: unknown[]
      worker_totals: unknown[]
      client_totals: unknown[]
    }
  }>(config, 'GET', '/api/point/reports')
}

// ─── Admin devices ────────────────────────────────────────────────────────────
// Требует POST с email + password (super admin credentials)

export async function getAdminDevices(config: AppConfig, email: string, password: string) {
  return request<{ ok: boolean; data: { devices: unknown[] } }>(
    config, 'POST', '/api/point/admin-devices', { email, password },
  )
}
