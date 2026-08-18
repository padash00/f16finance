'use client'

import { useEffect } from 'react'

/**
 * Ловит ссылку восстановления, которая пришла не на ту страницу.
 *
 * Supabase подставляет свой Site URL вместо нашего адреса возврата, если тот не
 * добавлен в список разрешённых. Письмо при этом приходит и ссылка рабочая — но
 * открывается корень сайта, а токен остаётся висеть в адресной строке после
 * решётки. Человек видит обычную главную и уверен, что восстановление не
 * работает.
 *
 * Токен живёт только в адресной строке браузера: серверу он не отправляется,
 * поэтому перехватить это можно единственным способом — здесь, на клиенте.
 *
 * Ничего не рисует.
 */
export function RecoveryHashCatcher() {
  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    if (!hash) return

    const params = new URLSearchParams(hash)
    const type = params.get('type')
    const hasTokens = params.get('access_token') && params.get('refresh_token')
    if (!hasTokens || (type !== 'recovery' && type !== 'invite')) return

    // Уже на разборе ссылки — второй раз перенаправлять некуда.
    const path = window.location.pathname
    if (path.startsWith('/auth/callback') || path.startsWith('/reset-password')) return

    window.location.replace(`/auth/callback?next=${encodeURIComponent('/reset-password?mode=recovery')}#${hash}`)
  }, [])

  return null
}
