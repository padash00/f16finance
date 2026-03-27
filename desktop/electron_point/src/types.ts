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
  start_cash_prompt: boolean
  arena_enabled: boolean
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
  companies: Array<{ id: string; name: string; code: string | null }>
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
  token: string
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
  | { screen: 'inventory-sale'; bootstrap: BootstrapData; session: OperatorSession }
  | { screen: 'inventory-return'; bootstrap: BootstrapData; session: OperatorSession }
  | { screen: 'scanner'; bootstrap: BootstrapData; session: OperatorSession }
  | { screen: 'inventory-request'; bootstrap: BootstrapData; session: OperatorSession }
  | { screen: 'arena'; bootstrap: BootstrapData; session: OperatorSession }
  | { screen: 'operator-cabinet'; bootstrap: BootstrapData; session: OperatorSession; returnTo: 'shift' | 'sale' | 'return' | 'scanner' }
  | { screen: 'admin'; session: AdminSession; bootstrap?: BootstrapData }

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdateState {
  status: 'development' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
  currentVersion: string
  latestVersion: string | null
  releaseNotes: string | null
  releaseDate: string | null
  progress: AppUpdateProgress | null
  error: string | null
}

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
  created_by_operator_id?: string | null
  client_name: string | null
  debtor_name: string
  item_name: string
  barcode?: string | null
  quantity: number
  unit_price: number
  total_amount: number
  comment: string | null
  week_start: string
  created_at: string
  source?: string
  status: string
  company_name?: string | null
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

export interface PointInventoryRequestItem {
  id: string
  name: string
  barcode: string
  unit: string
  sale_price: number
  warehouse_qty: number
  category?: { id: string; name: string } | null
}

export interface PointInventoryRequestRow {
  id: string
  status: string
  comment: string | null
  decision_comment: string | null
  created_at: string
  approved_at: string | null
  items?: Array<{
    id: string
    requested_qty: number
    approved_qty: number | null
    comment: string | null
    item?: { id: string; name: string; barcode: string } | null
  }>
}

export interface PointInventoryRequestContext {
  company: { id: string; name: string; code: string | null }
  sourceLocation: { id: string; name: string; code: string | null; location_type: string }
  targetLocation: { id: string; name: string; code: string | null; location_type: string }
  items: PointInventoryRequestItem[]
  requests: PointInventoryRequestRow[]
}

export interface PointInventorySaleItem {
  id: string
  name: string
  barcode: string
  unit: string
  sale_price: number
  display_qty: number
  category?: { id: string; name: string } | null
}

export interface PointInventorySaleRow {
  id: string
  sale_date: string
  shift: 'day' | 'night'
  payment_method: 'cash' | 'kaspi' | 'mixed'
  cash_amount: number
  kaspi_amount: number
  kaspi_before_midnight_amount: number
  kaspi_after_midnight_amount: number
  total_amount: number
  comment: string | null
  sold_at: string
  items?: Array<{
    id: string
    quantity: number
    unit_price: number
    total_price: number
    returned_qty?: number
    returnable_qty?: number
    item?: { id: string; name: string; barcode: string } | null
  }>
}

export interface PointInventorySaleShiftSummary {
  date: string
  shift: 'day' | 'night'
  sale_count: number
  item_count: number
  return_count: number
  return_item_count: number
  total_amount: number
  cash_amount: number
  kaspi_amount: number
  kaspi_before_midnight_amount: number
  kaspi_after_midnight_amount: number
  sale_total_amount: number
  sale_cash_amount: number
  sale_kaspi_amount: number
  sale_kaspi_before_midnight_amount: number
  sale_kaspi_after_midnight_amount: number
  return_total_amount: number
  return_cash_amount: number
  return_kaspi_amount: number
  return_kaspi_before_midnight_amount: number
  return_kaspi_after_midnight_amount: number
}

export interface PointInventorySaleContext {
  company: { id: string; name: string; code: string | null }
  location: { id: string; name: string; code: string | null; location_type: string }
  items: PointInventorySaleItem[]
  sales: PointInventorySaleRow[]
}

export interface PointInventoryReturnRow {
  id: string
  return_date: string
  shift: 'day' | 'night'
  payment_method: 'cash' | 'kaspi' | 'mixed'
  cash_amount: number
  kaspi_amount: number
  kaspi_before_midnight_amount: number
  kaspi_after_midnight_amount: number
  total_amount: number
  comment: string | null
  returned_at: string
  items?: Array<{
    id: string
    quantity: number
    unit_price: number
    total_price: number
    item?: { id: string; name: string; barcode: string } | null
  }>
}

export interface PointInventoryReturnContext {
  company: { id: string; name: string; code: string | null }
  location: { id: string; name: string; code: string | null; location_type: string }
  returns: PointInventoryReturnRow[]
  sales: PointInventorySaleRow[]
}

// Customers & Loyalty

export interface Customer {
  id: string
  name: string
  phone: string | null
  card_number: string | null
  loyalty_points: number
  total_spent: number
}

export interface LoyaltyConfig {
  points_per_100_tenge: number
  tenge_per_point: number
  min_points_to_redeem: number
  max_redeem_percent: number
  is_active: boolean
}

// Arena

export interface ArenaZone {
  id: string
  point_project_id: string
  name: string
  is_active: boolean
}

export interface ArenaStation {
  id: string
  point_project_id: string
  zone_id: string | null
  name: string
  order_index: number
  is_active: boolean
}

export interface ArenaTariff {
  id: string
  point_project_id: string
  zone_id: string | null
  name: string
  duration_minutes: number
  price: number
  is_active: boolean
}

export interface ArenaSession {
  id: string
  point_project_id: string
  station_id: string
  tariff_id: string | null
  operator_id: string | null
  started_at: string
  ends_at: string
  ended_at: string | null
  amount: number
  status: 'active' | 'completed'
}
