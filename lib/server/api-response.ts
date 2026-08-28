import 'server-only'

import { NextResponse } from 'next/server'

/**
 * Ответ API одной строкой. Тридцать пять роутов раздела «Магазин» держали
 * собственную копию этой функции — одинаковую до символа.
 */
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}
