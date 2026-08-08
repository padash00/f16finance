import { NextResponse } from 'next/server'

import { detectLoginType, toOperatorAuthEmail } from '@/lib/core/auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

/**
 * Вход для нативных приложений — единая точка общения с сайтом.
 *
 * Зачем нужен: приложение не должно знать ни адреса Supabase, ни его ключа.
 * Раньше мобильный клиент ходил в GoTrue напрямую, поэтому в сборку
 * приходилось зашивать `SUPABASE_URL` и `ANON_KEY`. Здесь сайт делает это сам
 * и отдаёт наружу только токен сессии — приложению остаётся один адрес.
 *
 * Обмен паролем на токен идёт server-side, поэтому ключ проекта не покидает
 * сервер, а вход можно ограничить по частоте и залогировать.
 *
 * Два действия:
 *   POST { action: "signIn",  login, password }     → сессия
 *   POST { action: "refresh", refresh_token }       → продлённая сессия
 *
 * `login` — почта сотрудника или логин оператора (в почту превращает сервер,
 * тем же helper'ом, что и веб: `lib/core/auth.ts`).
 */

export const dynamic = 'force-dynamic'

type Body = {
  action?: 'signIn' | 'refresh'
  login?: string
  password?: string
  refresh_token?: string
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Подбор пароля дороже, чем один разбор JSON: режем по IP. */
const SIGN_IN_LIMIT = 10
const SIGN_IN_WINDOW_MS = 5 * 60 * 1000
const REFRESH_LIMIT = 60
const REFRESH_WINDOW_MS = 5 * 60 * 1000

type GoTrueSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  user?: { id?: string; email?: string | null }
}

/** Ответ приложению. Наружу отдаём только то, что ему нужно. */
function toClientSession(session: GoTrueSession) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at:
      session.expires_at ??
      Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
    user: {
      id: session.user?.id || '',
      email: session.user?.email || null,
    },
  }
}

async function callGoTrue(
  grantType: 'password' | 'refresh_token',
  payload: Record<string, string>,
): Promise<{ session: GoTrueSession } | { error: string; status: number }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    return { error: 'auth-not-configured', status: 503 }
  }

  let response: Response
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/token?grant_type=${grantType}`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { error: 'auth-upstream-unavailable', status: 502 }
  }

  const data = (await response.json().catch(() => null)) as (GoTrueSession & { error?: string }) | null

  if (!response.ok || !data?.access_token) {
    // Причину от GoTrue наружу не выносим: она подсказывает, существует ли
    // учётная запись, и помогает перебирать логины.
    return {
      error: response.status === 400 || response.status === 401 ? 'invalid-credentials' : 'auth-failed',
      status: response.status === 400 || response.status === 401 ? 401 : 502,
    }
  }

  return { session: data }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Body | null
    const action = body?.action === 'refresh' ? 'refresh' : 'signIn'
    const ip = getClientIp(request)

    const limit = checkRateLimit(
      `mobile-session:${action}:${ip}`,
      action === 'refresh' ? REFRESH_LIMIT : SIGN_IN_LIMIT,
      action === 'refresh' ? REFRESH_WINDOW_MS : SIGN_IN_WINDOW_MS,
    )
    if (!limit.allowed) {
      return json(
        {
          error: 'rate-limited',
          message: 'Слишком много попыток входа. Попробуйте через несколько минут.',
          retry_at: limit.resetAt,
        },
        429,
      )
    }

    if (action === 'refresh') {
      const refreshToken = String(body?.refresh_token || '').trim()
      if (!refreshToken) return json({ error: 'refresh-token-required' }, 400)

      const result = await callGoTrue('refresh_token', { refresh_token: refreshToken })
      if ('error' in result) return json({ error: result.error }, result.status)

      return json({ session: toClientSession(result.session) })
    }

    const login = String(body?.login || '').trim()
    const password = String(body?.password || '')
    if (!login || !password) {
      return json({ error: 'login-and-password-required' }, 400)
    }

    // Операторы входят по логину, сотрудники — по почте. Превращение делает
    // сервер тем же helper'ом, что и веб: правило одно на всю систему.
    const isOperatorLogin = detectLoginType(login) === 'operator'
    const email = isOperatorLogin ? toOperatorAuthEmail(login) : login.toLowerCase()

    const result = await callGoTrue('password', { email, password })

    if ('error' in result) {
      // Неудачные попытки нужны для расследований — пишем и продолжаем.
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/auth/mobile-session',
        message: `sign-in failed: ${result.error} (${isOperatorLogin ? 'operator' : 'staff'})`,
      })
      return json(
        {
          error: result.error,
          message:
            result.error === 'invalid-credentials'
              ? 'Неверный логин или пароль.'
              : 'Вход временно недоступен. Попробуйте позже.',
        },
        result.status,
      )
    }

    return json({ session: toClientSession(result.session) })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/mobile-session',
      message: error?.message || 'mobile-session',
    })
    return json({ error: 'auth-failed' }, 500)
  }
}
