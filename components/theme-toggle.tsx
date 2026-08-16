'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

import { rememberManualChoice } from '@/components/auto-theme'
import { prewarmThemeDust } from '@/lib/hooks/theme-dust-canvas'
import { originOfEvent, useThemeSweep } from '@/lib/hooks/use-theme-sweep'

// Переключатель светлая/тёмная тема. Использует next-themes (класс на <html>).
// mounted-гард — чтобы не было рассинхрона SSR/CSR (тема известна только на клиенте).
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, sweepTo } = useThemeSweep()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = mounted ? resolvedTheme !== 'light' : true

  return (
    <button
      type="button"
      aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
      // Снимок готовится, пока курсор идёт к кнопке: после нажатия на него
      // уже не будет времени, а пауза перед распадом читается как тормоза.
      onPointerEnter={() => prewarmThemeDust()}
      onFocus={() => prewarmThemeDust()}
      onClick={(event) => {
        // Ручной выбор сильнее расписания до конца суток: раз человек нажал,
        // значит ему сейчас так надо.
        rememberManualChoice()
        sweepTo(isDark ? 'light' : 'dark', originOfEvent(event))
      }}
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
