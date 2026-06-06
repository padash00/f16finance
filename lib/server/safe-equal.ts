import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/**
 * Сравнение строк за постоянное время — защита от timing-атак при проверке
 * секретов (webhook-токены, cron-секреты, device-хэши). Обычный `===`
 * завершается на первом несовпавшем символе, что теоретически утекает секрет
 * по времени ответа.
 *
 * Разная длина → сразу false (длина секрета не является секретом).
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
