'use client'

/**
 * Показывать длинный список порциями.
 *
 *   const rows = useVisibleSlice(filtered, search)
 *   rows.visible.map(...)
 *   {rows.hasMore && <button onClick={rows.showMore}>Показать ещё</button>}
 *
 * Зачем: склад и витрина рисуют весь каталог точки сразу, и дважды — карточками
 * для телефона и таблицей для десктопа. На тысяче позиций это несколько тысяч
 * узлов, которые пересобираются на каждую букву в поиске.
 *
 * `resetKey` — то, при смене чего список начинается заново (строка поиска,
 * выбранная точка): иначе после нового поиска остаётся раскрытый «хвост»
 * от прошлого.
 */

import { useEffect, useMemo, useState } from 'react'

export function useVisibleSlice<T>(rows: T[], resetKey: unknown, step = 100) {
  const [limit, setLimit] = useState(step)

  useEffect(() => { setLimit(step) }, [resetKey, step])

  const visible = useMemo(() => (rows.length <= limit ? rows : rows.slice(0, limit)), [rows, limit])

  return {
    visible,
    shown: visible.length,
    total: rows.length,
    hasMore: rows.length > limit,
    showMore: () => setLimit((value) => value + step),
    showAll: () => setLimit(Number.MAX_SAFE_INTEGER),
  }
}
