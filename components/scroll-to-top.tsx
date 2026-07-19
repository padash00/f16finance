'use client'

/**
 * Плавающая кнопка «↑ Наверх»: появляется после прокрутки на ~2 экрана.
 * Монтируется один раз в app/(main)/layout.tsx. Скролл-контейнер портала —
 * сам .app-main либо window (мобила) — слушаем оба.
 */

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

export function ScrollToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.app-main')
    const check = () => {
      const winY = window.scrollY
      const mainY = main?.scrollTop || 0
      setVisible(winY > 900 || mainY > 900)
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    main?.addEventListener('scroll', check, { passive: true })
    return () => {
      window.removeEventListener('scroll', check)
      main?.removeEventListener('scroll', check)
    }
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      aria-label="Наверх"
      onClick={() => {
        document.querySelector<HTMLElement>('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }}
      className="fixed bottom-20 right-4 z-40 grid h-11 w-11 place-items-center rounded-full border border-border bg-white/90 text-foreground shadow-lg backdrop-blur transition hover:bg-white dark:bg-slate-900/90 dark:hover:bg-slate-900 sm:bottom-24 sm:right-7"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  )
}
