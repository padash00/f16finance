// ─── Config ───────────────────────────────────────────────────────────────────

export interface AppConfig {
  apiUrl: string       // https://ordaops.kz
  deviceToken: string  // x-point-device-token
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export interface FeatureFlags {
  shift_report: boolean
  income_report: boolean
  debt_report: boolean
}

export interface BootstrapOperator {
  id: string
  name: string
  short_name: string | null
  full_name: string | null
  telegram_chat_id: string | null
  is_active: boolean
  role_in_company: string
  is_primary: boolean
}

export interface BootstrapData {
  device: {
    id: string
    name: string
    point_mode: string
    feature_flags: FeatureFlags
  }
  company: {
    id: string
    name: string
    code: string | null
  }
  operators: BootstrapOperator[]
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export interface OperatorInfo {
  auth_id: string
  operator_id: string
  username: string
  name: string | null
  short_name: string | null
  full_name: string | null
  telegram_chat_id: string | null
  role_in_company: string
  is_primary: boolean
}

export interface OperatorSession {
  type: 'operator'
  operator: OperatorInfo
  company: { id: string; name: string; code: string | null }
  bootstrap: BootstrapData
}

export interface AdminSession {
  type: 'admin'
  email: string
  password: string  // хранится только в памяти, нужен для admin-devices API
  bootstrap?: BootstrapData
}

export type Session = OperatorSession | AdminSession

// ─── App State Machine ────────────────────────────────────────────────────────

export interface OperatorBasic {
  id: string
  name: string
  short_name: string | null
  full_name: string | null
}

export interface CompanyOption {
  id: string
  name: string
  code: string | null
  role_in_company: string
}

export type AppView =
  | { screen: 'setup' }
  | { screen: 'booting' }
  | { screen: 'login'; bootstrap: BootstrapData }
  | { screen: 'point-select'; bootstrap: BootstrapData; session: OperatorSession; allCompanies: CompanyOption[] }
  | { screen: 'shift'; bootstrap: BootstrapData; session: OperatorSession }
  | { screen: 'scanner'; bootstrap: BootstrapData; session: OperatorSession }
  | { screen: 'admin'; session: AdminSession; bootstrap?: BootstrapData }

// ─── Products ─────────────────────────────────────────────────────────────────

export interface Product {
  id: string
  company_id: string
  name: string
  barcode: string
  price: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Debts ────────────────────────────────────────────────────────────────────

export interface DebtItem {
  id: string
  operator_id: string | null
  client_name: string | null
  debtor_name: string
  item_name: string
  quantity: number
  unit_price: number
  total_amount: number
  comment: string | null
  week_start: string
  created_at: string
  source: string
  status: string
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export interface QueueItem {
  id: number
  type: 'shift_report' | 'create_debt' | 'delete_debt'
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'failed'
  local_ref: string | null
  attempts: number
  last_error: string | null
  created_at: string
}

// ─── Shift report form ────────────────────────────────────────────────────────

export interface ShiftForm {
  date: string
  operator_id: string
  shift: 'day' | 'night'
  cash: string         // Наличные
  coins: string        // Мелочь
  kaspi_pos: string    // Kaspi (терминал)
  kaspi_online: string // Kaspi Online — только для Arena, не входит в ФАКТ
  debts: string        // Тех (компенсации)
  start: string        // Старт (касса с утра)
  wipon: string        // Senet (Arena) / Wipon (Ramen)
  comment: string
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface ShiftRecord {
  id: string
  date: string
  shift: string
  operator_id: string | null
  operator_name: string | null
  cash_amount: number
  kaspi_amount: number
  online_amount: number
  card_amount: number
  total: number
  zone: string | null
}

export interface DebtRecord {
  operator_id: string | null
  operator_name: string | null
  client_name: string | null
  total_amount: number
  week_start: string
}
