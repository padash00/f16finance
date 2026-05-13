import type { ParkedCart } from '@/types'

/**
 * Отложка корзины — локальный черновик чека до конца смены.
 *
 * Хранилище: localStorage по ключу parked-carts:${companyId}:${date}:${shift}.
 * Очищается:
 *   - при закрытии смены (ShiftPage.closePointShift)
 *   - при восстановлении отложки в корзину (отложка одноразовая)
 *   - вручную крестиком из выпадающего списка
 *
 * Не переживает смену суток / смены оператора по факту, потому что ключ зависит от даты и смены.
 */

const KEY_PREFIX = 'parked-carts'

function buildKey(companyId: string, date: string, shift: 'day' | 'night') {
  return `${KEY_PREFIX}:${companyId}:${date}:${shift}`
}

function safeParse(raw: string | null): ParkedCart[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ParkedCart[]) : []
  } catch {
    return []
  }
}

export function loadParkedCarts(params: {
  companyId: string
  date: string
  shift: 'day' | 'night'
}): ParkedCart[] {
  if (typeof window === 'undefined') return []
  return safeParse(window.localStorage.getItem(buildKey(params.companyId, params.date, params.shift)))
}

export function saveParkedCart(params: {
  companyId: string
  date: string
  shift: 'day' | 'night'
  cart: ParkedCart
}): ParkedCart[] {
  const list = loadParkedCarts(params)
  const next = [params.cart, ...list]
  window.localStorage.setItem(buildKey(params.companyId, params.date, params.shift), JSON.stringify(next))
  return next
}

export function deleteParkedCart(params: {
  companyId: string
  date: string
  shift: 'day' | 'night'
  id: string
}): ParkedCart[] {
  const list = loadParkedCarts(params)
  const next = list.filter((c) => c.id !== params.id)
  window.localStorage.setItem(buildKey(params.companyId, params.date, params.shift), JSON.stringify(next))
  return next
}

export function clearParkedCarts(params: {
  companyId: string
  date: string
  shift: 'day' | 'night'
}) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(buildKey(params.companyId, params.date, params.shift))
}
