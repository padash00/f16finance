import type { InventoryReceipt, ReceiptLine } from '@/components/store/receipts/types'

export function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T) || null
  return value ?? null
}

export function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export function normalizeReceipt(raw: any): InventoryReceipt {
  return {
    id: String(raw?.id || ''),
    received_at: raw?.received_at || '',
    total_amount: Number(raw?.total_amount || 0),
    invoice_number: raw?.invoice_number || null,
    invoice_file_url: raw?.invoice_file_url || null,
    comment: raw?.comment || null,
    status: raw?.status === 'cancelled' ? 'cancelled' : 'posted',
    kind: raw?.kind === 'posting' ? 'posting' : 'supplier',
    cancelled_at: raw?.cancelled_at || null,
    cancel_reason: raw?.cancel_reason || null,
    supplier: firstOrSelf(raw?.supplier),
    location: firstOrSelf(raw?.location),
    items: asArray(raw?.items).map((item: any) => ({
      id: String(item?.id || ''),
      quantity: Number(item?.quantity || 0),
      unit_cost: Number(item?.unit_cost || 0),
      total_cost: Number(item?.total_cost || 0),
      is_bonus: Boolean(item?.is_bonus),
      item: firstOrSelf(item?.item),
    })),
  }
}

export function parseMoney(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

export function parseUnitCost(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000
}

export function parseQty(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 1000) / 1000
}

export function formatUnitCost(value: number) {
  const normalized = Number(value || 0)
  if (!Number.isFinite(normalized)) return '0 ₸'
  const hasFraction = Math.abs(normalized - Math.round(normalized)) > 0.00001
  return `${normalized.toLocaleString('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 4,
  })} ₸`
}

export function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}

export function calcMarkupPercent(unitCostRaw: string, salePriceRaw: string) {
  const unitCost = parseUnitCost(unitCostRaw)
  const salePrice = parseMoney(salePriceRaw)
  if (unitCost <= 0) return ''
  const pct = ((salePrice - unitCost) / unitCost) * 100
  if (!Number.isFinite(pct)) return ''
  return String(Math.round((pct + Number.EPSILON) * 100) / 100)
}

let lineUidCounter = 0
export function nextLineUid(): string {
  lineUidCounter += 1
  return `ln_${Date.now().toString(36)}_${lineUidCounter}`
}

export function emptyLine(): ReceiptLine {
  return {
    uid: nextLineUid(),
    item_id: '',
    quantity: '',
    unit_cost: '',
    sale_price: '',
    markup_percent: '',
    comment: '',
    is_bonus: false,
  }
}
