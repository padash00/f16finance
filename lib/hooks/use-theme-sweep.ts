'use client'

/**
 * Смена темы с распадом страницы в пыль.
 *
 * Порядок важен и именно такой:
 *
 *   1. снимаем страницу и раскладываем её пиксели по слоям крупинок;
 *   2. кладём слои поверх — экран выглядит ровно как был;
 *   3. переключаем тему под ними, этого не видно;
 *   4. крупинки уносит, и под ними оказывается новая тема.
 *
 * View Transitions здесь не участвуют: они делают свой снимок старого экрана,
 * и вместе с нашим он получился бы дважды. Заодно ушла возможность застрять —
 * раньше незавершённый переход оставлял снимок поверх портала.
 *
 * Если снимок сделать не удалось (чужая картинка на странице, старый браузер),
 * тема переключается мгновенно. Эффект — украшение, функция важнее.
 */

import { useCallback } from 'react'
import { useTheme } from 'next-themes'

import { dustColorsOf, runThemeDust } from './theme-dust-canvas'

/** Откуда расходится распад. По умолчанию — правый верхний угол. */
export type SweepOrigin = { x: number; y: number }

/** Длительность распада. Быстрее — читается как моргание, а не как распад. */
const DUST_MS = 1600

/** Идёт ли распад прямо сейчас: два одновременно дали бы кашу из слоёв. */
let running = false

function canAnimate(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLElement.prototype.animate === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function useThemeSweep() {
  const { resolvedTheme, setTheme } = useTheme()

  const sweepTo = useCallback(
    (next: 'light' | 'dark', origin?: SweepOrigin) => {
      if (!canAnimate() || running) {
        setTheme(next)
        return
      }

      running = true
      const leaving = resolvedTheme === 'light' ? 'light' : 'dark'
      const originPoint = {
        x: origin?.x ?? window.innerWidth - 48,
        y: origin?.y ?? 40,
      }

      runThemeDust({
        origin: originPoint,
        duration: DUST_MS,
        fallbackColors: dustColorsOf(leaving),
        // Тема меняется под уже разложенными крупинками: в этот момент экран
        // закрыт копией старой страницы, и подмены не видно.
        onCovered: () => setTheme(next),
      })
        .catch(() => {
          // Снимок не удался — тема всё равно должна переключиться.
          setTheme(next)
        })
        .finally(() => {
          running = false
        })
    },
    [resolvedTheme, setTheme],
  )

  const toggle = useCallback(
    (origin?: SweepOrigin) => {
      sweepTo(resolvedTheme === 'light' ? 'dark' : 'light', origin)
    },
    [resolvedTheme, sweepTo],
  )

  return { resolvedTheme, sweepTo, toggle }
}

/** Центр элемента, по которому нажали, — точка старта распада. */
export function originOfEvent(event: { currentTarget: EventTarget | null }): SweepOrigin | undefined {
  const el = event.currentTarget as HTMLElement | null
  if (!el || typeof el.getBoundingClientRect !== 'function') return undefined
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
