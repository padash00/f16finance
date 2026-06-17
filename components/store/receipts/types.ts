export type InventoryLocation = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
}

export type InventorySupplier = {
  id: string
  name: string
  bin_iin: string | null
  organization_name: string | null
  preferred_expense_category_id?: string | null
}

export type ExpenseCategoryOption = {
  id: string
  name: string
  accounting_group: string
}

export type InventoryItem = {
  id: string
  name: string
  barcode: string
  unit: string
  sale_price: number
  default_purchase_price: number
  item_type: string
  requires_expiry?: boolean | null
  category?: { id: string; name: string } | null
}

export type InventoryReceipt = {
  id: string
  received_at: string
  total_amount: number
  invoice_number: string | null
  invoice_file_url: string | null
  comment: string | null
  status: 'posted' | 'cancelled'
  kind: 'supplier' | 'posting'
  cancelled_at: string | null
  cancel_reason: string | null
  supplier?: InventorySupplier | null
  location?: InventoryLocation | null
  items?: Array<{
    id: string
    quantity: number
    unit_cost: number
    total_cost: number
    is_bonus?: boolean
    item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  }>
}

export type InventoryReceiptDraft = {
  id: string
  title: string | null
  payload: {
    location_id?: string | null
    supplier_id?: string | null
    supplier_create?: {
      name?: string
      organization_name?: string
      bin_iin?: string
    } | null
    received_at?: string | null
    invoice_number?: string | null
    invoice_file_url?: string | null
    expense_category_id?: string | null
    payment_method?: 'cash' | 'kaspi' | null
    comment?: string | null
    items?: Array<{
      item_id?: string
      quantity?: number | string
      unit_cost?: number | string
      sale_price?: number | string
      is_bonus?: boolean
      comment?: string | null
    }>
  }
  status: string
  created_at: string
  updated_at: string
}

export type ReceiptsResponse = {
  ok: boolean
  data?: {
    items: InventoryItem[]
    suppliers: InventorySupplier[]
    locations: InventoryLocation[]
    receipts: InventoryReceipt[]
    drafts?: InventoryReceiptDraft[]
    expense_categories?: ExpenseCategoryOption[]
  }
  error?: string
}

export type ReceiptLine = {
  uid: string
  item_id: string
  quantity: string
  unit_cost: string
  sale_price: string
  markup_percent: string
  comment: string
  is_bonus?: boolean
  invoice_name?: string
  last_unit_cost?: number | null
  production_date?: string
  expiry_date?: string
  /** Возврат/недопоставка по этой строке (кол-во) — для сверки с накладной. */
  return_qty?: string
}

export type AiParseItem = {
  invoice_name: string
  quantity: number
  unit_cost: number
  total_cost: number
  barcode: string | null
  matched_item_id: string | null
  matched_item_name: string | null
  match_source: 'barcode' | 'mapping' | 'mapping_supplier' | 'mapping_global' | 'gpt' | null
  last_unit_cost?: number | null
  last_sale_price?: number | null
  unit_cost_change_pct?: number | null
  manual_item_id?: string | null
}

export type AiParseResult = {
  supplier_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  raw_text: string | null
  total_amount: number
  matched_count: number
  unmatched_count: number
  cogs_suggestion?: {
    recommended_category_id: string | null
    recommended_category_name: string | null
    reason: string | null
    confidence?: 'high' | 'medium' | 'low' | null
    alternatives?: Array<{ id: string; name: string }>
  } | null
  items: AiParseItem[]
}

export type DebtSummary = {
  status: 'open' | 'paid' | 'written_off'
  total_amount: number
  due_date: string | null
  is_consignment: boolean
}
