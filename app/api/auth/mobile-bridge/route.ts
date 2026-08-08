import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'

/**
 * Мост сессии для нативного приложения.
 *
 * Зачем: приложение авторизовано Bearer-токеном, а веб-портал — сессионными
 * куками Supabase. Если открыть страницу сайта во встроенном браузере как
 * есть, пользователь увидит экран входа, хотя он уже вошёл в приложении.
 *
 * Роут принимает Bearer, обменивает его на куки той же сессии и перенаправляет
 * на нужную страницу. Дальше веб работает обычным образом — это позволяет
 * открывать любые разделы портала внутри приложения, пока для них не сделан
 * нативный экран.
 *
 *   GET /api/auth/mobile-bridge?redirect=/income
 *
 * Токены передаются заголовком, а не в адресе: адрес попадает в историю,
 * логи прокси и заголовок Referer.
 */

export const dynamic = 'force-dynamic'

/** Куда разрешено перенаправлять: только внутрь портала. */
function safeRedirect(raw: string | null): string {
  const value = (raw || '/dashboard').trim()
  // Только относительные пути. Абсолютный адрес позволил бы увести сессию
  // на чужой домен — классический open redirect.
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const url = new URL(request.url)
    const redirectTo = safeRedirect(url.searchParams.get('redirect'))
    const refreshToken = url.searchParams.get('refresh_token') || ''

    const authorization = request.headers.get('authorization') || ''
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || ''
    if (!accessToken) {
      return NextResponse.json({ error: 'bearer-required' }, { status: 401 })
    }

    const target = new URL(redirectTo, url.origin)
    const response = NextResponse.redirect(target, { status: 302 })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return request.headers
              .get('cookie')
              ?.split('; ')
              .find((chunk) => chunk.startsWith(`${name}=`))
              ?.split('=')[1]
          },
          set(name: string, value: string, options: CookieOptions) {
            response.cookies.set({ name, value, ...options })
          },
          remove(name: string, options: CookieOptions) {
            response.cookies.set({ name, value: '', ...options })
          },
        },
      },
    )

    // setSession и записывает куки через обработчики выше. Без refresh-токена
    // сессия проживёт только до истечения access — приложение его присылает.
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    return response
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/mobile-bridge',
      message: error?.message || 'bridge failed',
    })
    return NextResponse.json({ error: 'bridge-failed' }, { status: 500 })
  }
}
