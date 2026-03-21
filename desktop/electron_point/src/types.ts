// Config

export interface AppConfig {
  apiUrl: string
  deviceToken: string
}

// Bootstrap

export interface FeatureFlags {
  shift_report: boolean
  income_report: boolean
  debt_report: boolean
  kaspi_daily_split: boolean
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

// Sessions

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
  password: string
  bootstrap?: BootstrapData
}

export type Session = OperatorSession | AdminSession

// App State Machine

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
  | { screen: 'operator-cabinet'; bootstrap: BootstrapData; session: OperatorSession; returnTo: 'shift' | 'scanner' }
  | { screen: 'admin'; session: AdminSession; bootstrap?: BootstrapData }

// Products

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

// Debts

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

// Queue

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

// Shift report form

export interface ShiftForm {
  date: string
  operator_id: string
  shift: 'day' | 'night'
  cash: string
  coins: string
  kaspi_pos: string
  kaspi_before_midnight: string
  kaspi_online: string
  debts: string
  start: string
  wipon: string
  comment: string
}

export interface DailyKaspiReportBucket {
  key: 'day' | 'night-before-midnight' | 'previous-night-after-midnight'
  label: string
  amount: number
  rowCount: number
}

export interface DailyKaspiReport {
  date: string
  total: number
  isPrecise: boolean
  warning: string | null
  parts: DailyKaspiReportBucket[]
}

// Reports

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

export interface OperatorTaskComment {
  id: string
  task_id: string
  content: string
  created_at: string
  author_name: string
  author_type: 'staff' | 'operator'
}

export interface OperatorTask {
  id: string
  task_number: number
  title: string
  description: string | null
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'
  priority: 'critical' | 'high' | 'medium' | 'low'
  due_date: string | null
  company_id: string | null
  company_name: string | null
  company_code: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}
