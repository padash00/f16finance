'use client'

/**
 * Смена темы с распадом.
 *
 * Собрано из двух вещей, и обе бесплатны по времени.
 *
 * Страница уходит снимком, который делает сам браузер (View Transitions). Это
 * мгновенно: снимок берётся из уже отрисованного кадра, ничего не
 * растеризуется. Дальше снимок уводит CSS-маска — фронтом от кнопки.
 *
 * Поверх летят крупинки — холсты с частицами. Их рисует
 * `theme-dust-canvas`.
 *
 * Чего здесь принципиально нет: растеризации страницы. Чтобы крупинки знали
 * цвет пикселя под собой, DOM пришлось бы обойти целиком и вписать стили в
 * каждый узел — это многосекундная блокировка главного потока, портал замирает
 * и кнопки не нажимаются. Такой ценой эффект не нужен.
 *
 * Тема переключается синхронно, в том же кадре, что и нажатие. Анимация её
 * никогда не ждёт.
 */

import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useTheme } from 'next-themes'

import { dustColorsOf, runThemeDust } from './theme-dust-canvas'

/** Откуда расходится распад. По умолчанию — правый верхний угол. */
export type SweepOrigin = { x: number; y: number }

/** Длительность распада. Быстрее — читается как моргание, а не как распад. */
const DUST_MS = 1100

/** Класс на <html> на время перехода — по нему CSS выбирает анимацию. */
const SWEEP_CLASS = 'theme-sweep'

/** Идёт ли распад прямо сейчас: два одновременно дали бы кашу. */
let running = false

function canAnimate(): boolean {
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

      const root = document.documentElement
      root.style.setProperty('--sweep-x', `${originPoint.x}px`)
      root.style.setProperty('--sweep-y', `${originPoint.y}px`)
      root.classList.add(SWEEP_CLASS)

      const cleanup = () => {
        root.classList.remove(SWEEP_CLASS)
        root.style.removeProperty('--sweep-x')
        root.style.removeProperty('--sweep-y')
        running = false
      }

      const transition = (document as any).startViewTransition(() => {
        // Синхронно: браузер снимает новый кадр сразу после колбэка, а обычный
        // setState React применить не успел бы — переход снял бы старую тему
        // как новую.
        flushSync(() => setTheme(next))
      })

      // Крупинки запускаются, когда оба кадра уже сняты: раньше они попали бы
      // в снимок и застыли бы на нём картинкой.
      transition.ready
        .then(() => runThemeDust({ origin: originPoint, duration: DUST_MS, colors: dustColorsOf(leaving) }))
        .catch(() => {
          /* переход прерван — крупинки не нужны */
        })

      // Страховка: незавершённый переход оставил бы снимок поверх портала.
      const guard = window.setTimeout(cleanup, DUST_MS + 1500)

      transition.finished
        .catch(() => {
          /* прерванный переход — не ошибка: человек нажал ещё раз */
        })
        .finally(() => {
          window.clearTimeout(guard)
          cleanup()
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
