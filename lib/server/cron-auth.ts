import 'server-only'
import { safeEqual } from '@/lib/server/safe-equal'

/**
 * Проверка, что запрос пришёл от планировщика (Vercel Cron) или авторизованного
 * вызова. Секрет берётся из CRON_SECRET.
 *
 * Vercel при заданном CRON_SECRET шлёт `Authorization: Bearer <CRON_SECRET>`.
 * Также принимаем заголовок `x-cron-secret` (для ручного запуска).
 *
 * Только заголовки: `?secret=` в строке запроса больше не принимается —
 * query попадает в логи доступа Vercel, в реферер и в историю браузера, то есть
 * секрет крона утекает туда, куда его никто не клал.
 *
 * Fail-CLOSED: если CRON_SECRET не задан — запрещаем (раньше при пустом секрете
 * эндпоинты были открыты). User-Agent `vercel-cron` больше НЕ принимается как
 * доказательство (его легко подделать).
 */
export function verifyCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authHeader = request.headers.get('authorization') || ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  const headerSecret = (request.headers.get('x-cron-secret') || '').trim()

  return safeEqual(bearer, cronSecret) || safeEqual(headerSecret, cronSecret)
}
