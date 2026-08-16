'use client'

/**
 * Смена темы с распадом старого экрана в пыль.
 *
 * Обычное переключение классом моргает: половина экрана уже тёмная, половина
 * ещё светлая, и глаз ловит это как сбой. View Transitions делают снимок
 * старого экрана и кладут поверх нового — снимок можно рассыпать, и переход
 * становится цельным.
 *
 * Сама анимация живёт в CSS (`orda-theme-dust-*`): здесь только запуск и
 * направление. Где API нет (Safari до 18, Firefox), тема меняется мгновенно —
 * функция работает, эффекта нет.
 */

import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useTheme } from 'next-themes'

/** Класс на <html> на время перехода — по нему CSS выбирает нужную анимацию. */
const SWEEP_CLASS = 'theme-sweep'

/** Откуда расходится распад. По умолчанию — правый верхний угол. */
export type SweepOrigin = { x: number; y: number }

function supportsViewTransition(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (document as any).startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function useThemeSweep() {
  const { resolvedTheme, setTheme } = useTheme()

  const sweepTo = useCallback(
    (next: 'light' | 'dark', origin?: SweepOrigin) => {
      if (!supportsViewTransition()) {
        setTheme(next)
        return
      }

      const root = document.documentElement
      // Распад расходится от кнопки, по которой нажали: движение начинается
      // там, где был палец, и переход читается как следствие нажатия, а не
      // как самостоятельное событие.
      root.style.setProperty('--sweep-x', `${origin?.x ?? window.innerWidth - 48}px`)
      root.style.setProperty('--sweep-y', `${origin?.y ?? 40}px`)
      root.classList.add(SWEEP_CLASS)

      const cleanup = () => {
        root.classList.remove(SWEEP_CLASS)
        root.style.removeProperty('--sweep-x')
        root.style.removeProperty('--sweep-y')
      }

      const transition = (document as any).startViewTransition(() => {
        // Синхронно: браузер снимает новый кадр сразу после колбэка, а
        // обычный setState React ещё не успел бы примениться — переход снял
        // бы старую тему как новую.
        flushSync(() => setTheme(next))
      })

      // Страховка. Если переход почему-то не завершится, класс останется на
      // <html>, а вместе с ним — снимок старой темы с маской поверх всей
      // страницы. Это выглядит как поломка портала, поэтому чистим по таймеру
      // в любом случае.
      const guard = window.setTimeout(cleanup, 3500)

      transition.finished
        .catch(() => {
          /* прерванный переход — не ошибка: человек нажал ещё раз */
        })
        .finally(() => {
          window.clearTimeout(guard)
          cleanup()
        })
    },
    [setTheme],
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
