'use client'

/**
 * Настройка темы в профиле.
 *
 * Две вещи, которые человек должен решать сам: какая тема сейчас и переключать
 * ли её по времени. Автопереключение выключено по умолчанию — портал,
 * самовольно меняющий цвет под человеком, который его не просил, читается как
 * поломка, а не как забота.
 *
 * Настройка живёт на устройстве, рядом с самой темой: за рабочим компьютером и
 * с телефона удобно по-разному, и тащить это в общий профиль незачем.
 */

import { useEffect, useState } from 'react'
import { Moon, Sun, SunMoon } from 'lucide-react'

import {
  LIGHT_FROM_HOUR,
  LIGHT_TO_HOUR,
  isAutoThemeEnabled,
  rememberManualChoice,
  scheduledTheme,
  setAutoThemeEnabled,
} from '@/components/auto-theme'
import { Card } from '@/components/ui/card'
import { prewarmThemeDust } from '@/lib/hooks/theme-dust-canvas'
import { originOfEvent, useThemeSweep } from '@/lib/hooks/use-theme-sweep'

export function ThemeCard() {
  const { resolvedTheme, sweepTo } = useThemeSweep()
  const [mounted, setMounted] = useState(false)
  const [auto, setAuto] = useState(false)

  // Тема и настройка известны только на клиенте: на сервере их нет, и рендер
  // без этого гарда даёт рассинхрон.
  useEffect(() => {
    setMounted(true)
    setAuto(isAutoThemeEnabled())
  }, [])

  const isDark = mounted ? resolvedTheme !== 'light' : true

  function choose(next: 'light' | 'dark', event: React.MouseEvent<HTMLButtonElement>) {
    rememberManualChoice()
    sweepTo(next, originOfEvent(event))
  }

  function toggleAuto(next: boolean) {
    setAuto(next)
    setAutoThemeEnabled(next)
    // Включили — сразу приводим тему к расписанию, иначе настройка выглядит
    // сломанной до следующего часа.
    if (next) {
      const wanted = scheduledTheme()
      if (wanted !== resolvedTheme) sweepTo(wanted)
    }
  }

  return (
    <Card className="border-border bg-white p-6 text-foreground dark:bg-slate-950/70">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10">
          <SunMoon className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Тема</h2>
          <p className="text-xs text-muted-foreground">Настройка сохраняется на этом устройстве</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['light', 'Светлая', <Sun key="s" className="h-4 w-4" />],
            ['dark', 'Тёмная', <Moon key="m" className="h-4 w-4" />],
          ] as const
        ).map(([value, label, icon]) => {
          const active = mounted && (value === 'dark') === isDark
          return (
            <button
              key={value}
              type="button"
              onPointerEnter={() => prewarmThemeDust()}
              onClick={(event) => choose(value, event)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
                active
                  ? 'border-border bg-surface-hover text-foreground shadow-sm'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {icon}
              {label}
            </button>
          )
        })}
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-surface-muted p-3.5 transition hover:bg-surface-hover">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => toggleAuto(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border text-violet-600"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Менять тему по времени</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            Светлая с {LIGHT_FROM_HOUR}:00 до {LIGHT_TO_HOUR}:00, дальше тёмная. Часы взяты рабочие, а не
            астрономические: летом здесь темнеет к десяти вечера, и портал оставался бы светлым весь
            вечер.
          </span>
          <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
            Переключили руками — расписание не спорит до конца суток. Завтра оно снова вступит в силу.
          </span>
        </span>
      </label>
    </Card>
  )
}
