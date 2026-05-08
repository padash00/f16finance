/**
 * Применяет брендинг компании к UI:
 * — основной цвет → CSS переменные --brand-*
 * — логотип → доступен через getBrandLogoUrl()
 *
 * Цвет должен быть hex (#RRGGBB или #RGB).
 * Если brand_color не задан — используется дефолт (emerald).
 */

const DEFAULT_BRAND = {
  hex: '#10b981', // emerald-500
  hexDark: '#059669', // emerald-600
}

let currentLogoUrl: string | null = null

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{3}|[a-f\d]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function darken(hex: string, amount = 0.15): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const d = rgb.map((v) => Math.max(0, Math.round(v * (1 - amount))))
  return '#' + d.map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function applyBranding(brandColor: string | null | undefined, brandLogoUrl: string | null | undefined) {
  const root = document.documentElement
  const color = brandColor && hexToRgb(brandColor) ? brandColor : DEFAULT_BRAND.hex
  const colorDark = darken(color, 0.15)
  const rgb = hexToRgb(color)!

  root.style.setProperty('--brand-color', color)
  root.style.setProperty('--brand-color-dark', colorDark)
  root.style.setProperty('--brand-rgb', rgb.join(','))
  root.style.setProperty('--brand-shadow', `${rgb.join(',')}/0.30`)

  currentLogoUrl = brandLogoUrl?.trim() || null
}

export function getBrandLogoUrl(): string | null {
  return currentLogoUrl
}

export function resetBranding() {
  applyBranding(null, null)
}
