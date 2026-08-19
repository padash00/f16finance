import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

/**
 * Сброс пароля целиком в приложении.
 *
 * Раньше «Восстановить пароль» открывало сайт: человек уходил в браузер,
 * логинился там, менял пароль и возвращался в приложение руками. С телефона
 * это четыре перехода, и половина людей теряется на середине — а просят они
 * пароль обычно тогда, когда он нужен прямо сейчас.
 *
 * Два шага, оба через сайт, чтобы ключ проекта не уезжал в сборку — как и во
 * входе (`/api/auth/mobile-session`):
 *   POST { action: "request", email }                        → письмо с кодом
 *   POST { action: "confirm", email, code, password }        → новый пароль
 *
 * Код приходит письмом от Supabase. В шаблон письма «Reset Password» должен
 * быть добавлен `{{ .Token }}` — иначе в письме будет только ссылка, и вводить
 * в приложении будет нечего. Ссылка при этом продолжает работать: сайт никуда
 * не делся.
 *
 * Существование почты наружу не подтверждаем: ответ на «request» одинаковый
 * для заведённой и незаведённой — иначе форма превращается в способ узнать,
 * кто работает в компании.
 */

export const dynamic = 'force-dynamic'

type Body = {
  action?: 'request' | 'confirm'
  email?: string
  code?: string
  password?: string
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Письма и подбор кода — по IP: и то и другое дорого для чужого ящика. */
const REQUEST_LIMIT = 5
const REQUEST_WINDOW_MS = 15 * 60 * 1000
const CONFIRM_LIMIT = 10
const CONFIRM_WINDOW_MS = 15 * 60 * 1000

const MIN_PASSWORD_LENGTH = 8

/**
 * Одноразовый ключ из ссылки письма.
 *
 * Ссылка выглядит как `.../verify?token=pkce_…&type=recovery` или несёт
 * `token_hash` — берём и то и другое. Шестизначный код ссылкой не является и
 * сюда не попадает.
 */
function extractTokenHash(input: string): string | null {
  const value = input.trim()
  if (/^\d{4,8}$/.test(value)) return null

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      return url.searchParams.get('token_hash') || url.searchParams.get('token') || null
    } catch {
      return null
    }
  }

  // Из письма иногда копируют не ссылку, а сам ключ.
  return value.startsWith('pkce_') || value.length > 20 ? value : null
}

function authEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Body | null
    const action = body?.action === 'confirm' ? 'confirm' : 'request'
    const email = String(body?.email || '')
      .trim()
      .toLowerCase()
    const ip = getClientIp(request)

    const limit = checkRateLimit(
      `password-reset:${action}:${ip}`,
      action === 'confirm' ? CONFIRM_LIMIT : REQUEST_LIMIT,
      action === 'confirm' ? CONFIRM_WINDOW_MS : REQUEST_WINDOW_MS,
    )
    if (!limit.allowed) {
      return json(
        {
          error: 'rate-limited',
          message: 'Слишком много попыток. Попробуйте через несколько минут.',
          retry_at: limit.resetAt,
        },
        429,
      )
    }

    if (!email || !email.includes('@')) {
      return json({ error: 'email-required', message: 'Укажите рабочую почту.' }, 400)
    }

    const env = authEnv()
    if (!env) return json({ error: 'auth-not-configured' }, 503)

    if (action === 'request') {
      try {
        await fetch(`${env.url}/auth/v1/recover`, {
          method: 'POST',
          headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
      } catch {
        return json({ error: 'auth-upstream-unavailable', message: 'Почта временно недоступна. Попробуйте позже.' }, 502)
      }
      // Одинаковый ответ в любом случае — см. комментарий наверху.
      return json({ ok: true })
    }

    const code = String(body?.code || '').trim()
    const password = String(body?.password || '')
    if (!code) return json({ error: 'code-required', message: 'Введите код или вставьте ссылку из письма.' }, 400)
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json(
        { error: 'password-too-short', message: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.` },
        400,
      )
    }

    // Шаг 1: код из письма меняем на сессию. Проверку срока и числа попыток
    // делает сам GoTrue — свой счётчик здесь был бы второй правдой.
    //
    // Принимаем и ссылку целиком. В стандартном шаблоне Supabase кода нет —
    // только ссылка, и пока владелец не добавил в шаблон `{{ .Token }}`,
    // вводить человеку нечего. Но внутри ссылки лежит тот же одноразовый
    // ключ (`token_hash`), и по нему проверка проходит так же. Пусть вставит
    // ссылку — это честнее, чем отвечать «код не подошёл» на письмо, в
    // котором кода не было.
    const tokenHash = extractTokenHash(code)
    const verifyBody = tokenHash
      ? { type: 'recovery', token_hash: tokenHash }
      : { type: 'recovery', email, token: code }

    let verifyResponse: Response
    try {
      verifyResponse = await fetch(`${env.url}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyBody),
      })
    } catch {
      return json({ error: 'auth-upstream-unavailable', message: 'Сброс временно недоступен. Попробуйте позже.' }, 502)
    }

    const verified = (await verifyResponse.json().catch(() => null)) as { access_token?: string } | null
    if (!verifyResponse.ok || !verified?.access_token) {
      return json(
        {
          error: 'invalid-code',
          message: tokenHash
            ? 'Ссылка не подошла или устарела. Запросите письмо заново.'
            : 'Код не подошёл или устарел. Если в письме только ссылка — вставьте её целиком.',
        },
        400,
      )
    }

    // Шаг 2: этой сессией и ставим пароль. Другой возможности у неё нет —
    // токен восстановления одноразовый и живёт минуты.
    let updateResponse: Response
    try {
      updateResponse = await fetch(`${env.url}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: env.anonKey,
          Authorization: `Bearer ${verified.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      })
    } catch {
      return json({ error: 'auth-upstream-unavailable', message: 'Сброс временно недоступен. Попробуйте позже.' }, 502)
    }

    if (!updateResponse.ok) {
      const detail = (await updateResponse.json().catch(() => null)) as { msg?: string; message?: string } | null
      const raw = String(detail?.msg || detail?.message || '')
      // Единственная причина, которую полезно назвать: тот же пароль, что был.
      const message = /same.+password/i.test(raw)
        ? 'Это тот же пароль, что и раньше. Придумайте другой.'
        : 'Не удалось сохранить пароль. Попробуйте ещё раз.'
      return json({ error: 'password-not-set', message }, 400)
    }

    // Сессию восстановления гасим: дальше человек входит новым паролем, и
    // живой токен от неё в приложении не нужен.
    try {
      await fetch(`${env.url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: env.anonKey, Authorization: `Bearer ${verified.access_token}` },
      })
    } catch {
      /* не критично: токен истечёт сам */
    }

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/password-reset',
      message: error?.message || 'password-reset',
    })
    return json({ error: 'reset-failed', message: 'Не удалось сбросить пароль. Попробуйте позже.' }, 500)
  }
}
