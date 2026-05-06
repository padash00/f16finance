import { NextResponse } from 'next/server'

import { getEffectiveCapabilities } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'

/**
 * Возвращает все capabilities текущего залогиненного пользователя.
 * Используется клиентским хуком useCapabilities() для скрытия кнопок.
 *
 * Формат ответа:
 *   { capabilities: string[], isSuperAdmin: boolean }
 *
 * Для super_admin возвращается capabilities = ['*'] — клиент трактует
 * это как "всё разрешено".
 */
export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const capabilities = await getEffectiveCapabilities(access)

  return NextResponse.json(
    {
      capabilities,
      isSuperAdmin: !!access.isSuperAdmin,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=30',
      },
    },
  )
}
