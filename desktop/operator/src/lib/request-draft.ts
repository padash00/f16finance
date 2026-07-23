/**
 * Черновик заявки на склад (per-кассир).
 *
 * Содержимое несданной заявки (позиции + количества + комментарий) живёт
 * в localStorage под одним ключом. Черновик принадлежит конкретному оператору:
 * при загрузке страницы заявки черновик ДРУГОГО оператора молча удаляется
 * (требование: «после смены кассира обнуляется»).
 *
 * Модуль также шлёт событие REQUEST_DRAFT_EVENT — его слушает WorkModeSwitch,
 * чтобы показать точку-индикатор на вкладке «Заявка».
 */

export type RequestDraftItem = {
  item_id: string
  qty: number
  comment: string
}

export type RequestDraft = {
  operator_id: string
  comment: string
  items: RequestDraftItem[]
  updated_at: string
}

const STORAGE_KEY = 'orda:inventory-request-draft:v1'

/** Событие для UI: черновик заявки изменился (появился/обновился/очищен) */
export const REQUEST_DRAFT_EVENT = 'orda:request-draft-changed'

function notifyDraftChanged() {
  try {
    window.dispatchEvent(new CustomEvent(REQUEST_DRAFT_EVENT))
  } catch {
    /* ignore */
  }
}

function readRaw(): RequestDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RequestDraft> | null
    if (!parsed || typeof parsed !== 'object' || !parsed.operator_id) return null
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map((i) => ({
            item_id: String((i as RequestDraftItem)?.item_id || ''),
            qty: Number((i as RequestDraftItem)?.qty || 0),
            comment: String((i as RequestDraftItem)?.comment || ''),
          }))
          .filter((i) => i.item_id && i.qty > 0)
      : []
    return {
      operator_id: String(parsed.operator_id),
      comment: String(parsed.comment || ''),
      items,
      updated_at: String(parsed.updated_at || ''),
    }
  } catch {
    return null
  }
}

function isEmptyDraft(draft: Pick<RequestDraft, 'comment' | 'items'>): boolean {
  return draft.items.length === 0 && !draft.comment.trim()
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  notifyDraftChanged()
}

/**
 * Черновик текущего оператора. Если сохранённый черновик принадлежит другому
 * оператору — молча удаляется и возвращается null.
 */
export function getDraft(operatorId: string): RequestDraft | null {
  const draft = readRaw()
  if (!draft) return null
  if (draft.operator_id !== operatorId) {
    clearDraft()
    return null
  }
  return isEmptyDraft(draft) ? null : draft
}

/** Сохранить черновик (пустой черновик = очистка). */
export function setDraft(operatorId: string, data: { comment: string; items: RequestDraftItem[] }) {
  const draft: RequestDraft = {
    operator_id: operatorId,
    comment: data.comment,
    items: (data.items || []).filter((i) => i.item_id && i.qty > 0),
    updated_at: new Date().toISOString(),
  }
  if (isEmptyDraft(draft)) {
    clearDraft()
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    /* localStorage может быть недоступен — черновик просто не сохранится */
  }
  notifyDraftChanged()
}

/** Есть ли непустой черновик у конкретного оператора. */
export function hasDraft(operatorId: string): boolean {
  const draft = readRaw()
  return !!draft && draft.operator_id === operatorId && !isEmptyDraft(draft)
}

/**
 * Есть ли непустой черновик вообще (без привязки к оператору) — для
 * точки-индикатора на вкладке «Заявка» на экранах, где operator_id недоступен.
 * Черновик чужого оператора живёт лишь до первого открытия страницы заявки.
 */
export function hasAnyDraft(): boolean {
  const draft = readRaw()
  return !!draft && !isEmptyDraft(draft)
}
