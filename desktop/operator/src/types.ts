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
  /** Подмена экрана смены сводкой из сессий арены (по умолчанию выключено — ручной отчёт). */
  arena_shift_auto_totals: boolean
  /**
   * Не создавать строки incomes при старте/продлении сессии арены — учёт только в сменном отчёте
   * (страница «Доходы» без отдельной строки на каждый тариф до закрытия смены).
   */
  arena_defer_income_to_shift: boolean
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
  operatorName?: string | null
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
  /** Сотрудник орг. (владелец/руководитель/маркетолог) без записи в `operators` — в долгах передаётся `client_name`. */
  kind?: 'operator' | 'staff'
  /** Подпись роли в орг. (для списка должников); не дублируем, если уже есть в ФИО. */
  role_label?: string | null
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
  | { screen: 'checklists'; bootstrap: BootstrapData; session: OperatorSession }
  | { screen: 'operator-cabinet'; bootstrap: BootstrapData; session: OperatorSession; returnTo: 'shift' | 'sale' | 'return' | 'scanner' | 'checklists' }
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
  type:
    | 'shift_report'
    | 'close_shift'
    | 'create_debt'
    | 'delete_debt'
    | 'inventory_sale'
    | 'inventory_return'
    | 'inventory_request'
    | 'checklist_run'
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

export interface PointKnowledgeArticle {
  id: string
  title: string
  slug: string
  summary: string | null
  content: string
  tags: string[] | null
  audience: string[] | null
  severity: 'info' | 'normal' | 'warning' | 'critical'
  version: number | null
  requires_confirmation: boolean | null
  related_fine_amount: number | null
  related_bonus_amount: number | null
  company_id: string | null
  category_id: string | null
  category?: { id: string; title: string; slug: string; kind: string } | null
}

export interface PointChecklistTemplate {
  id: string
  company_id: string | null
  title: string
  description: string | null
  role_scope: string
  shift_scope: string
  schedule_type: 'opening' | 'periodic' | 'closing' | 'onboarding' | 'handover'
  recurrence_minutes: number | null
  blocks_shift: boolean
  sort_order: number
  is_active: boolean
}

export interface PointChecklistItem {
  id: string
  template_id: string
  category_id: string | null
  knowledge_article_id: string | null
  title: string
  description: string | null
  answer_type: 'boolean' | 'text' | 'number' | 'photo' | 'choice'
  is_required: boolean
  requires_photo: boolean
  severity: 'info' | 'normal' | 'warning' | 'critical'
  fine_amount: number | null
  bonus_amount: number | null
  sort_order: number
}

export type PointChecklistAnswer = {
  passed?: boolean
  value?: string | number | boolean | null
  note?: string | null
  photo_data_url?: string | null
  photo_name?: string | null
  photo_captured_at?: string | null
}

export interface PointChecklistRun {
  id: string
  shift_id: string
  template_id: string
  run_by: string | null
  co_signed_by: string | null
  started_at: string
  completed_at: string | null
  scheduled_at: string | null
  status: 'in_progress' | 'completed' | 'skipped' | 'failed'
  responses: Record<string, PointChecklistAnswer>
  fines_total: number | null
  bonuses_total: number | null
}

export interface PointKnowledgeContext {
  company_id: string
  articles: PointKnowledgeArticle[]
  pending_confirmations: PointKnowledgeArticle[]
  checklist_templates: PointChecklistTemplate[]
  checklist_items: PointChecklistItem[]
  checklist_runs: PointChecklistRun[]
  open_shift: {
    id: string
    shift_type: string | null
    opened_at: string | null
    operator_id: string | null
  } | null
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
  issued_at?: string | null
  received_at?: string | null
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
  max_redeem_percent_per_purchase?: number
  is_active: boolean
}

// Arena

export interface ArenaZone {
  id: string
  point_project_id: string
  name: string
  is_active: boolean
  /** ₸ за 60 мин — база для продления по сумме на всех станциях зоны */
  extension_hourly_price?: number | null
  grid_x: number | null
  grid_y: number | null
  grid_w: number | null
  grid_h: number | null
  color: string | null
}

export interface ArenaStation {
  id: string
  point_project_id: string
  zone_id: string | null
  name: string
  order_index: number
  is_active: boolean
  grid_x: number | null
  grid_y: number | null
}

export interface ArenaMapDecoration {
  id: string
  point_project_id: string
  type: string
  grid_x: number
  grid_y: number
  grid_w: number
  grid_h: number
  label: string | null
  rotation: number
  created_at: string
}

export interface ArenaTariff {
  id: string
  point_project_id: string
  zone_id: string | null
  company_id: string | null
  name: string
  duration_minutes: number
  price: number
  is_active: boolean
  tariff_type: 'fixed' | 'time_window'
  /** Начало окна HH:MM; вместе с window_end_time задаёт день/ночь */
  window_start_time: string | null
  window_end_time: string | null
}

export interface ArenaSession {
  id: string
  point_project_id: string
  station_id: string
  tariff_id: string | null
  shift_id?: string | null
  operator_id: string | null
  started_at: string
  ends_at: string
  ended_at: string | null
  amount: number
  status: 'active' | 'completed'
  payment_method: 'cash' | 'kaspi' | 'mixed'
  cash_amount: number
  kaspi_amount: number
  refund_amount?: number
  refund_cash_amount?: number
  refund_kaspi_amount?: number
  refund_at?: string | null
  discount_percent: number
}

// Реквизиты фискального чека ККМ (приказ Минфина РК №626 от 24.10.2025).
// Подгружаются с сервера один раз при логине, кэшируются в localStorage.
export interface PointReceiptSettings {
  tax_payer_name: string
  tax_payer_bin: string
  point_address: string
  kkm_factory_number: string
  kkm_registration_number: string
  is_vat_payer: boolean
  vat_rate: number
  ofd_name: string
  ofd_check_url: string
  receipt_language: 'ru' | 'kk' | 'both'
  receipt_footer_text: string
  require_buyer_iin: boolean
}

// Отложка корзины (parked cart) — локальный черновик чека.
// Хранится в localStorage по ключу parked-carts:${shiftId}, очищается при закрытии смены.
export interface ParkedCart {
  id: string
  label: string
  createdAt: string
  items: Array<{
    id: string
    item_id: string | null
    name: string
    unit?: string | null
    quantity: number
    unit_price: number
    comment?: string | null
  }>
  customer?: { id: string; name: string; phone: string | null } | null
  comment?: string | null
}
