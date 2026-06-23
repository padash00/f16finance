'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

// Переключатель светлая/тёмная тема. Использует next-themes (класс на <html>).
// mounted-гард — чтобы не было рассинхрона SSR/CSR (тема известна только на клиенте).
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = mounted ? resolvedTheme !== 'light' : true

  return (
    <button
      type="button"
      aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={
        className ??
        'inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted'
      }
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span>{isDark ? 'Светлая' : 'Тёмная'}</span>
    </button>
  )
}
