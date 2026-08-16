'use client'

/**
 * Тема по времени суток.
 *
 * Работает как на маке: днём светлая, вечером тёмная, переход плавный. Но
 * включается только вручную — в профиле. Портал, самовольно меняющий цвет под
 * человеком, который его не просил, воспринимается как поломка, а не как
 * забота.
 *
 * Ручное переключение всегда сильнее расписания и до конца суток: если человек
 * в семь вечера включил светлую, значит ему сейчас так надо, и спорить с ним
 * не надо. На следующий день расписание снова вступает в силу.
 */

import { useEffect, useRef } from 'react'

import { useThemeSweep } from '@/lib/hooks/use-theme-sweep'

/** Ключи в localStorage: настройка живёт на устройстве, как и сама тема. */
export const AUTO_THEME_KEY = 'orda-auto-theme'
const OVERRIDE_KEY = 'orda-auto-theme-override'

/**
 * Границы светлого времени.
 *
 * Фиксированные часы, а не восход и закат: астрономический закат в Казахстане
 * летом почти в десять вечера, и портал оставался бы светлым весь рабочий
 * вечер. Здесь важен не астрономический день, а рабочий.
 */
export const LIGHT_FROM_HOUR = 7
export const LIGHT_TO_HOUR = 19

export function scheduledTheme(now: Date = new Date()): 'light' | 'dark' {
  const hour = now.getHours()
  return hour >= LIGHT_FROM_HOUR && hour < LIGHT_TO_HOUR ? 'light' : 'dark'
}

export function isAutoThemeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(AUTO_THEME_KEY) === '1'
}

export function setAutoThemeEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AUTO_THEME_KEY, enabled ? '1' : '0')
  // Включили заново — прошлое ручное решение больше не действует.
  if (enabled) window.localStorage.removeItem(OVERRIDE_KEY)
}

/** Сегодняшняя дата как ключ: ручное решение действует до конца суток. */
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function rememberManualChoice() {
  if (typeof window === 'undefined') return
  if (!isAutoThemeEnabled()) return
  window.localStorage.setItem(OVERRIDE_KEY, todayKey())
}

function hasManualChoiceToday(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(OVERRIDE_KEY) === todayKey()
}

/**
 * Следит за временем и переключает тему.
 *
 * Проверка раз в минуту, а не по таймеру до следующей границы: ноутбук
 * закрывают и открывают, и таймер, поставленный на восемь часов вперёд,
 * срабатывает неизвестно когда.
 */
export function AutoTheme() {
  const { resolvedTheme, sweepTo } = useThemeSweep()
  const lastApplied = useRef<'light' | 'dark' | null>(null)

  useEffect(() => {
    const tick = () => {
      if (!isAutoThemeEnabled()) return
      if (hasManualChoiceToday()) return

      const wanted = scheduledTheme()
      // Сравниваем и с текущей темой, и с тем, что применяли сами: иначе
      // после ручного переключения обратно шторка сработает дважды.
      if (wanted === resolvedTheme || wanted === lastApplied.current) return

      lastApplied.current = wanted
      sweepTo(wanted)
    }

    tick()
    const timer = window.setInterval(tick, 60_000)
    // Вкладку возвращают из фона — время могло уйти далеко вперёд.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [resolvedTheme, sweepTo])

  return null
}
