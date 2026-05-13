/**
 * Локальные настройки оператора: тема, размер шрифта, звуки.
 * Сохраняются в localStorage. Применяются на root <html> через классы.
 */

export type Theme = 'dark' | 'light' | 'system'
export type FontSize = 'sm' | 'md' | 'lg' | 'xl'

const KEY_THEME = 'orda.theme'
const KEY_FONT = 'orda.fontSize'
const KEY_SOUND = 'orda.soundEnabled'
const KEY_CUSTOMER_DISPLAY = 'orda.customerDisplay'

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const v = window.localStorage.getItem(KEY_THEME)
  return (v === 'light' || v === 'dark' || v === 'system') ? v : 'dark'
}

export function setTheme(theme: Theme) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY_THEME, theme)
  applyTheme()
}

export function applyTheme() {
  if (typeof window === 'undefined') return
  const theme = getTheme()
  const html = document.documentElement
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (isDark) html.classList.add('dark')
  else html.classList.remove('dark')
}

export function getFontSize(): FontSize {
  if (typeof window === 'undefined') return 'md'
  const v = window.localStorage.getItem(KEY_FONT)
  return (v === 'sm' || v === 'md' || v === 'lg' || v === 'xl') ? v : 'md'
}

export function setFontSize(size: FontSize) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY_FONT, size)
  applyFontSize()
}

export function applyFontSize() {
  if (typeof window === 'undefined') return
  const size = getFontSize()
  const html = document.documentElement
  // px на root — Tailwind использует rem относительно
  const sizeMap: Record<FontSize, string> = {
    sm: '14px',
    md: '16px',
    lg: '18px',
    xl: '20px',
  }
  html.style.fontSize = sizeMap[size]
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true
  const v = window.localStorage.getItem(KEY_SOUND)
  return v !== '0'  // По умолчанию включено
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY_SOUND, enabled ? '1' : '0')
}

export function isCustomerDisplayEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(KEY_CUSTOMER_DISPLAY) === '1'
}

export function setCustomerDisplayEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY_CUSTOMER_DISPLAY, enabled ? '1' : '0')
}

/** Применить все настройки при старте программы */
export function applyAllPreferences() {
  applyTheme()
  applyFontSize()
  // Customer display — открыть второе окно если включено в настройках и есть внешний монитор
  if (typeof window !== 'undefined' && isCustomerDisplayEnabled()) {
    try {
      void window.electron?.customerDisplay?.open?.()
    } catch { /* ignore */ }
  }
}
