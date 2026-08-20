'use client'

import { useEffect, useState } from 'react'

/**
 * Сегодняшняя дата — после гидрации, а не при отрисовке.
 *
 * Страницы админки готовятся заранее, во время сборки. Если «сегодня»
 * вычисляется прямо в теле компонента, оно попадает в готовый HTML как день
 * сборки: браузер рисует настоящую дату, разметка расходится, и React
 * выбрасывает ошибку гидрации. На мониторе продаж это случалось восемнадцать
 * раз за две недели — страница мигала, а в журнале лежал нечитаемый
 * «Minified React error #418».
 *
 * Пустая строка до гидрации означает «дата ещё не известна»: и заранее
 * отрисованный HTML, и первый кадр браузера показывают одно и то же. Поэтому
 * всё, что зависит от даты — запросы, пресеты периода, — должно ждать
 * непустого значения.
 *
 *   const today = useToday()
 *   const [from, setFrom] = useState('')
 *   useEffect(() => { if (today) setFrom(today) }, [today])
 *
 * `timeZone` — когда «сегодня» считается по часам точки, а не браузера.
 */
export function useToday(timeZone?: string): string {
  const [today, setToday] = useState('')

  useEffect(() => {
    const now = new Date()
    setToday(
      timeZone
        ? now.toLocaleDateString('en-CA', { timeZone })
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    )
  }, [timeZone])

  return today
}
