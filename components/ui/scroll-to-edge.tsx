'use client'

/**
 * Кнопка «в конец / в начало» для длинных страниц.
 *
 * На страницах с большой таблицей (смены за месяц — это сотни строк) колесо
 * мыши превращается в работу: чтобы вернуться к фильтрам, надо прокрутить всё
 * обратно. Кнопка держится в углу и меняет направление сама: пока вы наверху —
 * зовёт вниз, стоит отъехать — предлагает вернуться.
 *
 * Появляется только когда прокручивать действительно есть что: на короткой
 * странице она была бы мусором в углу.
 */

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'

/** Ниже этого порога считаем, что страница помещается на экран. */
const MIN_SCROLLABLE_PX = 600

export function ScrollToEdge() {
  const [visible, setVisible] = useState(false)
  const [atTop, setAtTop] = useState(true)

  useEffect(() => {
    const update = () => {
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - window.innerHeight
      setVisible(scrollable > MIN_SCROLLABLE_PX)
      // «Наверху» — это не строго ноль: пара сотен пикселей ещё не повод
      // предлагать вернуться туда, где человек и так стоит.
      setAtTop(window.scrollY < scrollable / 2)
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      aria-label={atTop ? 'В конец страницы' : 'В начало страницы'}
      title={atTop ? 'В конец страницы' : 'В начало страницы'}
      onClick={() =>
        window.scrollTo({
          top: atTop ? document.documentElement.scrollHeight : 0,
          behavior: 'smooth',
        })
      }
      className="fixed bottom-6 right-6 z-40 grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-lg transition-colors hover:text-foreground"
    >
      {atTop ? <ArrowDown className="h-5 w-5" /> : <ArrowUp className="h-5 w-5" />}
    </button>
  )
}
