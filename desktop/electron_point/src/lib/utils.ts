import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(amount: number | null | undefined): string {
  if (!amount) return '0 ₸'
  return Math.round(amount).toLocaleString('ru-RU') + ' ₸'
}

export function parseMoney(value: string | null | undefined): number {
  if (!value) return 0
  const raw = String(value).trim()
  const negative = raw.startsWith('-')
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  if (isNaN(n)) return 0
  const rounded = Math.round(n)
  return negative ? -rounded : rounded
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function localRef(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function weekStart(dateISO?: string): string {
  const base = dateISO ? new Date(dateISO) : new Date()
  const copy = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()))
  const day = copy.getUTCDay()
  const offset = day === 0 ? -6 : 1 - day
  copy.setUTCDate(copy.getUTCDate() + offset)
  return copy.toISOString().slice(0, 10)
}
