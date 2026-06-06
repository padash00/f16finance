import 'server-only'
import { safeEqual } from '@/lib/server/safe-equal'

/**
 * Проверка, что запрос пришёл от планировщика (Vercel Cron) или авторизованного
 * вызова. Секрет берётся из CRON_SECRET.
 *
 * Vercel при заданном CRON_SECRET шлёт `Authorization: Bearer <CRON_SECRET>`.
 * Также принимаем `x-cron-secret` заголовок и `?secret=` (для ручного запуска).
 *
 * Fail-CLOSED: если CRON_SECRET не задан — запрещаем (раньше при пустом секрете
 * эндпоинты были открыты). User-Agent `vercel-cron` больше НЕ принимается как
 * доказательство (его легко подделать).
 */
export function verifyCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const url = new URL(request.url)
  const authHeader = request.headers.get('authorization') || ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  const headerSecret = (request.headers.get('x-cron-secret') || '').trim()
  const querySecret = (url.searchParams.get('secret') || '').trim()

  return safeEqual(bearer, cronSecret) || safeEqual(headerSecret, cronSecret) || safeEqual(querySecret, cronSecret)
}
