'use client'

/**
 * Переключение темы.
 *
 * Здесь была анимация распада страницы в пыль. Её убрали, и это осознанное
 * решение, а не недоделка.
 *
 * Что пробовали и почему каждый раз не годилось:
 *
 *   * CSS-маска поверх снимка View Transitions — даёт скол, а не летящие
 *     крупинки: маска умеет только убирать область;
 *   * растеризация страницы, чтобы крупинки знали цвет пикселя под собой —
 *     единственный способ сделать это в браузере обходит весь DOM и вписывает
 *     стили в каждый узел, а это блокировка главного потока на секунды:
 *     портал замирает целиком;
 *   * снимок заранее — блокировка никуда не делась, просто стала случайной;
 *   * два десятка полноэкранных холстов — сотни мегабайт в композиторе и
 *     подвисание на каждом кадре;
 *   * снимок браузера с ручной анимацией — при перерисовке React страница
 *     уходила в пустой экран.
 *
 * Общий итог простой: красивый распад на странице из тысяч узлов стоит либо
 * отзывчивости, либо надёжности. Переключатель темы этого не стоит.
 *
 * Плавность осталась там, где ей и место, — в CSS: цвета переходят по
 * transition, без снимков и холстов. Сама тема меняется мгновенно.
 */

import { useCallback } from 'react'
import { useTheme } from 'next-themes'

/** Точка нажатия. Сохранена в сигнатуре: её передают вызывающие. */
export type SweepOrigin = { x: number; y: number }

export function useThemeSweep() {
  const { resolvedTheme, setTheme } = useTheme()

  const sweepTo = useCallback(
    (next: 'light' | 'dark', _origin?: SweepOrigin) => {
      setTheme(next)
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

/** Центр нажатой кнопки. Оставлен ради совместимости вызовов. */
export function originOfEvent(event: { currentTarget: EventTarget | null }): SweepOrigin | undefined {
  const el = event.currentTarget as HTMLElement | null
  if (!el || typeof el.getBoundingClientRect !== 'function') return undefined
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
